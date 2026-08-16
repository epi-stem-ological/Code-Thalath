'use strict';

const { db, now, setting } = require('./db');
const { hashPassword } = require('./auth');

const RESERVED = new Set([
  'admin', 'login', 'logout', 'register', 'signup', 'home', 'mail', 'im', 'blog', 'blogs',
  'bulletins', 'groups', 'photos', 'friends', 'browse', 'search', 'settings', 'edit',
  'uploads', 'img', 'css', 'js', 'api', 'sw.js', 'manifest.webmanifest', 'u', 'user',
  'profile', 'notifications', 'invite', 'about', 'help', 'null', 'undefined',
]);

function usernameError(username) {
  const u = String(username || '').trim();
  if (u.length < 2 || u.length > 20) return 'Username must be 2–20 characters.';
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return 'Username can use letters, numbers, dot, dash and underscore only.';
  if (RESERVED.has(u.toLowerCase())) return 'That username is reserved.';
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) return 'That username is taken.';
  return null;
}

function passwordError(pw) {
  if (!pw || String(pw).length < 8) return 'Password must be at least 8 characters.';
  if (String(pw).length > 200) return 'Password is too long.';
  return null;
}

const insertUser = db.prepare(`
  INSERT INTO users (username, display_name, password_hash, is_admin, created_at, last_seen, headline)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const createUser = db.transaction(({ username, displayName, password, isAdmin = 0, headline = '' }) => {
  const ts = now();
  const info = insertUser.run(
    String(username).trim(),
    String(displayName || username).trim().slice(0, 60),
    hashPassword(password),
    isAdmin ? 1 : 0,
    ts,
    ts,
    String(headline).slice(0, 200)
  );
  const id = info.lastInsertRowid;
  db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(id);
  db.prepare('INSERT INTO layouts (user_id) VALUES (?)').run(id);
  return id;
});

/** Everybody gets Tom, and Tom gets everybody. It's the law. */
function befriendTom(userId) {
  const tomId = Number(setting('tom_id', 0));
  if (!tomId || tomId === userId) return;
  const ts = now();
  db.prepare(`
    INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status, created_at, accepted_at)
    VALUES (?, ?, 'accepted', ?, ?)
  `).run(tomId, userId, ts, ts);

  // Tom lands in the new user's top friends at the end of the row.
  const nextPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM top_friends WHERE owner_id = ?').get(userId).p;
  db.prepare('INSERT OR IGNORE INTO top_friends (owner_id, friend_id, position) VALUES (?, ?, ?)')
    .run(userId, tomId, nextPos);

  const welcome = setting(
    'welcome_message',
    "Hey — welcome to the space.\n\nSet up your profile, pick your song, wreck your layout with custom CSS, and rank your Top 8 (or Top 3, or Top 24 — it's your call).\n\nIf you need anything, message me.\n\n– Tom"
  );
  db.prepare(`
    INSERT INTO messages (sender_id, recipient_id, subject, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tomId, userId, 'Welcome to the space!', welcome, ts);
}

function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
}

function profileOf(userId) {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId)
    || db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
}

function layoutOf(userId) {
  let l = db.prepare('SELECT * FROM layouts WHERE user_id = ?').get(userId);
  if (!l) {
    db.prepare('INSERT INTO layouts (user_id) VALUES (?)').run(userId);
    l = db.prepare('SELECT * FROM layouts WHERE user_id = ?').get(userId);
  }
  return l;
}

module.exports = { createUser, befriendTom, usernameError, passwordError, findByUsername, profileOf, layoutOf, RESERVED };
