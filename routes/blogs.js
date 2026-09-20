'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { findByUsername } = require('../lib/users');
const { richHtml, plain } = require('../lib/sanitize');
const { BLOG_CATEGORIES } = require('../lib/themes');
const u = require('../lib/util');

const router = express.Router();
router.use(requireLogin);

function canRead(entry, viewerId) {
  if (entry.author_id === viewerId) return true;
  if (entry.privacy === 'private') return false;
  if (entry.privacy === 'friends') return u.areFriends(viewerId, entry.author_id);
  return true; // 'everyone'
}

router.get('/', (req, res) => {
  const fids = u.friendIds(req.user.id).concat(req.user.id);
  const inList = fids.join(',') || '-1';
  const rows = db.prepare(`
    SELECT b.*, a.username, a.display_name, a.avatar,
      (SELECT COUNT(*) FROM blog_comments c WHERE c.blog_id = b.id) AS comment_count,
      (SELECT COUNT(*) FROM blog_kudos k WHERE k.blog_id = b.id) AS kudos
    FROM blogs b JOIN users a ON a.id = b.author_id
    WHERE b.author_id IN (${inList}) AND (b.privacy <> 'private' OR b.author_id = ?)
    ORDER BY b.created_at DESC LIMIT 40
  `).all(req.user.id);
  res.render('blog-list', { title: 'Blogs', nav: 'blog', rows, user: null, categories: BLOG_CATEGORIES });
});

router.get('/new', (req, res) => {
  res.render('blog-edit', {
    title: 'Post a Blog', nav: 'blog', entry: null, categories: BLOG_CATEGORIES, moods: u.MOODS,
  });
});

