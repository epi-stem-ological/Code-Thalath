'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { findByUsername } = require('../lib/users');
const { richHtml, plain } = require('../lib/sanitize');
const u = require('../lib/util');

const router = express.Router();
router.use(requireLogin);

const PER = 25;

router.get('/', (req, res) => {
  const box = u.pick(req.query.box, ['inbox', 'sent'], 'inbox');
  const page = Math.max(1, parseInt(req.query.p, 10) || 1);

  const rows = box === 'inbox'
    ? db.prepare(`
        SELECT m.*, us.username, us.display_name, us.avatar FROM messages m
        JOIN users us ON us.id = m.sender_id
        WHERE m.recipient_id = ? AND m.del_recip = 0
        ORDER BY m.created_at DESC LIMIT ? OFFSET ?
      `).all(req.user.id, PER, (page - 1) * PER)
    : db.prepare(`
        SELECT m.*, us.username, us.display_name, us.avatar FROM messages m
        JOIN users us ON us.id = m.recipient_id
        WHERE m.sender_id = ? AND m.del_sender = 0
        ORDER BY m.created_at DESC LIMIT ? OFFSET ?
      `).all(req.user.id, PER, (page - 1) * PER);

  const total = box === 'inbox'
    ? db.prepare('SELECT COUNT(*) c FROM messages WHERE recipient_id = ? AND del_recip = 0').get(req.user.id).c
    : db.prepare('SELECT COUNT(*) c FROM messages WHERE sender_id = ? AND del_sender = 0').get(req.user.id).c;

  res.render('mail-list', { title: 'Mail', nav: 'mail', box, rows, page, per: PER, total });
});

router.get('/compose', (req, res) => {
  const to = req.query.to ? findByUsername(req.query.to) : null;
  const replyTo = req.query.re ? db.prepare('SELECT * FROM messages WHERE id = ?').get(req.query.re) : null;
  let subject = plain(req.query.subject || '', 120);
  let body = '';
  if (replyTo && (replyTo.recipient_id === req.user.id || replyTo.sender_id === req.user.id)) {
    subject = /^re:/i.test(replyTo.subject) ? replyTo.subject : 'RE: ' + replyTo.subject;
  }
  if (req.query.fwd) {
    const p = findByUsername(req.query.fwd);
    if (p) {
      subject = subject || `Check out ${p.display_name}`;
      body = `<a href="/u/${p.username}">${p.display_name}</a>'s profile: /u/${p.username}`;
    }
  }
  res.render('mail-compose', {
    title: 'Send a Message',
    nav: 'mail',
    to,
    subject,
    body,
    friends: u.friendList(req.user.id),
    everyone: db.prepare('SELECT id, username, display_name FROM users WHERE disabled = 0 AND id <> ? ORDER BY display_name COLLATE NOCASE').all(req.user.id),
  });
});

router.post('/send', (req, res) => {
  const target = String(req.body.to || '').trim();
  const recipient = findByUsername(target)
    || db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(target, 10) || -1);

  if (!recipient) return res.redirect('/mail/compose?err=' + encodeURIComponent('No such person.'));
  if (recipient.id === req.user.id) return res.redirect('/mail/compose?err=' + encodeURIComponent('You cannot mail yourself. Write a blog.'));
  if (u.blockedBetween(req.user.id, recipient.id)) {
    return res.redirect('/mail?err=' + encodeURIComponent('You cannot message that person.'));
  }

  const subject = plain(req.body.subject, 150) || '(no subject)';
  const body = richHtml(String(req.body.body || '').slice(0, 40000)).trim();
  if (!body) return res.redirect('/mail/compose?err=' + encodeURIComponent('Write something.'));

  db.prepare('INSERT INTO messages (sender_id, recipient_id, subject, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, recipient.id, subject, body, now());
  u.notify(recipient.id, {
    actorId: req.user.id,
    kind: 'mail',
    text: `New message from ${req.user.display_name}: ${subject}`,
    url: '/mail',
  });
  res.redirect('/mail?msg=' + encodeURIComponent('Message sent to ' + recipient.display_name));
});

router.get('/:id', (req, res, next) => {
  const m = db.prepare(`
    SELECT m.*, s.username AS s_username, s.display_name AS s_name, s.avatar AS s_avatar,
           r.username AS r_username, r.display_name AS r_name, r.avatar AS r_avatar
    FROM messages m
    JOIN users s ON s.id = m.sender_id
    JOIN users r ON r.id = m.recipient_id
    WHERE m.id = ?
  `).get(req.params.id);
  if (!m) return next();
  if (m.sender_id !== req.user.id && m.recipient_id !== req.user.id) return next();

  if (m.recipient_id === req.user.id && !m.read_at) {
    db.prepare('UPDATE messages SET read_at = ? WHERE id = ?').run(now(), m.id);
    m.read_at = now();
  }
  res.render('mail-read', { title: m.subject, nav: 'mail', m });
});

router.post('/:id/delete', (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!m) return res.redirect('/mail');
  if (m.recipient_id === req.user.id) db.prepare('UPDATE messages SET del_recip = 1 WHERE id = ?').run(m.id);
  if (m.sender_id === req.user.id) db.prepare('UPDATE messages SET del_sender = 1 WHERE id = ?').run(m.id);
  db.prepare('DELETE FROM messages WHERE id = ? AND del_recip = 1 AND del_sender = 1').run(m.id);
  res.redirect('/mail?msg=' + encodeURIComponent('Deleted.'));
});

router.post('/:id/unread', (req, res) => {
  db.prepare('UPDATE messages SET read_at = NULL WHERE id = ? AND recipient_id = ?').run(req.params.id, req.user.id);
  res.redirect('/mail');
});

module.exports = router;
