'use strict';

const express = require('express');
const { db, now, setting } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { getKeys } = require('../lib/push');
const { profileCss } = require('../lib/profilecss');
const { layoutOf } = require('../lib/users');
const { FONTS, CURSORS, THEMES } = require('../lib/themes');
const { cssValue } = require('../lib/sanitize');
const u = require('../lib/util');

const router = express.Router();

router.get('/manifest.webmanifest', (req, res) => {
  const name = setting('site_name', process.env.SITE_NAME || 'Thalath Space');
  res.type('application/manifest+json').json({
    name,
    short_name: name.split(' ')[0],
    description: setting('tagline', 'a place for friends'),
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#e5e5e5',
    theme_color: '#6699cc',
    categories: ['social'],
    icons: [
      { src: '/img/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/img/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Mail', url: '/mail' },
      { name: 'IM', url: '/im' },
      { name: 'Bulletins', url: '/bulletins' },
      { name: 'My Profile', url: '/home' },
    ],
  });
});

router.get('/push/key', requireLogin, (req, res) => {
  res.json({ key: getKeys().publicKey });
});

router.post('/push/subscribe', requireLogin, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'bad subscription' });
  db.prepare(`
    INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(req.user.id, endpoint, keys.p256dh, keys.auth, now());
  res.json({ ok: true });
});

router.post('/push/unsubscribe', requireLogin, (req, res) => {
  db.prepare('DELETE FROM push_subs WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.post('/push/test', requireLogin, (req, res) => {
  require('../lib/push')
    .sendToUser(req.user.id, { title: 'Thalath Space', body: 'Push is working. 📟', url: '/home' })
    .catch(() => {});
  res.redirect('/settings?msg=' + encodeURIComponent('Test notification sent to this account.'));
});

/** Live CSS preview for the design editor. */
router.post('/edit/design/preview', requireLogin, (req, res) => {
  const b = req.body;
  const cur = layoutOf(req.user.id);
  let base = { ...cur };
  const themeWins = !!b.apply_theme && !!THEMES[b.theme];
  if (themeWins) base = { ...base, ...THEMES[b.theme] };

  // mirrors the save path: an applied theme overrides the posted colour inputs
  const val = (k, f) => cssValue(
    !themeWins && b[k] !== undefined && b[k] !== '' ? b[k] : base[k],
    f
  );
  const layout = {
    ...base,
    bg_color: val('bg_color', '#e5e5e5'),
    text_color: val('text_color', '#000000'),
    link_color: val('link_color', '#003399'),
    link_hover_color: val('link_hover_color', '#ff0000'),
    table_bg: val('table_bg', '#ffffff'),
    border_color: val('border_color', '#6699cc'),
    header_bg: val('header_bg', '#ff9933'),
    header_text: val('header_text', '#ffffff'),
    table_opacity: Math.max(0, Math.min(1,
      parseFloat(themeWins ? base.table_opacity : (b.table_opacity ?? base.table_opacity)) || 1)),
    font_family: !themeWins && FONTS.includes(b.font_family) ? b.font_family : base.font_family,
    font_size: themeWins
      ? base.font_size
      : u.pick(b.font_size, ['10px', '11px', '12px', '13px', '14px', '16px'], base.font_size),
    cursor_style: CURSORS.some(([v]) => v === b.cursor_style) ? String(b.cursor_style) : '',
    bg_repeat: u.pick(b.bg_repeat, ['repeat', 'no-repeat', 'repeat-x', 'repeat-y'], 'repeat'),
    bg_attachment: u.pick(b.bg_attachment, ['fixed', 'scroll'], 'fixed'),
    bg_size: u.pick(b.bg_size, ['auto', 'cover', 'contain', '100% 100%'], 'auto'),
    bg_position: u.pick(b.bg_position, ['center top', 'center center', 'left top', 'right top', 'center bottom'], 'center top'),
    custom_css: String(b.custom_css || '').slice(0, 60000),
    top_cols: parseInt(b.top_cols, 10) || cur.top_cols,
  };
  res.type('text/css').send(profileCss(layout));
});

module.exports = router;
