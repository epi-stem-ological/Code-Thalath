'use strict';

const crypto = require('crypto');
const { db, now } = require('./db');

const SESSION_COOKIE = 'tspace_sid';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 60; // 60 days — phones shouldn't get logged out

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const insertSession = db.prepare(
  'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'
);
const findSession = db.prepare('SELECT * FROM sessions WHERE id = ?');
const dropSession = db.prepare('DELETE FROM sessions WHERE id = ?');
const dropExpired = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
const findUser = db.prepare('SELECT * FROM users WHERE id = ?');
const touchSeen = db.prepare('UPDATE users SET last_seen = ? WHERE id = ?');

function createSession(res, userId, userAgent = '') {
  const id = crypto.randomBytes(32).toString('hex');
  const ts = now();
  insertSession.run(id, userId, ts, ts + SESSION_TTL, String(userAgent).slice(0, 300));
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIES === '1',
    maxAge: SESSION_TTL,
    path: '/',
  });
  return id;
}

function destroySession(req, res) {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) dropSession.run(sid);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

let lastSweep = 0;
function loadUser(req, res, next) {
  if (now() - lastSweep > 3600_000) {
    lastSweep = now();
    dropExpired.run(now());
  }
  req.user = null;
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) {
    const sess = findSession.get(sid);
    if (sess && sess.expires_at > now()) {
      const user = findUser.get(sess.user_id);
      if (user && !user.disabled) {
        req.user = user;
        req.sessionId = sid;
        if (!user.last_seen || now() - user.last_seen > 60_000) {
          touchSeen.run(now(), user.id);
          user.last_seen = now();
        }
      }
    } else if (sess) {
      dropSession.run(sid);
    }
  }
  res.locals.me = req.user;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (req.accepts('html')) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    return res.status(401).json({ error: 'login required' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).render('error', { title: 'No.', message: 'Admins only.' });
  next();
}

// --- CSRF: double-submit token bound to the session id -----------------------
function csrfToken(req) {
  const sid = req.sessionId || req.cookies?.[SESSION_COOKIE] || 'anon';
  return crypto.createHmac('sha256', csrfSecret()).update(sid).digest('hex').slice(0, 32);
}

let _csrfSecret = null;
function csrfSecret() {
  if (_csrfSecret) return _csrfSecret;
  const { setting, setSetting } = require('./db');
  let s = setting('csrf_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('csrf_secret', s);
  }
  _csrfSecret = s;
  return s;
}

function tokenOk(req) {
  const sent = req.body?._csrf || req.get('x-csrf-token');
  return !!sent && sent === csrfToken(req);
}

function checkCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user) return next(); // login/register are rate-limited instead

  // Multipart bodies aren't parsed yet — multer runs inside the route. Defer
  // to csrfAfterUpload(), which every uploader middleware chain includes.
  if ((req.get('content-type') || '').startsWith('multipart/form-data')) {
    req.csrfDeferred = true;
    return next();
  }
  if (tokenOk(req)) return next();
  return res.status(403).send('Bad or missing CSRF token. Go back and try again.');
}

/** Second half of the multipart CSRF check; runs immediately after multer. */
function csrfAfterUpload(req, res, next) {
  if (!req.csrfDeferred) return next();
  req.csrfDeferred = false;
  if (tokenOk(req)) return next();

  // The bytes already hit disk during parsing — don't leave them there.
  const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [];
  if (req.file) files.push(req.file);
  const { removeUpload } = require('./upload');
  for (const f of files) removeUpload(f.filename);

  return res.status(403).send('Bad or missing CSRF token. Go back and try again.');
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  loadUser,
  requireLogin,
  requireAdmin,
  csrfToken,
  checkCsrf,
  csrfAfterUpload,
};
