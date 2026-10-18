'use strict';

/**
 * Strips identifying metadata out of uploaded images, in place.
 *
 * A photo taken on a phone carries far more than the picture: GPS coordinates
 * accurate to a few metres, the device's make, model and serial, the exact
 * timestamp, sometimes the owner's name. Upload a photo of your child in the
 * garden and the file tells every other member where you live.
 *
 * Nobody expects that, so the only defensible default is to remove it before
 * the file is ever stored. This runs on the bytes directly rather than through
 * an image library: no re-encoding, no quality loss, no native dependency.
 *
 * Deliberately conservative — anything it does not understand is left exactly
 * as it was rather than guessed at and corrupted.
 */

const fs = require('fs');

// ---------------------------------------------------------------- JPEG

/**
 * JPEG is a sequence of marker segments. EXIF (including GPS) lives in APP1,
 * Photoshop/IPTC in APP13, XMP in APP1 too. Drop those, keep everything else
 * — notably APP2, which carries the ICC colour profile, so colours hold.
 */
function scrubJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // not a JPEG

  const out = [buf.subarray(0, 2)]; // SOI
  let i = 2;
  let dropped = 0;

  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) return null; // desynced — refuse rather than mangle
    const marker = buf[i + 1];

    // standalone markers, no length field
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }

    // start of scan: entropy-coded image data runs to the end, copy it whole
    if (marker === 0xda) {
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }

    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;

    const isExifOrXmp = marker === 0xe1;   // APP1  — EXIF, GPS, XMP
    const isPhotoshop = marker === 0xed;   // APP13 — IPTC / Photoshop
    const isComment   = marker === 0xfe;   // COM
    const isAppOther  = marker === 0xef;   // APP15, occasionally vendor junk

    if (isExifOrXmp || isPhotoshop || isComment || isAppOther) {
      dropped += len + 2;
    } else {
      out.push(buf.subarray(i, i + 2 + len));
    }
    i += 2 + len;
  }

  return dropped ? { buf: Buffer.concat(out), dropped } : { buf, dropped: 0 };
}

// ---------------------------------------------------------------- PNG

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Chunks that must survive: structure, colour, transparency, animation. */
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP',
  'sBIT', 'bKGD', 'pHYs', 'hIST', 'sPLT',
  'acTL', 'fcTL', 'fdAT',   // APNG — dropping these kills the animation
]);
/** Dropped: tEXt zTXt iTXt eXIf tIME and anything else unrecognised. */

function scrubPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;

  const out = [buf.subarray(0, 8)];
  let i = 8;
  let dropped = 0;

  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    if (len > 0x7fffffff) return null;
    const type = buf.toString('ascii', i + 4, i + 8);
    const total = 12 + len; // length + type + data + crc
    if (i + total > buf.length) return null;

    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, i + total));
    else dropped += total;

    i += total;
    if (type === 'IEND') break;
  }

  return dropped ? { buf: Buffer.concat(out), dropped } : { buf, dropped: 0 };
}

// ---------------------------------------------------------------- WebP

/** WebP is RIFF; EXIF and XMP ride along as their own chunks. */
function scrubWebp(buf) {
  if (buf.length < 12) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;

  const body = [];
  let i = 12;
  let dropped = 0;

  while (i + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const padded = size + (size % 2); // chunks are even-aligned
    const total = 8 + padded;
    if (i + total > buf.length) break;

    if (fourcc === 'EXIF' || fourcc === 'XMP ') dropped += total;
    else body.push(buf.subarray(i, i + total));

    i += total;
  }
  if (!dropped) return { buf, dropped: 0 };

  const payload = Buffer.concat(body);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return { buf: Buffer.concat([header, payload]), dropped };
}

// ---------------------------------------------------------------- dispatch

const BY_MIME = {
  'image/jpeg': scrubJpeg,
  'image/png':  scrubPng,
  'image/webp': scrubWebp,
};

/**
 * Scrub one file on disk. Returns how many bytes of metadata were removed,
 * or null when the format carries none we can act on. Never throws — a file
 * it cannot parse is left untouched, because a stored original beats a
 * corrupted one.
 */
function scrubFile(filePath, mimetype) {
  const fn = BY_MIME[mimetype];
  if (!fn) return null;
  try {
    const original = fs.readFileSync(filePath);
    const result = fn(original);
    if (!result || !result.dropped) return result ? 0 : null;
    fs.writeFileSync(filePath, result.buf);
    return result.dropped;
  } catch {
    return null;
  }
}

/** Express middleware: scrubs whatever multer just wrote. */
function scrubUploads(req, res, next) {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) files.push(...(Array.isArray(req.files) ? req.files : Object.values(req.files).flat()));
  for (const f of files) {
    if (!f || !f.path) continue;
    const dropped = scrubFile(f.path, f.mimetype);
    if (dropped) f.metadataStripped = dropped;
  }
  next();
}

module.exports = { scrubFile, scrubUploads, scrubJpeg, scrubPng, scrubWebp };
