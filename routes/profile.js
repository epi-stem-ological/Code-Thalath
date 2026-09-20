'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { findByUsername, profileOf, layoutOf } = require('../lib/users');
const { richHtml, lightHtml, plain, cssValue, cssUrl } = require('../lib/sanitize');
const { profileCss } = require('../lib/profilecss');
const { imageUpload, audioUpload, removeUpload } = require('../lib/upload');
const { THEMES, CURSORS, FONTS, HERE_FOR } = require('../lib/themes');
const u = require('../lib/util');

const router = express.Router();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function topFriendsFor(userId, layout) {
  // Number(0) is falsy — a "Top 0" means hide the section, not fall back to 8.
  const raw = Number(layout.top_count);
  const count = Math.max(0, Math.min(64, Number.isFinite(raw) ? raw : 8));
  if (count === 0) return [];
  const picked = db.prepare(`
    SELECT u.*, t.position FROM top_friends t
    JOIN users u ON u.id = t.friend_id
    WHERE t.owner_id = ? AND u.disabled = 0
    ORDER BY t.position
    LIMIT ?
  `).all(userId, count);

  if (picked.length >= count) return picked;

  // Fill empty slots with the most recently active friends, MySpace-style.
  const have = new Set(picked.map((p) => p.id));
  const filler = u.friendList(userId).filter((f) => !have.has(f.id)).slice(0, count - picked.length);
  return picked.concat(filler);
}

function songSrc(profile) {
  const s = profile.song_url || '';
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[A-Za-z0-9._-]+$/.test(s)) return `/uploads/${s}`;
  return '';
}

function editorTabs(active) {
  return [
    ['/edit', 'Profile Info', 'info'],
    ['/edit/pic', 'Photo', 'pic'],
    ['/edit/song', 'Profile Song', 'song'],
    ['/edit/design', 'Design & Wallpaper', 'design'],
    ['/edit/top', 'Top Friends', 'top'],
  ].map(([href, label, key]) => ({ href, label, on: key === active }));
}

// ---------------------------------------------------------------------------
// view a profile
// ---------------------------------------------------------------------------

router.get('/u/:username', requireLogin, (req, res, next) => {
  const user = findByUsername(req.params.username);
  if (!user || user.disabled) return next();

  const profile = profileOf(user.id);
  const layout = layoutOf(user.id);
  const isMe = user.id === req.user.id;

  if (!isMe) {
    const recent = db.prepare(
      'SELECT 1 FROM profile_views WHERE profile_id = ? AND viewer_id = ? AND created_at > ?'
    ).get(user.id, req.user.id, now() - 60 * 60_000);
    if (!recent) {
      db.prepare('INSERT INTO profile_views (profile_id, viewer_id, created_at) VALUES (?, ?, ?)')
        .run(user.id, req.user.id, now());
      db.prepare('UPDATE users SET profile_views = profile_views + 1 WHERE id = ?').run(user.id);
      user.profile_views += 1;
    }
  }

  const comments = db.prepare(`
    SELECT c.*, a.username, a.display_name, a.avatar
    FROM comments c JOIN users a ON a.id = c.author_id
    WHERE c.profile_id = ? AND c.approved = 1
    ORDER BY c.created_at DESC LIMIT 12
  `).all(user.id);
  const commentTotal = db.prepare('SELECT COUNT(*) c FROM comments WHERE profile_id = ? AND approved = 1').get(user.id).c;

  const latestBlog = db.prepare(`
    SELECT * FROM blogs WHERE author_id = ? AND (privacy <> 'private' OR ? = 1)
    ORDER BY created_at DESC LIMIT 1
  `).get(user.id, isMe ? 1 : 0);

  const photos = db.prepare('SELECT * FROM photos WHERE user_id = ? ORDER BY created_at DESC LIMIT 6').all(user.id);
  const photoCount = db.prepare('SELECT COUNT(*) c FROM photos WHERE user_id = ?').get(user.id).c;

  res.render('profile', {
    title: user.display_name,
    nav: isMe ? 'profile' : '',
    bodyClass: 'profile-view',
    user,
    profile,
    layout,
    isMe,
    css: profileCss(layout),
    top: topFriendsFor(user.id, layout),
    friendCount: u.friendCount(user.id),
    friendState: u.friendship(req.user.id, user.id),
    comments,
    commentTotal,
    latestBlog,
    photos,
    photoCount,
    song: songSrc(profile),
    blurbs: {
      about: richHtml(profile.about_me),
      meet: richHtml(profile.like_to_meet),
      interests: richHtml(profile.interests),
      music: richHtml(profile.music),
      movies: richHtml(profile.movies),
      television: richHtml(profile.television),
      books: richHtml(profile.books),
      heroes: richHtml(profile.heroes),
    },
    headerHtml: richHtml(layout.custom_html_top),
    marquee: plain(layout.marquee_text, 300),
  });
});

