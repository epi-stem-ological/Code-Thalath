'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { findByUsername } = require('../lib/users');
const { plain } = require('../lib/sanitize');
const u = require('../lib/util');

const router = express.Router();
router.use(requireLogin);

// thread id -> Set of { res, userId }
const streams = new Map();

function broadcast(threadId, payload) {
  const set = streams.get(threadId);
  if (!set) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of set) {
    try { c.res.write(data); } catch { set.delete(c); }
  }
}

function isMember(threadId, userId) {
  return !!db.prepare('SELECT 1 FROM im_members WHERE thread_id = ? AND user_id = ?').get(threadId, userId);
}

function threadsFor(userId) {
  const rows = db.prepare(`
    SELECT t.*, mem.last_read,
      (SELECT COUNT(*) FROM im_messages m WHERE m.thread_id = t.id AND m.id > mem.last_read AND m.author_id <> ?) AS unread,
      (SELECT body FROM im_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview,
      (SELECT created_at FROM im_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_at
    FROM im_threads t
    JOIN im_members mem ON mem.thread_id = t.id AND mem.user_id = ?
    ORDER BY COALESCE(last_at, t.created_at) DESC
  `).all(userId, userId);

  for (const t of rows) {
    t.others = db.prepare(`
      SELECT us.* FROM im_members m JOIN users us ON us.id = m.user_id
      WHERE m.thread_id = ? AND m.user_id <> ?
    `).all(t.id, userId);
    t.label = t.kind === 'group'
      ? (t.name || t.others.map((o) => o.display_name).join(', ') || 'Group chat')
      : (t.others[0] ? t.others[0].display_name : 'Empty chat');
  }
  return rows;
}

function findOrCreateDm(aId, bId) {
  const existing = db.prepare(`
    SELECT t.id FROM im_threads t
    JOIN im_members m1 ON m1.thread_id = t.id AND m1.user_id = ?
    JOIN im_members m2 ON m2.thread_id = t.id AND m2.user_id = ?
    WHERE t.kind = 'dm'
      AND (SELECT COUNT(*) FROM im_members mm WHERE mm.thread_id = t.id) = 2
    LIMIT 1
  `).get(aId, bId);
  if (existing) return existing.id;

  const create = db.transaction(() => {
    const ts = now();
    const id = db.prepare("INSERT INTO im_threads (kind, created_by, created_at, bumped_at) VALUES ('dm', ?, ?, ?)")
      .run(aId, ts, ts).lastInsertRowid;
    const ins = db.prepare('INSERT INTO im_members (thread_id, user_id, last_read) VALUES (?, ?, 0)');
    ins.run(id, aId);
    ins.run(id, bId);
    return id;
  });
  return create();
}

router.get('/', (req, res) => {
  const threads = threadsFor(req.user.id);
  if (threads.length) return res.redirect('/im/t/' + threads[0].id);
  res.render('im', {
    title: 'IM', nav: 'im', threads, thread: null, messages: [],
    friends: u.friendList(req.user.id),
  });
});

router.get('/with/:username', (req, res, next) => {
  const other = findByUsername(req.params.username);
  if (!other || other.id === req.user.id) return next();
  if (u.blockedBetween(req.user.id, other.id)) return res.redirect('/im?err=' + encodeURIComponent('Not available.'));
  res.redirect('/im/t/' + findOrCreateDm(req.user.id, other.id));
});

router.post('/new', (req, res) => {
  let ids = req.body.members;
  if (!Array.isArray(ids)) ids = ids ? [ids] : [];
  ids = ids.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n !== req.user.id);
  if (!ids.length) return res.redirect('/im?err=' + encodeURIComponent('Pick at least one person.'));

  if (ids.length === 1) return res.redirect('/im/t/' + findOrCreateDm(req.user.id, ids[0]));

  const name = plain(req.body.name, 60);
  const create = db.transaction(() => {
    const ts = now();
    const id = db.prepare("INSERT INTO im_threads (kind, name, created_by, created_at, bumped_at) VALUES ('group', ?, ?, ?, ?)")
      .run(name, req.user.id, ts, ts).lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO im_members (thread_id, user_id, last_read) VALUES (?, ?, 0)');
    ins.run(id, req.user.id);
    for (const m of ids) ins.run(id, m);
    return id;
  });
  res.redirect('/im/t/' + create());
});