router.post('/new', (req, res) => {
  const title = plain(req.body.title, 200) || '(untitled)';
  const body = richHtml(String(req.body.body || '').slice(0, 200000)).trim();
  if (!body) return res.redirect('/blog/new?err=' + encodeURIComponent('Write something.'));
  const id = db.prepare(`
    INSERT INTO blogs (author_id, title, body, mood, category, privacy, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, title, body,
    plain(req.body.mood, 40),
    BLOG_CATEGORIES.includes(req.body.category) ? req.body.category : 'Life',
    u.pick(req.body.privacy, ['everyone', 'friends', 'private'], 'friends'),
    now()
  ).lastInsertRowid;

  if (req.body.privacy !== 'private') {
    for (const fid of u.friendIds(req.user.id)) {
      u.notify(fid, {
        actorId: req.user.id, kind: 'blog',
        text: `${req.user.display_name} posted a blog: ${title}`,
        url: '/blog/entry/' + id,
      });
    }
  }
  res.redirect('/blog/entry/' + id);
});

router.get('/entry/:id', (req, res, next) => {
  const e = db.prepare(`
    SELECT b.*, a.username, a.display_name, a.avatar FROM blogs b
    JOIN users a ON a.id = b.author_id WHERE b.id = ?
  `).get(req.params.id);
  if (!e || !canRead(e, req.user.id)) return next();

  const comments = db.prepare(`
    SELECT c.*, a.username, a.display_name, a.avatar FROM blog_comments c
    JOIN users a ON a.id = c.author_id WHERE c.blog_id = ? ORDER BY c.created_at
  `).all(e.id);
  const kudos = db.prepare('SELECT COUNT(*) c FROM blog_kudos WHERE blog_id = ?').get(e.id).c;
  const gaveKudos = !!db.prepare('SELECT 1 FROM blog_kudos WHERE blog_id = ? AND user_id = ?').get(e.id, req.user.id);

  res.render('blog-read', { title: e.title, nav: 'blog', e, comments, kudos, gaveKudos });
});

router.get('/entry/:id/edit', (req, res, next) => {
  const e = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!e || e.author_id !== req.user.id) return next();
  res.render('blog-edit', { title: 'Edit Blog', nav: 'blog', entry: e, categories: BLOG_CATEGORIES, moods: u.MOODS });
});

router.post('/entry/:id/edit', (req, res, next) => {
  const e = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!e || e.author_id !== req.user.id) return next();
  db.prepare(`
    UPDATE blogs SET title = ?, body = ?, mood = ?, category = ?, privacy = ?, updated_at = ? WHERE id = ?
  `).run(
    plain(req.body.title, 200) || '(untitled)',
    richHtml(String(req.body.body || '').slice(0, 200000)),
    plain(req.body.mood, 40),
    BLOG_CATEGORIES.includes(req.body.category) ? req.body.category : 'Life',
    u.pick(req.body.privacy, ['everyone', 'friends', 'private'], 'friends'),
    now(), e.id
  );
  res.redirect('/blog/entry/' + e.id);
});

router.post('/entry/:id/delete', (req, res) => {
  const e = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!e) return res.redirect('/blog');
  if (e.author_id !== req.user.id && !req.user.is_admin) return res.status(403).send('Not yours.');
  db.prepare('DELETE FROM blogs WHERE id = ?').run(e.id);
  res.redirect('/blog?msg=' + encodeURIComponent('Entry deleted.'));
});

router.post('/entry/:id/comment', (req, res, next) => {
  const e = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!e || !canRead(e, req.user.id)) return next();
  const body = richHtml(String(req.body.body || '').slice(0, 8000)).trim();
  if (body) {
    db.prepare('INSERT INTO blog_comments (blog_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(e.id, req.user.id, body, now());
    u.notify(e.author_id, {
      actorId: req.user.id, kind: 'blog_comment',
      text: `${req.user.display_name} commented on "${e.title}"`,
      url: '/blog/entry/' + e.id,
    });
  }
  res.redirect('/blog/entry/' + e.id + '#comments');
});

router.post('/entry/:id/kudos', (req, res, next) => {
  const e = db.prepare('SELECT * FROM blogs WHERE id = ?').get(req.params.id);
  if (!e || !canRead(e, req.user.id)) return next();
  const had = db.prepare('SELECT 1 FROM blog_kudos WHERE blog_id = ? AND user_id = ?').get(e.id, req.user.id);
  if (had) {
    db.prepare('DELETE FROM blog_kudos WHERE blog_id = ? AND user_id = ?').run(e.id, req.user.id);
  } else {
    db.prepare('INSERT INTO blog_kudos (blog_id, user_id) VALUES (?, ?)').run(e.id, req.user.id);
    u.notify(e.author_id, {
      actorId: req.user.id, kind: 'kudos',
      text: `${req.user.display_name} gave kudos to "${e.title}"`,
      url: '/blog/entry/' + e.id,
    });
  }
  res.redirect('/blog/entry/' + e.id);
});

router.post('/comment/:id/delete', (req, res) => {
  const c = db.prepare('SELECT c.*, b.author_id AS blog_author FROM blog_comments c JOIN blogs b ON b.id = c.blog_id WHERE c.id = ?')
    .get(req.params.id);
  if (!c) return res.redirect('/blog');
  if (c.author_id !== req.user.id && c.blog_author !== req.user.id && !req.user.is_admin) {
    return res.status(403).send('Not yours.');
  }
  db.prepare('DELETE FROM blog_comments WHERE id = ?').run(c.id);
  res.redirect('/blog/entry/' + c.blog_id + '#comments');
});

router.get('/:username', (req, res, next) => {
  const user = findByUsername(req.params.username);
  if (!user) return next();
  const mine = user.id === req.user.id;
  const rows = db.prepare(`
    SELECT b.*, a.username, a.display_name, a.avatar,
      (SELECT COUNT(*) FROM blog_comments c WHERE c.blog_id = b.id) AS comment_count,
      (SELECT COUNT(*) FROM blog_kudos k WHERE k.blog_id = b.id) AS kudos
    FROM blogs b JOIN users a ON a.id = b.author_id
    WHERE b.author_id = ? ORDER BY b.created_at DESC LIMIT 100
  `).all(user.id).filter((e) => canRead(e, req.user.id));
  res.render('blog-list', {
    title: `${user.display_name}'s Blog`, nav: 'blog', rows, user, mine, categories: BLOG_CATEGORIES,
  });
});

module.exports = router;
