'use strict';

const crypto = require('crypto');
const express = require('express');
const { db, now, setting } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { plain } = require('../lib/sanitize');

const router = express.Router();
router.use(requireLogin);

/** Readable at a glance and over the phone: no 0/O, no 1/I. */
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 4) out += '-';
  }
  return out;
}

function myInvites(userId) {
  return db.prepare(`
    SELECT i.*, u.username AS used_username, u.display_name AS used_name
    FROM invites i
    LEFT JOIN users u ON u.id = i.used_by
    WHERE i.created_by = ?
    ORDER BY i.created_at DESC
  `).all(userId);
}

router.get('/invite', (req, res) => {
  const invites = myInvites(req.user.id);
  res.render('invite', {
    title: 'Invite someone',
    nav: 'invite',
    invites,
    left: req.user.is_admin ? Infinity : req.user.invites_left,
    isAdmin: !!req.user.is_admin,
    joined: invites.filter((i) => i.used_by).length,
  });
});

router.post('/invite', (req, res) => {
  // Admins are unlimited; everyone else spends from their allowance. The cap
  // exists so one person cannot quietly double the size of the group.
  if (!req.user.is_admin && req.user.invites_left <= 0) {
    return res.redirect('/invite?err=' + encodeURIComponent(
      'You have used all your invitations. Ask Tom if you need more.'));
  }

  const note = plain(req.body.note, 60);
  const code = makeCode();

  const give = db.transaction(() => {
    db.prepare('INSERT INTO invites (code, created_by, note, created_at) VALUES (?, ?, ?, ?)')
      .run(code, req.user.id, note, now());
    if (!req.user.is_admin) {
      db.prepare('UPDATE users SET invites_left = MAX(0, invites_left - 1) WHERE id = ?').run(req.user.id);
    }
  });
  give();

  res.redirect('/invite?new=' + encodeURIComponent(code));
});

router.post('/invite/:code/revoke', (req, res) => {
  // Only unused codes, only your own, unless you are an admin.
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(req.params.code);
  if (!row || row.used_by) return res.redirect('/invite?err=' + encodeURIComponent('That code cannot be revoked.'));
  if (row.created_by !== req.user.id && !req.user.is_admin) return res.status(403).send('Not yours.');

  const take = db.transaction(() => {
    db.prepare('DELETE FROM invites WHERE code = ?').run(row.code);
    if (row.created_by && !req.user.is_admin) {
      db.prepare('UPDATE users SET invites_left = invites_left + 1 WHERE id = ?').run(row.created_by);
    }
  });
  take();
  res.redirect('/invite?msg=' + encodeURIComponent('Invitation withdrawn.'));
});

module.exports = router;
