'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { richHtml, plain } = require('../lib/sanitize');
const { imageUpload } = require('../lib/upload');
const u = require('../lib/util');

const router = express.Router();
router.use(requireLogin);

function membership(groupId, userId) {
  return db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}

function loadGroup(req, res, next) {
  const g = db.prepare('SELECT * FROM groups WHERE slug = ?').get(req.params.slug);
  // next('route') — a plain next() would fall through to this route's own
  // handler with req.group still undefined.
  if (!g) return next('route');
  req.group = g;
  req.member = membership(g.id, req.user.id);
  if (g.privacy === 'private' && !req.member && !req.user.is_admin) {
    return res.status(403).render('error', { title: 'Private group', message: 'You need an invite for that one.' });
  }
  next();
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT g.*, o.username AS owner_username, o.display_name AS owner_name,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
      (SELECT COUNT(*) FROM topics t WHERE t.group_id = g.id) AS topics,
      (SELECT MAX(bumped_at) FROM topics t WHERE t.group_id = g.id) AS last_at
    FROM groups g JOIN users o ON o.id = g.owner_id
    ORDER BY COALESCE(last_at, g.created_at) DESC
  `).all();
  const mine = new Set(
    db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(req.user.id).map((r) => r.group_id)
  );
  res.render('groups', { title: 'Groups', nav: 'groups', rows, mine });
});

router.get('/new', (req, res) => {
  res.render('group-new', { title: 'Create a Group', nav: 'groups' });
});

router.post('/new', imageUpload.single('icon'), (req, res) => {
  const name = plain(req.body.name, 60).trim();
  if (!name) return res.redirect('/groups/new?err=' + encodeURIComponent('Name it something.'));
  let slug = u.slugify(name);
  let n = 1;
  while (db.prepare('SELECT 1 FROM groups WHERE slug = ?').get(slug)) slug = `${u.slugify(name)}-${++n}`;

  const ts = now();
  const id = db.prepare(`
    INSERT INTO groups (slug, name, description, icon, owner_id, privacy, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug, name, plain(req.body.description, 500), req.file ? req.file.filename : null,
    req.user.id, u.pick(req.body.privacy, ['open', 'private'], 'open'), ts
  ).lastInsertRowid;
  db.prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
    .run(id, req.user.id, ts);
  res.redirect('/groups/' + slug);
});

router.get('/:slug', loadGroup, (req, res) => {
  const g = req.group;
  const topics = db.prepare(`
    SELECT t.*, a.username, a.display_name, a.avatar,
      (SELECT COUNT(*) FROM posts p WHERE p.topic_id = t.id) AS replies,
      (SELECT MAX(created_at) FROM posts p WHERE p.topic_id = t.id) AS last_post
    FROM topics t JOIN users a ON a.id = t.author_id
    WHERE t.group_id = ? ORDER BY t.pinned DESC, t.bumped_at DESC LIMIT 100
  `).all(g.id);
  const members = db.prepare(`
    SELECT us.*, m.role FROM group_members m JOIN users us ON us.id = m.user_id
    WHERE m.group_id = ? ORDER BY m.joined_at
  `).all(g.id);
  res.render('group', { title: g.name, nav: 'groups', g, topics, members, member: req.member });
});

router.post('/:slug/join', loadGroup, (req, res) => {
  db.prepare("INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
    .run(req.group.id, req.user.id, now());
  res.redirect('/groups/' + req.group.slug);
});

router.post('/:slug/leave', loadGroup, (req, res) => {
  if (req.group.owner_id === req.user.id) {
    return res.redirect('/groups/' + req.group.slug + '?err=' + encodeURIComponent('Owners cannot leave. Delete the group instead.'));
  }
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.group.id, req.user.id);
  res.redirect('/groups');
});

router.post('/:slug/delete', loadGroup, (req, res) => {
  if (req.group.owner_id !== req.user.id && !req.user.is_admin) return res.status(403).send('Not yours.');
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.group.id);
  res.redirect('/groups?msg=' + encodeURIComponent('Group deleted.'));
});

