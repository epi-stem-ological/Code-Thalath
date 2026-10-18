'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// No SVG: it is executable XML that can also pull in remote resources, and
// nothing here needs a vector avatar.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm',
  'audio/mp4', 'audio/aac', 'audio/flac', 'audio/x-m4a', 'audio/m4a',
]);

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/avif': '.avif', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3',
  'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/webm': '.weba',
  'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = EXT[file.mimetype] || path.extname(file.originalname).toLowerCase().slice(0, 5) || '.bin';
    cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

function makeUploader(types, limitMb) {
  return multer({
    storage,
    limits: { fileSize: limitMb * 1024 * 1024, files: 12 },
    fileFilter: (req, file, cb) => {
      if (types.has(file.mimetype)) return cb(null, true);
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    },
  });
}

/**
 * Every uploader is handed back as [multer, csrfAfterUpload] so the deferred
 * multipart CSRF check can't be left off a route by accident.
 */
function guarded(uploader) {
  const { csrfAfterUpload } = require('./auth');
  const { scrubUploads } = require('./scrub');
  // CSRF check and metadata stripping are bundled into the uploader itself so
  // no route can be written that skips either one.
  return {
    single: (field) => [uploader.single(field), csrfAfterUpload, scrubUploads],
    array: (field, max) => [uploader.array(field, max), csrfAfterUpload, scrubUploads],
    none: () => [uploader.none(), csrfAfterUpload, scrubUploads],
  };
}

const imageUpload = guarded(makeUploader(IMAGE_TYPES, Number(process.env.MAX_IMAGE_MB || 12)));
const audioUpload = guarded(makeUploader(AUDIO_TYPES, Number(process.env.MAX_AUDIO_MB || 25)));
const mediaUpload = guarded(makeUploader(new Set([...IMAGE_TYPES, ...AUDIO_TYPES]), Number(process.env.MAX_AUDIO_MB || 25)));

function removeUpload(filename) {
  if (!filename || filename.includes('/') || filename.includes('\\')) return;
  fs.promises.unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
}

module.exports = { UPLOAD_DIR, imageUpload, audioUpload, mediaUpload, removeUpload };
