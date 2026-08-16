'use strict';

const crypto = require('crypto');
const express = require('express');
const { db, now, setting, setSetting } = require('../lib/db');
const { requireLogin, requireAdmin, hashPassword } = require('../lib/auth');
const { createUser, befriendTom, usernameError, passwordError } = require('../lib/users');
const { plain } = require('../lib/sanitize');

const router = express.Router();
router.use(requireLogin, requireAdmin);

function code() {
  // readable: no 0/O/1/I
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 4) out += '-';
  }
  return out;
}

router.get('/', (req, res) => {
  const users = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM friendships f WHERE f.status='accepted' AND (f.requester_id=u.id OR f.addressee_id=u.id)) AS friends,
      (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id) AS photos
    FROM users u ORDER BY u.created_at DESC
  `).all();
  const invites = db.prepare(`
    SELECT i.*, c.username AS by_username, uu.username AS used_username
    FROM invites i
    LEFT JOIN users c ON c.id = i.created_by
    LEFT JOIN users uu ON uu.id = i.used_by
    ORDER BY i.created_at DESC LIMIT 100
  `).all();
  res.render('admin', {
    title: 'Admin',
    nav: 'admin',
    users,
    invites,
    openSignup: setting('open_signup', '0') === '1',
    siteName: res.locals.siteName,
    tagline: res.locals.tagline,
    welcome: setting('welcome_message', ''),
    stats: {
      users: users.length,
      messages: db.prepare('SELECT COUNT(*) c FROM messages').get().c,
      ims: db.prepare('SELECT COUNT(*) c FROM im_messages').get().c,
      comments: db.prepare('SELECT COUNT(*) c FROM comments').get().c,
      blogs: db.prepare('SELECT COUNT(*) c FROM blogs').get().c,
      bulletins: db.prepare('SELECT COUNT(*) c FROM bulletins').get().c,
      photos: db.prepare('SELECT COUNT(*) c FROM photos').get().c,
      groups: db.prepare('SELECT COUNT(*) c FROM groups').get().c,
    },
  });
});

router.post('/invite', (req, res) => {
  const n = Math.max(1, Math.min(50, parseInt(req.body.count, 10) || 1));
  const note = plain(req.body.note, 100);
  const ins = db.prepare('INSERT INTO invites (code, created_by, note, created_at) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => { for (let i = 0; i < n; i++) ins.run(code(), req.user.id, note, now()); });
  tx();
  res.redirect('/admin?msg=' + encodeURIComponent(`${n} invite code(s) created.`));
});

router.post('/invite/:code/delete', (req, res) => {
  db.prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL').run(req.params.code);
  res.redirect('/admin');
});

router.post('/user/create', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const uErr = usernameError(username);
  if (uErr) return res.redirect('/admin?err=' + encodeURIComponent(uErr));
  const pErr = passwordError(password);
  if (pErr) return res.redirect('/admin?err=' + encodeURIComponent(pErr));
  const id = createUser({
    username,
    displayName: plain(req.body.display_name, 60) || username,
    password,
    isAdmin: req.body.is_admin ? 1 : 0,
  });
  befriendTom(id);
  res.redirect('/admin?msg=' + encodeURIComponent(`Created ${username}.`));
});

router.post('/user/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.redirect('/admin?err=' + encodeURIComponent('Not on yourself.'));
  db.prepare('UPDATE users SET disabled = 1 - disabled WHERE id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.redirect('/admin');
});

router.post('/user/:id/admin', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.redirect('/admin?err=' + encodeURIComponent('Not on yourself.'));
  db.prepare('UPDATE users SET is_admin = 1 - is_admin WHERE id = ?').run(id);
  res.redirect('/admin');
});

router.post('/user/:id/password', (req, res) => {
  const pErr = passwordError(req.body.password);
  if (pErr) return res.redirect('/admin?err=' + encodeURIComponent(pErr));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), req.params.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  res.redirect('/admin?msg=' + encodeURIComponent('Password reset. They are signed out everywhere.'));
});

router.post('/user/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.redirect('/admin?err=' + encodeURIComponent('Not on yourself.'));
  if (String(setting('tom_id', '')) === String(id)) {
    return res.redirect('/admin?err=' + encodeURIComponent('That is Tom. Reassign the site first.'));
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.redirect('/admin?msg=' + encodeURIComponent('Account deleted.'));
});

router.post('/site', (req, res) => {
  setSetting('site_name', plain(req.body.site_name, 40) || 'Thalath Space');
  setSetting('tagline', plain(req.body.tagline, 80) || 'a place for friends');
  setSetting('open_signup', req.body.open_signup ? '1' : '0');
  setSetting('welcome_message', String(req.body.welcome_message || '').slice(0, 4000));
  res.redirect('/admin?msg=' + encodeURIComponent('Site settings saved.'));
});

router.post('/broadcast', (req, res) => {
  const subject = plain(req.body.subject, 150) || 'Announcement';
  const body = String(req.body.body || '').slice(0, 20000);
  if (!body.trim()) return res.redirect('/admin?err=' + encodeURIComponent('Write something.'));
  const users = db.prepare('SELECT id FROM users WHERE disabled = 0 AND id <> ?').all(req.user.id);
  const ins = db.prepare('INSERT INTO messages (sender_id, recipient_id, subject, body, created_at) VALUES (?, ?, ?, ?, ?)');
  const ts = now();
  const tx = db.transaction(() => { for (const usr of users) ins.run(req.user.id, usr.id, subject, body, ts); });
  tx();
  const { notify } = require('../lib/util');
  for (const usr of users) notify(usr.id, { actorId: req.user.id, kind: 'mail', text: subject, url: '/mail' });
  res.redirect('/admin?msg=' + encodeURIComponent(`Sent to ${users.length} people.`));
});

module.exports = router;