router.get('/u/:username/comments', requireLogin, (req, res, next) => {
  const user = findByUsername(req.params.username);
  if (!user) return next();
  const page = Math.max(1, parseInt(req.query.p, 10) || 1);
  const per = 25;
  const total = db.prepare('SELECT COUNT(*) c FROM comments WHERE profile_id = ? AND approved = 1').get(user.id).c;
  const comments = db.prepare(`
    SELECT c.*, a.username, a.display_name, a.avatar
    FROM comments c JOIN users a ON a.id = c.author_id
    WHERE c.profile_id = ? AND c.approved = 1
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(user.id, per, (page - 1) * per);

  res.render('comments', {
    title: `${user.display_name}'s Comments`,
    nav: '', user, comments, page, per, total,
  });
});

router.post('/u/:username/comment', requireLogin, (req, res, next) => {
  const user = findByUsername(req.params.username);
  if (!user) return next();
  const body = richHtml(String(req.body.body || '').slice(0, 8000)).trim();
  if (!body) return res.redirect(`/u/${user.username}?err=` + encodeURIComponent('Say something first.'));

  const last = db.prepare(
    'SELECT created_at FROM comments WHERE author_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(req.user.id);
  if (last && now() - last.created_at < 3000) {
    return res.redirect(`/u/${user.username}?err=` + encodeURIComponent('Slow down a second.'));
  }

  db.prepare('INSERT INTO comments (profile_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(user.id, req.user.id, body, now());
  u.notify(user.id, {
    actorId: req.user.id,
    kind: 'comment',
    text: `${req.user.display_name} left you a comment`,
    url: `/u/${user.username}#comments`,
  });
  res.redirect(`/u/${user.username}#comments`);
});

router.post('/comment/:id/delete', requireLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/home');
  if (c.profile_id !== req.user.id && c.author_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).send('Not yours to delete.');
  }
  const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(c.profile_id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.redirect(`/u/${owner ? owner.username : ''}#comments`);
});

router.get('/viewers', requireLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT v.created_at, u.* FROM profile_views v
    JOIN users u ON u.id = v.viewer_id
    WHERE v.profile_id = ?
    ORDER BY v.created_at DESC LIMIT 100
  `).all(req.user.id);
  res.render('viewers', { title: 'Who Viewed Me', nav: '', rows });
});

// ---------------------------------------------------------------------------
// edit: profile info
// ---------------------------------------------------------------------------

router.get('/edit', requireLogin, (req, res) => {
  res.render('edit-info', {
    title: 'Edit Profile',
    nav: 'edit',
    tabs: editorTabs('info'),
    profile: profileOf(req.user.id),
    hereFor: HERE_FOR,
    moods: u.MOODS,
  });
});

router.post('/edit', requireLogin, (req, res) => {
  const b = req.body;
  const blurb = (v, max = 20000) => richHtml(String(v || '').slice(0, max));
  const line = (v, max = 200) => plain(v, max);

  db.prepare('UPDATE users SET display_name = ?, headline = ?, mood = ?, mood_emoji = ? WHERE id = ?').run(
    line(b.display_name, 60) || req.user.username,
    lightHtml(String(b.headline || '').slice(0, 300)),
    line(b.mood, 40),
    line(b.mood_emoji, 8),
    req.user.id
  );

  db.prepare(`
    UPDATE profiles SET
      about_me = @about_me, like_to_meet = @like_to_meet, interests = @interests, music = @music,
      movies = @movies, television = @television, books = @books, heroes = @heroes,
      status = @status, here_for = @here_for, birthday = @birthday, show_age = @show_age,
      zodiac = @zodiac, hometown = @hometown, location = @location, occupation = @occupation,
      education = @education, religion = @religion, ethnicity = @ethnicity, children = @children,
      smoke_drink = @smoke_drink, income = @income
    WHERE user_id = @user_id
  `).run({
    about_me: blurb(b.about_me),
    like_to_meet: blurb(b.like_to_meet),
    interests: blurb(b.interests, 6000),
    music: blurb(b.music, 6000),
    movies: blurb(b.movies, 6000),
    television: blurb(b.television, 6000),
    books: blurb(b.books, 6000),
    heroes: blurb(b.heroes, 6000),
    status: line(b.status, 80),
    here_for: Array.isArray(b.here_for) ? b.here_for.map((x) => line(x, 40)).join(', ') : line(b.here_for, 120),
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthday || '')) ? String(b.birthday) : '',
    show_age: b.show_age ? 1 : 0,
    zodiac: u.zodiacFor(b.birthday) || line(b.zodiac, 20),
    hometown: line(b.hometown, 80),
    location: line(b.location, 80),
    occupation: line(b.occupation, 80),
    education: line(b.education, 80),
    religion: line(b.religion, 80),
    ethnicity: line(b.ethnicity, 80),
    children: line(b.children, 80),
    smoke_drink: line(b.smoke_drink, 80),
    income: line(b.income, 80),
    user_id: req.user.id,
  });

  res.redirect('/edit?msg=' + encodeURIComponent('Profile saved.'));
});

// ---------------------------------------------------------------------------
// edit: photo
// ---------------------------------------------------------------------------

router.get('/edit/pic', requireLogin, (req, res) => {
  res.render('edit-pic', {
    title: 'Profile Photo',
    nav: 'edit',
    tabs: editorTabs('pic'),
    photos: db.prepare('SELECT * FROM photos WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id),
  });
});

router.post('/edit/pic', requireLogin, imageUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.redirect('/edit/pic?err=' + encodeURIComponent('Pick an image first.'));
  const old = req.user.avatar;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(req.file.filename, req.user.id);
  db.prepare('INSERT INTO photos (user_id, file, caption, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, req.file.filename, 'Profile picture', now());
  if (old) {
    const stillUsed = db.prepare('SELECT 1 FROM photos WHERE file = ?').get(old);
    if (!stillUsed) removeUpload(old);
  }
  res.redirect('/edit/pic?msg=' + encodeURIComponent('Default picture updated.'));
});

router.post('/edit/pic/use/:photoId', requireLogin, (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?').get(req.params.photoId, req.user.id);
  if (!p) return res.redirect('/edit/pic?err=' + encodeURIComponent('No such photo.'));
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(p.file, req.user.id);
  res.redirect('/edit/pic?msg=' + encodeURIComponent('Default picture updated.'));
});

router.post('/edit/pic/remove', requireLogin, (req, res) => {
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
  res.redirect('/edit/pic?msg=' + encodeURIComponent('Back to the little grey guy.'));
});

// ---------------------------------------------------------------------------
// edit: profile song
// ---------------------------------------------------------------------------

router.get('/edit/song', requireLogin, (req, res) => {
  res.render('edit-song', {
    title: 'Profile Song',
    nav: 'edit',
    tabs: editorTabs('song'),
    profile: profileOf(req.user.id),
  });
});

router.post('/edit/song', requireLogin, audioUpload.single('songfile'), (req, res) => {
  const prof = profileOf(req.user.id);
  let url = prof.song_url;

  if (req.file) {
    if (url && /^[A-Za-z0-9._-]+$/.test(url)) removeUpload(url);
    url = req.file.filename;
  } else if (typeof req.body.song_url === 'string' && req.body.song_url.trim() !== '') {
    const link = cssUrl(req.body.song_url.trim());
    if (!link) return res.redirect('/edit/song?err=' + encodeURIComponent('That link does not look like a direct audio URL.'));
    if (url && /^[A-Za-z0-9._-]+$/.test(url)) removeUpload(url);
    url = link;
  }

  db.prepare('UPDATE profiles SET song_title = ?, song_artist = ?, song_url = ?, song_autoplay = ? WHERE user_id = ?')
    .run(
      plain(req.body.song_title, 120),
      plain(req.body.song_artist, 120),
      url || '',
      req.body.song_autoplay ? 1 : 0,
      req.user.id
    );
  res.redirect('/edit/song?msg=' + encodeURIComponent('Song saved. Go look at your profile.'));
});

router.post('/edit/song/remove', requireLogin, (req, res) => {
  const prof = profileOf(req.user.id);
  if (prof.song_url && /^[A-Za-z0-9._-]+$/.test(prof.song_url)) removeUpload(prof.song_url);
  db.prepare("UPDATE profiles SET song_url = '', song_title = '', song_artist = '' WHERE user_id = ?").run(req.user.id);
  res.redirect('/edit/song?msg=' + encodeURIComponent('Song removed.'));
});

// ---------------------------------------------------------------------------
// edit: design / wallpaper / custom CSS
// ---------------------------------------------------------------------------

router.get('/edit/design', requireLogin, (req, res) => {
  const layout = layoutOf(req.user.id);
  res.render('edit-design', {
    title: 'Design Your Profile',
    nav: 'edit',
    tabs: editorTabs('design'),
    layout,
    THEMES,
    CURSORS,
    FONTS,
    preview: profileCss(layout),
  });
});

router.post('/edit/design', requireLogin, imageUpload.single('wallpaper'), (req, res) => {
  const b = req.body;
  const cur = layoutOf(req.user.id);

  // "Apply theme" wins outright: the colour <input>s always submit a value, so
  // if the posted fields took priority the theme could never take effect.
  let base = { ...cur };
  const themeKey = String(b.theme || cur.theme);
  const themeWins = !!b.apply_theme && !!THEMES[themeKey];
  if (themeWins) {
    base = { ...base, ...THEMES[themeKey] };
    delete base.label;
  }

  let bgImage = cur.bg_image;
  if (req.file) {
    if (bgImage && /^[A-Za-z0-9._-]+$/.test(bgImage)) removeUpload(bgImage);
    bgImage = req.file.filename;
  } else if (b.remove_wallpaper) {
    if (bgImage && /^[A-Za-z0-9._-]+$/.test(bgImage)) removeUpload(bgImage);
    bgImage = '';
  } else if (typeof b.bg_image_url === 'string' && b.bg_image_url.trim()) {
    const link = cssUrl(b.bg_image_url.trim());
    if (link) {
      if (bgImage && /^[A-Za-z0-9._-]+$/.test(bgImage)) removeUpload(bgImage);
      bgImage = link;
    }
  }

  const val = (key, fallback) => cssValue(
    themeWins || b[key] === undefined ? base[key] : b[key],
    fallback
  );

  db.prepare(`
    UPDATE layouts SET
      theme = @theme, bg_color = @bg_color, bg_image = @bg_image, bg_repeat = @bg_repeat,
      bg_attachment = @bg_attachment, bg_size = @bg_size, bg_position = @bg_position,
      text_color = @text_color, link_color = @link_color, link_hover_color = @link_hover_color,
      table_bg = @table_bg, table_opacity = @table_opacity, border_color = @border_color,
      header_bg = @header_bg, header_text = @header_text, font_family = @font_family,
      font_size = @font_size, cursor_style = @cursor_style, custom_css = @custom_css,
      custom_html_top = @custom_html_top, marquee_text = @marquee_text, contact_style = @contact_style
    WHERE user_id = @user_id
  `).run({
    theme: THEMES[themeKey] ? themeKey : 'classic',
    bg_color: val('bg_color', '#e5e5e5'),
    bg_image: bgImage,
    bg_repeat: u.pick(b.bg_repeat, ['repeat', 'no-repeat', 'repeat-x', 'repeat-y'], 'repeat'),
    bg_attachment: u.pick(b.bg_attachment, ['fixed', 'scroll'], 'fixed'),
    bg_size: u.pick(b.bg_size, ['auto', 'cover', 'contain', '100% 100%'], 'auto'),
    bg_position: u.pick(b.bg_position, ['center top', 'center center', 'left top', 'right top', 'center bottom'], 'center top'),
    text_color: val('text_color', '#000000'),
    link_color: val('link_color', '#003399'),
    link_hover_color: val('link_hover_color', '#ff0000'),
    table_bg: val('table_bg', '#ffffff'),
    table_opacity: Math.max(0, Math.min(1,
      parseFloat(themeWins ? base.table_opacity : (b.table_opacity ?? base.table_opacity)) || 1)),
    border_color: val('border_color', '#6699cc'),
    header_bg: val('header_bg', '#ff9933'),
    header_text: val('header_text', '#ffffff'),
    font_family: !themeWins && FONTS.includes(b.font_family)
      ? b.font_family
      : cssValue(base.font_family, 'Verdana, Arial, sans-serif'),
    font_size: themeWins
      ? cssValue(base.font_size, '11px')
      : u.pick(b.font_size, ['10px', '11px', '12px', '13px', '14px', '16px'], '11px'),
    cursor_style: CURSORS.some(([v]) => v === b.cursor_style) ? String(b.cursor_style) : '',
    custom_css: String(b.custom_css || '').slice(0, 60000),
    custom_html_top: richHtml(String(b.custom_html_top || '').slice(0, 20000)),
    marquee_text: plain(b.marquee_text, 300),
    contact_style: u.pick(b.contact_style, ['classic', 'compact', 'icons'], 'classic'),
    user_id: req.user.id,
  });

  res.redirect('/edit/design?msg=' + encodeURIComponent('Layout saved.'));
});

router.post('/edit/design/reset', requireLogin, (req, res) => {
  const cur = layoutOf(req.user.id);
  if (cur.bg_image && /^[A-Za-z0-9._-]+$/.test(cur.bg_image)) removeUpload(cur.bg_image);
  db.prepare('DELETE FROM layouts WHERE user_id = ?').run(req.user.id);
  db.prepare('INSERT INTO layouts (user_id) VALUES (?)').run(req.user.id);
  res.redirect('/edit/design?msg=' + encodeURIComponent('Layout reset to factory MySpace.'));
});

// ---------------------------------------------------------------------------
// edit: top friends (Top 8, or Top whatever)
// ---------------------------------------------------------------------------

router.get('/edit/top', requireLogin, (req, res) => {
  const layout = layoutOf(req.user.id);
  const friends = u.friendList(req.user.id);
  const chosen = db.prepare(`
    SELECT u.*, t.position FROM top_friends t JOIN users u ON u.id = t.friend_id
    WHERE t.owner_id = ? ORDER BY t.position
  `).all(req.user.id);
  const chosenIds = new Set(chosen.map((c) => c.id));
  res.render('edit-top', {
    title: 'Top Friends',
    nav: 'edit',
    tabs: editorTabs('top'),
    layout,
    chosen,
    rest: friends.filter((f) => !chosenIds.has(f.id)),
  });
});

router.post('/edit/top', requireLogin, (req, res) => {
  const count = u.intIn(req.body.top_count, 0, 64, 8);
  const cols = u.intIn(req.body.top_cols, 1, 12, 4);
  db.prepare('UPDATE layouts SET top_count = ?, top_cols = ?, top_label = ? WHERE user_id = ?')
    .run(count, cols, plain(req.body.top_label, 60), req.user.id);

  let order = req.body.order;
  if (typeof order === 'string') order = order.split(',');
  if (Array.isArray(order)) {
    const ids = order.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n));
    const save = db.transaction(() => {
      db.prepare('DELETE FROM top_friends WHERE owner_id = ?').run(req.user.id);
      const ins = db.prepare('INSERT OR IGNORE INTO top_friends (owner_id, friend_id, position) VALUES (?, ?, ?)');
      let pos = 0;
      for (const id of ids) {
        if (id === req.user.id) continue;
        if (!u.areFriends(req.user.id, id)) continue;
        ins.run(req.user.id, id, pos++);
      }
    });
    save();
  }

  if (req.get('x-requested-with') === 'fetch') return res.json({ ok: true });
  res.redirect('/edit/top?msg=' + encodeURIComponent(`Saved. You're running a Top ${count}.`));
});

module.exports = router;
