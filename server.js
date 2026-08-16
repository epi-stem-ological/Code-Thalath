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

app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '30d',
  setHeaders: (res) => {
    // uploads are user content — never let the browser sniff them into scripts
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  },
}));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use(loadUser);

// Template globals -----------------------------------------------------------
app.use((req, res, next) => {
  res.locals.siteName = setting('site_name', process.env.SITE_NAME || 'Thalath Space');
  res.locals.tagline = setting('tagline', 'a place for friends');
  res.locals.path = req.path;
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
