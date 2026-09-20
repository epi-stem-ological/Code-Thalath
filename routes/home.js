'use strict';

const express = require('express');
const { db, now, setting } = require('../lib/db');
const { requireLogin, destroySession } = require('../lib/auth');
const { hashPassword, verifyPassword } = require('../lib/auth');
const { passwordError } = require('../lib/users');
const { plain, lightHtml } = require('../lib/sanitize');
const u = require('../lib/util');

const router = express.Router();

router.get('/home', requireLogin, (req, res) => {
  const me = req.user;
  const fids = u.friendIds(me.id);
  const inList = fids.length ? fids.join(',') : '-1';

  const bulletins = db.prepare(`
    SELECT b.*, a.username, a.display_name, a.avatar
    FROM bulletins b JOIN users a ON a.id = b.author_id
    WHERE b.author_id IN (${inList}) OR b.author_id = ?
    ORDER BY b.created_at DESC LIMIT 8
  `).all(me.id);

  const blogs = db.prepare(`
    SELECT bl.*, a.username, a.display_name, a.avatar
    FROM blogs bl JOIN users a ON a.id = bl.author_id
    WHERE (bl.author_id IN (${inList}) AND bl.privacy <> 'private') OR bl.author_id = ?
    ORDER BY bl.created_at DESC LIMIT 6
  `).all(me.id);

  const onlineFriends = db.prepare(`
    SELECT u.* FROM users u WHERE u.id IN (${inList}) AND u.last_seen > ? ORDER BY u.last_seen DESC LIMIT 16
  `).all(now() - 5 * 60_000);

  const newComments = db.prepare(`
    SELECT c.*, a.username, a.display_name, a.avatar FROM comments c
    JOIN users a ON a.id = c.author_id
    WHERE c.profile_id = ? ORDER BY c.created_at DESC LIMIT 5
  `).all(me.id);

  const requests = db.prepare(`
    SELECT u.* FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC
  `).all(me.id);

  const newPeople = db.prepare(`
    SELECT * FROM users WHERE disabled = 0 AND id <> ? ORDER BY created_at DESC LIMIT 8
  `).all(me.id);

  const recentPhotos = db.prepare(`
    SELECT p.*, us.username FROM photos p JOIN users us ON us.id = p.user_id
    WHERE p.user_id IN (${inList}) ORDER BY p.created_at DESC LIMIT 8
  `).all();

  res.render('home', {
    title: 'Home',
    nav: 'home',
    bulletins, blogs, onlineFriends, newComments, requests, newPeople, recentPhotos,
    friendTotal: fids.length,
    stats: {
      views: me.profile_views,
      comments: db.prepare('SELECT COUNT(*) c FROM comments WHERE profile_id = ?').get(me.id).c,
      photos: db.prepare('SELECT COUNT(*) c FROM photos WHERE user_id = ?').get(me.id).c,
      posts: db.prepare('SELECT COUNT(*) c FROM blogs WHERE author_id = ?').get(me.id).c,
    },
  });
});

router.get('/browse', requireLogin, (req, res) => {
  const sort = u.pick(req.query.sort, ['recent', 'name', 'new', 'views'], 'recent');
  const order = {
    recent: 'last_seen DESC NULLS LAST',
    name: 'display_name COLLATE NOCASE',
    new: 'created_at DESC',
    views: 'profile_views DESC',
  }[sort];
  const users = db.prepare(`SELECT * FROM users WHERE disabled = 0 ORDER BY ${order} LIMIT 200`).all();
  res.render('browse', { title: 'Browse People', nav: 'browse', users, sort });
});