router.post('/:slug/topic', loadGroup, (req, res) => {
  if (!req.member) return res.redirect('/groups/' + req.group.slug + '?err=' + encodeURIComponent('Join the group first.'));
  const title = plain(req.body.title, 150).trim();
  const body = richHtml(String(req.body.body || '').slice(0, 40000)).trim();
  if (!title || !body) return res.redirect('/groups/' + req.group.slug + '?err=' + encodeURIComponent('Title and body, please.'));

  const ts = now();
  const tid = db.prepare('INSERT INTO topics (group_id, author_id, title, created_at, bumped_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.group.id, req.user.id, title, ts, ts).lastInsertRowid;
  db.prepare('INSERT INTO posts (topic_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(tid, req.user.id, body, ts);

  const others = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id <> ?')
    .all(req.group.id, req.user.id);
  for (const m of others) {
    u.notify(m.user_id, {
      actorId: req.user.id, kind: 'topic',
      text: `${req.user.display_name} started "${title}" in ${req.group.name}`,
      url: `/groups/${req.group.slug}/t/${tid}`,
    });
  }
  res.redirect(`/groups/${req.group.slug}/t/${tid}`);
});

router.get('/:slug/t/:tid', loadGroup, (req, res, next) => {
  const t = db.prepare(`
    SELECT t.*, a.username, a.display_name FROM topics t JOIN users a ON a.id = t.author_id
    WHERE t.id = ? AND t.group_id = ?
  `).get(req.params.tid, req.group.id);
  if (!t) return next();
  const posts = db.prepare(`
    SELECT p.*, a.username, a.display_name, a.avatar, a.headline FROM posts p
    JOIN users a ON a.id = p.author_id WHERE p.topic_id = ? ORDER BY p.created_at
  `).all(t.id);
  res.render('topic', { title: t.title, nav: 'groups', g: req.group, t, posts, member: req.member });
});

router.post('/:slug/t/:tid/reply', loadGroup, (req, res, next) => {
  const t = db.prepare('SELECT * FROM topics WHERE id = ? AND group_id = ?').get(req.params.tid, req.group.id);
  if (!t) return next();
  if (t.locked && !req.user.is_admin) return res.redirect(`/groups/${req.group.slug}/t/${t.id}?err=` + encodeURIComponent('Topic is locked.'));
  if (!req.member) return res.redirect(`/groups/${req.group.slug}?err=` + encodeURIComponent('Join the group first.'));

  const body = richHtml(String(req.body.body || '').slice(0, 40000)).trim();
  if (!body) return res.redirect(`/groups/${req.group.slug}/t/${t.id}`);
  const ts = now();
  db.prepare('INSERT INTO posts (topic_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(t.id, req.user.id, body, ts);
  db.prepare('UPDATE topics SET bumped_at = ? WHERE id = ?').run(ts, t.id);

  const participants = db.prepare('SELECT DISTINCT author_id FROM posts WHERE topic_id = ? AND author_id <> ?')
    .all(t.id, req.user.id);
  for (const p of participants) {
    u.notify(p.author_id, {
      actorId: req.user.id, kind: 'reply',
      text: `${req.user.display_name} replied in "${t.title}"`,
      url: `/groups/${req.group.slug}/t/${t.id}`,
    });
  }
  res.redirect(`/groups/${req.group.slug}/t/${t.id}#bottom`);
});

router.post('/:slug/t/:tid/pin', loadGroup, (req, res) => {
  if (req.group.owner_id !== req.user.id && !req.user.is_admin) return res.status(403).send('No.');
  db.prepare('UPDATE topics SET pinned = 1 - pinned WHERE id = ? AND group_id = ?').run(req.params.tid, req.group.id);
  res.redirect(`/groups/${req.group.slug}/t/${req.params.tid}`);
});

router.post('/:slug/t/:tid/lock', loadGroup, (req, res) => {
  if (req.group.owner_id !== req.user.id && !req.user.is_admin) return res.status(403).send('No.');
  db.prepare('UPDATE topics SET locked = 1 - locked WHERE id = ? AND group_id = ?').run(req.params.tid, req.group.id);
  res.redirect(`/groups/${req.group.slug}/t/${req.params.tid}`);
});

router.post('/:slug/t/:tid/delete', loadGroup, (req, res) => {
  const t = db.prepare('SELECT * FROM topics WHERE id = ? AND group_id = ?').get(req.params.tid, req.group.id);
  if (!t) return res.redirect('/groups/' + req.group.slug);
  if (t.author_id !== req.user.id && req.group.owner_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).send('Not yours.');
  }
  db.prepare('DELETE FROM topics WHERE id = ?').run(t.id);
  res.redirect('/groups/' + req.group.slug);
});

module.exports = router;
