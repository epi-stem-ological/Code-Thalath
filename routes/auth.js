'use strict';

const express = require('express');
const { db, now, setting } = require('../lib/db');
const { verifyPassword, createSession, destroySession } = require('../lib/auth');
const { createUser, befriendTom, usernameError, passwordError, findByUsername } = require('../lib/users');
const { plain } = require('../lib/sanitize');

const router = express.Router();

// --- crude but effective brute-force brake -----------------------------------
const attempts = new Map();
function throttled(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (now() - rec.first > 15 * 60_000) { attempts.delete(key); return false; }
  return rec.count >= 10;
}
function noteAttempt(key) {
  const rec = attempts.get(key);
  if (!rec || now() - rec.first > 15 * 60_000) attempts.set(key, { first: now(), count: 1 });
  else rec.count++;
}
function clearAttempts(key) { attempts.delete(key); }

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
}

router.get('/', (req, res) => {
  if (req.user) return res.redirect('/home');
  const stats = {
    users: db.prepare('SELECT COUNT(*) c FROM users WHERE disabled = 0').get().c,
    online: db.prepare('SELECT COUNT(*) c FROM users WHERE last_seen > ?').get(now() - 5 * 60_000).c,
  };
  res.render('landing', { title: 'a place for friends', nav: 'landing', stats });
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.render('login', { title: 'Log In', nav: 'login', error: null, username: '' });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = (req.ip || '') + '|' + username.toLowerCase();

  const fail = (error) => res.status(401).render('login', { title: 'Log In', nav: 'login', error, username });

  if (throttled(key)) return fail('Too many attempts. Wait 15 minutes and try again.');

  const user = findByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    noteAttempt(key);
    return fail('Your email address or password is incorrect.');
  }
  if (user.disabled) return fail('That account has been disabled.');

  clearAttempts(key);
  db.prepare('UPDATE users SET last_login = ?, last_seen = ? WHERE id = ?').run(now(), now(), user.id);
  createSession(res, user.id, req.get('user-agent') || '');
  res.redirect(safeNext(req.body.next || req.query.next));
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/home');
  const openSignup = setting('open_signup', '0') === '1';
  res.render('register', {
    title: 'Sign Up', nav: 'register', error: null, openSignup,
    form: { code: plain(req.query.code || '', 64), username: '', display_name: '' },
  });
});

router.post('/register', (req, res) => {
  const openSignup = setting('open_signup', '0') === '1';
  const form = {
    code: String(req.body.code || '').trim(),
    username: String(req.body.username || '').trim(),
    display_name: String(req.body.display_name || '').trim(),
  };
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');

  const fail = (error) => res.status(400).render('register', { title: 'Sign Up', nav: 'register', error, openSignup, form });

  const ipKey = 'reg|' + (req.ip || '');
  if (throttled(ipKey)) return fail('Too many sign-up attempts. Try again later.');

  let invite = null;
  if (!openSignup) {
    if (!form.code) return fail('You need an invite code. Ask Tom.');
    invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(form.code);
    if (!invite || invite.used_by) {
      noteAttempt(ipKey);
      return fail('That invite code is not valid.');
    }
  }

  const uErr = usernameError(form.username);
  if (uErr) return fail(uErr);
  const pErr = passwordError(password);
  if (pErr) return fail(pErr);
  if (password !== confirm) return fail('The two passwords do not match.');
  if (!form.display_name) form.display_name = form.username;
  if (form.display_name.length > 60) return fail('Display name is too long.');

  let userId;
  try {
    userId = createUser({ username: form.username, displayName: form.display_name, password });
  } catch (err) {
    return fail('Could not create that account. Try a different username.');
  }

  if (invite) {
    db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(userId, now(), invite.code);
  }
  befriendTom(userId);

  createSession(res, userId, req.get('user-agent') || '');
  res.redirect('/edit?msg=' + encodeURIComponent('Welcome! Fill this in so people know who you are.'));
});

router.get('/about', (req, res) => {
  res.render('about', { title: 'About', nav: '' });
});

router.get('/help', (req, res) => {
  res.render('help', { title: 'Help', nav: '' });
});

module.exports = router;
