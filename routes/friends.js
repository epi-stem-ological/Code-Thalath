'use strict';

const express = require('express');
const { db, now } = require('../lib/db');
const { requireLogin } = require('../lib/auth');
const { findByUsername } = require('../lib/users');
const u = require('../lib/util');

const router = express.Router();

router.get('/friends', requireLogin, (req, res) => {
  const requests = db.prepare(`
    SELECT u.*, f.created_at AS asked_at FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC
  `).all(req.user.id);
  const sent = db.prepare(`
    SELECT u.* FROM friendships f JOIN users u ON u.id = f.addressee_id
    WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC
  `).all(req.user.id);
  res.render('friends', {
    title: 'My Friends',
    nav: 'friends',
    friends: u.friendList(req.user.id),
    requests,
    sent,
  });
});

router.get('/u/:username/friends', requireLogin, (req, res, next) => {
  const user = findByUsername(req.params.username);
  if (!user) return next();
  res.render('friendlist', {
    title: `${user.display_name}'s Friends`,
    nav: '',
    user,
    friends: u.friendList(user.id),
  });
});

router.post('/friends/add/:username', requireLogin, (req, res, next) => {
  const other = findByUsername(req.params.username);
  if (!other || other.id === req.user.id) return next();
  const existing = u.friendship(req.user.id, other.id);
  if (existing) {
    if (existing.status === 'pending' && existing.addressee_id === req.user.id) {
      return acceptFriend(req, res, other);
    }
    return back(res, req, 'Already handled.');
  }
  db.prepare(`
    INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)
  `).run(req.user.id, other.id, now());
  u.notify(other.id, {
    actorId: req.user.id,
    kind: 'friend_request',
    text: `${req.user.display_name} wants to be your friend`,
    url: '/friends',
  });
  back(res, req, 'Friend request sent.');
});

function acceptFriend(req, res, other) {
  const f = u.friendship(req.user.id, other.id);
  if (!f || f.status !== 'pending' || f.addressee_id !== req.user.id) return back(res, req, 'Nothing to accept.');
  db.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE id = ?").run(now(), f.id);

  // Auto-slot new friends into any open Top-N spots, both ways.
  addToTopIfRoom(req.user.id, other.id);
  addToTopIfRoom(other.id, req.user.id);

  u.notify(other.id, {
    actorId: req.user.id,
    kind: 'friend_accept',
    text: `${req.user.display_name} accepted your friend request`,
    url: `/u/${req.user.username}`,
  });
  return back(res, req, `You and ${other.display_name} are now friends.`);
}

function addToTopIfRoom(ownerId, friendId) {
  const layout = db.prepare('SELECT top_count FROM layouts WHERE user_id = ?').get(ownerId);
  if (!layout) return;
  const have = db.prepare('SELECT COUNT(*) c FROM top_friends WHERE owner_id = ?').get(ownerId).c;
  if (have >= layout.top_count) return;
  db.prepare('INSERT OR IGNORE INTO top_friends (owner_id, friend_id, position) VALUES (?, ?, ?)')
    .run(ownerId, friendId, have);
}

router.post('/friends/accept/:username', requireLogin, (req, res, next) => {
  const other = findByUsername(req.params.username);
  if (!other) return next();
  acceptFriend(req, res, other);
});

router.post('/friends/deny/:username', requireLogin, (req, res, next) => {
  const other = findByUsername(req.params.username);
  if (!other) return next();
  const f = u.friendship(req.user.id, other.id);
  if (f && f.status === 'pending') db.prepare('DELETE FROM friendships WHERE id = ?').run(f.id);
  back(res, req, 'Request denied.');
});

router.post('/friends/remove/:username', requireLogin, (req, res, next) => {
  const other = findByUsername(req.params.username);
  if (!other) return next();
  const f = u.friendship(req.user.id, other.id);
  if (f) db.prepare('DELETE FROM friendships WHERE id = ?').run(f.id);
  db.prepare('DELETE FROM top_friends WHERE (owner_id = ? AND friend_id = ?) OR (owner_id = ? AND friend_id = ?)')
    .run(req.user.id, other.id, other.id, req.user.id);
  back(res, req, `Removed ${other.display_name}.`);
});

router.post('/friends/block/:username', requireLogin, (req, res, next) => {
  const other = findByUsername(req.params.username);
  if (!other) return next();
  const f = u.friendship(req.user.id, other.id);
  if (f) db.prepare('DELETE FROM friendships WHERE id = ?').run(f.id);
  db.prepare('DELETE FROM top_friends WHERE (owner_id = ? AND friend_id = ?) OR (owner_id = ? AND friend_id = ?)')
    .run(req.user.id, other.id, other.id, req.user.id);
  db.prepare(`
    INSERT OR REPLACE INTO friendships (requester_id, addressee_id, status, created_at)
    VALUES (?, ?, 'blocked', ?)
  `).run(req.user.id, other.id, now());
  back(res, req, `Blocked ${other.display_name}.`);
});

router.post('/friends/unblock/:username', requireLogin, (req, res, next) => {
  const other = findByUsername(req.params.username);
  if (!other) return next();
  db.prepare("DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'blocked'")
    .run(req.user.id, other.id);
  back(res, req, 'Unblocked.');
});

/** Bounce back where they came from — but only ever to a path on this site. */
function back(res, req, msg) {
  let target = '/friends';
  const ref = req.get('referer');
  if (ref) {
    try {
      const url = new URL(ref, `${req.protocol}://${req.get('host')}`);
      if (url.host === req.get('host')) target = url.pathname + url.search;
    } catch { /* keep the default */ }
  }
  target = target.split('#')[0];
  const sep = target.includes('?') ? '&' : '?';
  res.redirect(target + sep + 'msg=' + encodeURIComponent(msg));
}

module.exports = router;
