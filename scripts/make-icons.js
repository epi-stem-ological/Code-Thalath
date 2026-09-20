'use strict';

/**
 * Renders the app icons as PNGs with nothing but zlib.
 * Blue rounded square, white MySpace-ish silhouette, orange corner flash.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'img');
fs.mkdirSync(OUT, { recursive: true });

// ---- crc32 ------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- tiny canvas ------------------------------------------------------------
function canvas(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
    const i = (y * size + x) * 4;
    const src = a;
    const dst = px[i + 3] / 255;
    const out = src + dst * (1 - src);
    if (out <= 0) return;
    px[i] = Math.round((r * src + px[i] * dst * (1 - src)) / out);
    px[i + 1] = Math.round((g * src + px[i + 1] * dst * (1 - src)) / out);
    px[i + 2] = Math.round((b * src + px[i + 2] * dst * (1 - src)) / out);
    px[i + 3] = Math.round(out * 255);
  };
  return { px, size, put };
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// signed distance helpers, sampled 3x3 for cheap antialiasing
function fill(c, sdf, color, alpha = 1) {
  const S = 3;
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          if (sdf(x + (sx + 0.5) / S, y + (sy + 0.5) / S) <= 0) hits++;
        }
      }
      if (hits) c.put(x, y, color, (hits / (S * S)) * alpha);
    }
  }
}

const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return Math.hypot(dx, dy) - r;
};
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx, cy, rx, ry) => (x, y) => Math.hypot((x - cx) / rx, (y - cy) / ry) - 1;
const band = (fn, lo, hi) => (x, y) => Math.max(lo(x, y), hi(x, y), fn(x, y));

function drawIcon(size, maskable) {
  const c = canvas(size);
  const s = size / 512;
  const pad = maskable ? size * 0.12 : 0;
  const radius = maskable ? size * 0.5 : size * 0.22;

  // plate
  fill(c, roundRect(pad, pad, size - pad, size - pad, radius), hex('#3d6fb5'));
  // top gloss
  fill(
    c,
    (x, y) => Math.max(roundRect(pad, pad, size - pad, size - pad, radius)(x, y), y - size * 0.42),
    hex('#5b8ed4')
  );
  // orange flash across the bottom
  fill(
    c,
    (x, y) => Math.max(
      roundRect(pad, pad, size - pad, size - pad, radius)(x, y),
      -(y - (size * 0.80 + (x - size / 2) * 0.10))
    ),
    hex('#ff9933')
  );

  // silhouette: head + shoulders
  const cx = size / 2;
  fill(c, circle(cx, 200 * s + pad * 0.5, 88 * s), hex('#ffffff'));
  fill(
    c,
    (x, y) => Math.max(ellipse(cx, 470 * s + pad * 0.5, 165 * s, 175 * s)(x, y), y - (size * 0.80 + (x - cx) * 0.10) + 2),
    hex('#ffffff')
  );

  return encodePng(size, size, c.px);
}

function drawBadge(size) {
  const c = canvas(size);
  fill(c, circle(size / 2, size / 2, size / 2 - 1), hex('#ffffff'));
  fill(c, circle(size / 2, size * 0.38, size * 0.17), hex('#000000'));
  fill(
    c,
    (x, y) => Math.max(ellipse(size / 2, size * 0.92, size * 0.33, size * 0.36)(x, y), y - size * 0.86),
    hex('#000000')
  );
  return encodePng(size, size, c.px);
}

const files = [
  ['icon-192.png', drawIcon(192, false)],
  ['icon-512.png', drawIcon(512, false)],
  ['icon-180.png', drawIcon(180, false)],
  ['icon-maskable.png', drawIcon(512, true)],
  ['badge.png', drawBadge(96)],
];

for (const [name, buf] of files) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log('wrote', name, buf.length + 'b');
}
