'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { findByUsername } = require('../lib/users');
const { plain } = require('../lib/sanitize');
const { imageUpload, removeUpload } = require('../lib/upload');
const u = require('../lib/util');

const router = express.Router();
router.use(requireLogin);

router.get('/', (req, res) => res.redirect('/photos/' + req.user.username));

router.post('/upload', imageUpload.array('photos', 12), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.redirect('/photos/' + req.user.username + '?err=' + encodeURIComponent('Pick some pictures.'));
  const albumId = parseInt(req.body.album_id, 10) || null;
  const caption = plain(req.body.caption, 200);
  const ins = db.prepare('INSERT INTO photos (user_id, album_id, file, caption, created_at) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const f of files) ins.run(req.user.id, albumId, f.filename, caption, now());
  });
  tx();
  if (!req.user.avatar && files[0]) {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(files[0].filename, req.user.id);
  }
  res.redirect('/photos/' + req.user.username + '?msg=' + encodeURIComponent(`${files.length} picture(s) uploaded.`));
});

router.post('/album', (req, res) => {
  const name = plain(req.body.name, 60).trim();
  if (name) {
    db.prepare('INSERT INTO albums (user_id, name, privacy, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, name, u.pick(req.body.privacy, ['everyone', 'friends', 'private'], 'friends'), now());
  }
  res.redirect('/photos/' + req.user.username);
});

router.get('/view/:id', (req, res, next) => {
  const p = db.prepare(`
    SELECT p.*, us.username, us.display_name, us.avatar FROM photos p
    JOIN users us ON us.id = p.user_id WHERE p.id = ?
  `).get(req.params.id);
  if (!p) return next();
  const siblings = db.prepare('SELECT id FROM photos WHERE user_id = ? ORDER BY created_at DESC').all(p.user_id);
  const idx = siblings.findIndex((s) => s.id === p.id);
  res.render('photo', {
    title: p.caption || 'Photo',
    nav: 'photos',
    p,
    prev: idx > 0 ? siblings[idx - 1].id : null,
    next: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null,
    mine: p.user_id === req.user.id,
  });
});

router.post('/view/:id/caption', (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (p) db.prepare('UPDATE photos SET caption = ? WHERE id = ?').run(plain(req.body.caption, 200), p.id);
  res.redirect('/photos/view/' + req.params.id);
});

router.post('/view/:id/delete', (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!p) return res.redirect('/photos');
  if (p.user_id !== req.user.id && !req.user.is_admin) return res.status(403).send('Not yours.');
  db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
  const owner = db.prepare('SELECT username, avatar FROM users WHERE id = ?').get(p.user_id);
  if (owner && owner.avatar === p.file) db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(p.user_id);
  const stillUsed = db.prepare('SELECT 1 FROM photos WHERE file = ?').get(p.file);
  if (!stillUsed) removeUpload(p.file);
  res.redirect('/photos/' + (owner ? owner.username : '') + '?msg=' + encodeURIComponent('Photo deleted.'));
});

router.get('/:username', (req, res, next) => {
  const user = findByUsername(req.params.username);
  if (!user) return next();
  const albums = db.prepare('SELECT * FROM albums WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  const photos = db.prepare('SELECT * FROM photos WHERE user_id = ? ORDER BY created_at DESC LIMIT 400').all(user.id);
  res.render('photos', {
    title: `${user.display_name}'s Pics`,
    nav: 'photos',
    user, albums, photos,
    mine: user.id === req.user.id,
  });
});

module.exports = router;
