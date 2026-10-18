'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const { db, setting } = require('./lib/db');
const { loadUser, checkCsrf, csrfToken } = require('./lib/auth');
const util = require('./lib/util');
const { UPLOAD_DIR } = require('./lib/upload');
const themes = require('./lib/themes');
const { ensureSeed } = require('./lib/seed');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Headers for an internet-facing origin. No global CSP script/style lockdown:
// inline styles are the entire point of a MySpace profile. What is worth
// locking down is everything else — framing, plugins, <base> injection and
// where forms may post.
const PUBLIC_UPLOADS = process.env.PUBLIC_UPLOADS === '1';
const SITE_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self'",
  // Only our own sandboxed game frames. Never a third-party origin: an
  // embedded frame runs that site's code in front of every member who visits.
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', SITE_CSP);
  if (process.env.SECURE_COOKIES === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

/**
 * Member-facing games. These are framed with sandbox="allow-scripts" and no
 * allow-same-origin, so the frame already runs in an opaque origin and cannot
 * reach cookies or the surrounding page. This policy is the second half: it
 * stops a game making any request off this server, so it cannot report who
 * played it or pull in code we have not seen.
 */
app.use('/play', express.static(path.join(__dirname, 'public', 'play'), {
  maxAge: '1h',
  index: 'index.html',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // games bundle their own
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'none'",        // no phoning home, no leaderboards elsewhere
      "frame-ancestors 'self'",    // only our pages may embed it
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; '));
  },
}));

// Static site assets carry no secrets and need no session lookup.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use(loadUser);

/**
 * Uploads are members-only by default. Filenames are unguessable, but once the
 * site is on a public hostname "unguessable" is the only thing standing between
 * a leaked URL and everyone's photos — so require a session instead.
 * Set PUBLIC_UPLOADS=1 to serve them openly and let a CDN cache them.
 */
app.use('/uploads', (req, res, next) => {
  if (PUBLIC_UPLOADS || req.user) return next();
  res.status(404).end();
}, express.static(UPLOAD_DIR, {
  maxAge: '30d',
  setHeaders: (res) => {
    // user content — never let a browser sniff it into something executable
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader(
      'Cache-Control',
      PUBLIC_UPLOADS ? 'public, max-age=2592000' : 'private, max-age=2592000'
    );
  },
}));

// Template globals -----------------------------------------------------------
app.use((req, res, next) => {
  res.locals.siteName = setting('site_name', process.env.SITE_NAME || 'Thalath Space');
  res.locals.tagline = setting('tagline', 'a place for friends');
  res.locals.path = req.path;
  res.locals.host = req.get('host') || '';
  res.locals.query = req.query;
  res.locals.u = util;
  res.locals.themes = themes;
  res.locals.csrf = csrfToken(req);
  res.locals.counts = util.unreadCounts(req.user?.id);
  res.locals.nav = '';
  res.locals.flash = req.query.msg || '';
  res.locals.flashErr = req.query.err || '';
  res.locals.title = res.locals.siteName;
  next();
});

app.use(checkCsrf);

// Routes ---------------------------------------------------------------------
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/home'));
app.use('/', require('./routes/invite'));
app.use('/', require('./routes/profile'));
app.use('/', require('./routes/friends'));
app.use('/mail', require('./routes/mail'));
app.use('/im', require('./routes/im'));
app.use('/bulletins', require('./routes/bulletins'));
app.use('/blog', require('./routes/blogs'));
app.use('/groups', require('./routes/groups'));
app.use('/photos', require('./routes/photos'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/pwa'));

// 404 + errors ---------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Sorry! An unexpected error has occurred.',
    message: `This user has either cancelled their account, or the page you requested does not exist. (${util.escapeHtml(req.path)})`,
  });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is too big.'
      : 'That file type is not allowed here.';
    return res.status(400).render('error', { title: 'Upload failed', message: msg });
  }
  console.error(err);
  res.status(500).render('error', {
    title: 'Sorry! An unexpected error has occurred.',
    message: process.env.NODE_ENV === 'production' ? 'Something broke. Try again.' : String(err.stack || err),
  });
});

ensureSeed();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`\n  ${res_siteName()} is up:  http://localhost:${PORT}\n`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Set PORT=… and try again.\n`);
    process.exit(1);
  }
  throw err;
});
server.headersTimeout = 0;
server.requestTimeout = 0;

function res_siteName() {
  return setting('site_name', process.env.SITE_NAME || 'Thalath Space');
}

process.on('SIGTERM', () => server.close(() => db.close()));
process.on('SIGINT', () => server.close(() => { db.close(); process.exit(0); }));

module.exports = app;