router.get('/t/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!isMember(id, req.user.id)) return next();
  const thread = db.prepare('SELECT * FROM im_threads WHERE id = ?').get(id);
  const messages = db.prepare(`
    SELECT m.*, us.username, us.display_name, us.avatar FROM im_messages m
    JOIN users us ON us.id = m.author_id
    WHERE m.thread_id = ? ORDER BY m.id DESC LIMIT 200
  `).all(id).reverse();

  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  db.prepare('UPDATE im_members SET last_read = ? WHERE thread_id = ? AND user_id = ? AND last_read < ?')
    .run(lastId, id, req.user.id, lastId);

  const threads = threadsFor(req.user.id);
  const current = threads.find((t) => t.id === id);
  res.render('im', {
    title: current ? current.label : 'IM',
    nav: 'im',
    threads,
    thread: current || thread,
    messages,
    friends: u.friendList(req.user.id),
  });
});

router.post('/t/:id/send', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!isMember(id, req.user.id)) return res.status(403).json({ error: 'not a member' });
  const body = plain(req.body.body, 4000).trim();
  if (!body) {
    return req.get('x-requested-with') === 'fetch' ? res.json({ ok: true }) : res.redirect('/im/t/' + id);
  }
  const ts = now();
  const msgId = db.prepare('INSERT INTO im_messages (thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, body, ts).lastInsertRowid;
  db.prepare('UPDATE im_threads SET bumped_at = ? WHERE id = ?').run(ts, id);
  db.prepare('UPDATE im_members SET last_read = ? WHERE thread_id = ? AND user_id = ?').run(msgId, id, req.user.id);

  const payload = {
    id: msgId,
    author_id: req.user.id,
    username: req.user.username,
    display_name: req.user.display_name,
    avatar: req.user.avatar,
    body,
    created_at: ts,
  };
  broadcast(id, payload);

  // Push only to members who aren't currently watching this thread.
  const watching = new Set([...(streams.get(id) || [])].map((c) => c.userId));
  const members = db.prepare('SELECT user_id FROM im_members WHERE thread_id = ? AND user_id <> ?').all(id, req.user.id);
  for (const m of members) {
    if (watching.has(m.user_id)) continue;
    u.notify(m.user_id, {
      actorId: req.user.id,
      kind: 'im',
      text: `${req.user.display_name}: ${body.slice(0, 90)}`,
      url: '/im/t/' + id,
    });
  }

  if (req.get('x-requested-with') === 'fetch') return res.json({ ok: true, message: payload });
  res.redirect('/im/t/' + id);
});

router.get('/t/:id/messages', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!isMember(id, req.user.id)) return res.status(403).json({ error: 'not a member' });
  const after = parseInt(req.query.after, 10) || 0;
  const rows = db.prepare(`
    SELECT m.*, us.username, us.display_name, us.avatar FROM im_messages m
    JOIN users us ON us.id = m.author_id
    WHERE m.thread_id = ? AND m.id > ? ORDER BY m.id LIMIT 200
  `).all(id, after);
  if (rows.length) {
    db.prepare('UPDATE im_members SET last_read = ? WHERE thread_id = ? AND user_id = ? AND last_read < ?')
      .run(rows[rows.length - 1].id, id, req.user.id, rows[rows.length - 1].id);
  }
  res.json({ messages: rows });
});

router.get('/t/:id/stream', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!isMember(id, req.user.id)) return res.status(403).end();

  res.set({
    'Content-Type': 'text/event-stream',
    // no-transform stops Cloudflare (and any other CDN) buffering the stream
    // to compress it, which would hold messages back until the buffer filled.
    'Cache-Control': 'no-cache, no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  const client = { res, userId: req.user.id };
  if (!streams.has(id)) streams.set(id, new Set());
  streams.get(id).add(client);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    const set = streams.get(id);
    if (set) {
      set.delete(client);
      if (!set.size) streams.delete(id);
    }
  });
});

router.post('/t/:id/leave', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM im_members WHERE thread_id = ? AND user_id = ?').run(id, req.user.id);
  const left = db.prepare('SELECT COUNT(*) c FROM im_members WHERE thread_id = ?').get(id).c;
  if (!left) db.prepare('DELETE FROM im_threads WHERE id = ?').run(id);
  res.redirect('/im');
});

module.exports = router;