router.get('/search', requireLogin, (req, res) => {
  const q = plain(req.query.q || '', 80).trim();
  const like = `%${q}%`;
  let people = [], blogs = [], bulletins = [], groups = [];
  if (q) {
    people = db.prepare(`
      SELECT u.* FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.disabled = 0 AND (u.username LIKE ? OR u.display_name LIKE ? OR u.headline LIKE ?
            OR p.about_me LIKE ? OR p.location LIKE ? OR p.interests LIKE ? OR p.music LIKE ?)
      LIMIT 60
    `).all(like, like, like, like, like, like, like);
    blogs = db.prepare(`
      SELECT b.*, a.username, a.display_name FROM blogs b JOIN users a ON a.id = b.author_id
      WHERE b.privacy <> 'private' AND (b.title LIKE ? OR b.body LIKE ?) ORDER BY b.created_at DESC LIMIT 30
    `).all(like, like);
    bulletins = db.prepare(`
      SELECT b.*, a.username, a.display_name FROM bulletins b JOIN users a ON a.id = b.author_id
      WHERE b.subject LIKE ? OR b.body LIKE ? ORDER BY b.created_at DESC LIMIT 30
    `).all(like, like);
    groups = db.prepare('SELECT * FROM groups WHERE name LIKE ? OR description LIKE ? LIMIT 20').all(like, like);
  }
  res.render('search', { title: q ? `Search: ${q}` : 'Search', nav: '', q, people, blogs, bulletins, groups });
});

router.get('/notifications', requireLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, a.username, a.display_name, a.avatar
    FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100
  `).all(req.user.id);
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), req.user.id);
  res.render('notifications', { title: 'Alerts', nav: 'notifications', rows });
});

router.post('/notifications/clear', requireLogin, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.redirect('/notifications');
});

// ---------------------------------------------------------------- settings

router.get('/settings', requireLogin, (req, res) => {
  res.render('settings', {
    title: 'Account Settings',
    nav: '',
    sessions: db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id),
    pushCount: db.prepare('SELECT COUNT(*) c FROM push_subs WHERE user_id = ?').get(req.user.id).c,
    error: null,
  });
});

router.post('/settings/mood', requireLogin, (req, res) => {
  db.prepare('UPDATE users SET mood = ?, mood_emoji = ?, away_message = ?, headline = ? WHERE id = ?').run(
    plain(req.body.mood, 40),
    plain(req.body.mood_emoji, 8),
    plain(req.body.away_message, 200),
    lightHtml(String(req.body.headline || '').slice(0, 300)),
    req.user.id
  );
  let target = '/settings';
  const ref = req.get('referer');
  if (ref) {
    try {
      const url = new URL(ref, `${req.protocol}://${req.get('host')}`);
      if (url.host === req.get('host')) target = url.pathname + url.search;
    } catch { /* keep the default */ }
  }
  res.redirect(target);
});

router.post('/settings/password', requireLogin, (req, res) => {
  const fail = (error) => res.status(400).render('settings', {
    title: 'Account Settings', nav: '',
    sessions: db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id),
    pushCount: db.prepare('SELECT COUNT(*) c FROM push_subs WHERE user_id = ?').get(req.user.id).c,
    error,
  });
  if (!verifyPassword(String(req.body.current || ''), req.user.password_hash)) return fail('Current password is wrong.');
  const pErr = passwordError(req.body.next);
  if (pErr) return fail(pErr);
  if (req.body.next !== req.body.confirm) return fail('New passwords do not match.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.next)), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(req.user.id, req.sessionId);
  res.redirect('/settings?msg=' + encodeURIComponent('Password changed. Other devices were signed out.'));
});

router.post('/settings/username', requireLogin, (req, res) => {
  const { usernameError } = require('../lib/users');
  const wanted = String(req.body.username || '').trim();
  if (wanted.toLowerCase() === req.user.username.toLowerCase()) return res.redirect('/settings');
  const err = usernameError(wanted);
  if (err) return res.redirect('/settings?err=' + encodeURIComponent(err));
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(wanted, req.user.id);
  res.redirect('/settings?msg=' + encodeURIComponent('Username changed to ' + wanted));
});

router.post('/settings/sessions/revoke', requireLogin, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(req.user.id, req.sessionId);
  res.redirect('/settings?msg=' + encodeURIComponent('Signed out everywhere else.'));
});

router.post('/settings/delete', requireLogin, (req, res) => {
  if (!verifyPassword(String(req.body.password || ''), req.user.password_hash)) {
    return res.redirect('/settings?err=' + encodeURIComponent('Wrong password.'));
  }
  if (String(setting('tom_id', '')) === String(req.user.id)) {
    return res.redirect('/settings?err=' + encodeURIComponent('Tom cannot delete Tom. Hand the site over first.'));
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  destroySession(req, res);
  res.redirect('/');
});

module.exports = router;
