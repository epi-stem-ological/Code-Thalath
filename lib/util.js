'use strict';

const { db, now, setting } = require('./db');

const MOODS = [
  ['adored', '😍'], ['amused', '😄'], ['angry', '😠'], ['annoyed', '😒'], ['anxious', '😰'],
  ['awake', '👀'], ['blah', '😐'], ['blank', '😶'], ['bored', '🥱'], ['bouncy', '🐰'],
  ['broken', '💔'], ['bummed', '😞'], ['calm', '😌'], ['cheerful', '😃'], ['chill', '🧊'],
  ['cold', '🥶'], ['confused', '😕'], ['cranky', '😤'], ['crazy', '🤪'], ['crushed', '😢'],
  ['devious', '😈'], ['drained', '🔋'], ['dorky', '🤓'], ['ecstatic', '🤩'], ['energetic', '⚡'],
  ['enraged', '🤬'], ['envious', '😖'], ['excited', '🎉'], ['flirty', '😘'], ['geeky', '💾'],
  ['giggly', '🤭'], ['gloomy', '🌧️'], ['good', '🙂'], ['grateful', '🙏'], ['groovy', '🕺'],
  ['guilty', '😬'], ['happy', '😁'], ['high', '🚀'], ['hopeful', '🌱'], ['hungry', '🍕'],
  ['hyper', '🌀'], ['impressed', '😮'], ['indifferent', '🤷'], ['jealous', '💚'], ['lazy', '🛋️'],
  ['lonely', '🌙'], ['loved', '❤️'], ['mellow', '🎐'], ['mischievous', '😏'], ['moody', '🌗'],
  ['naughty', '😜'], ['nerdy', '🧠'], ['numb', '🧊'], ['okay', '👌'], ['optimistic', '☀️'],
  ['peaceful', '☮️'], ['pissed off', '💢'], ['quixotic', '🗡️'], ['recumbent', '🛏️'],
  ['refreshed', '🚿'], ['rejected', '🚪'], ['relaxed', '🌴'], ['restless', '🌊'], ['sad', '😭'],
  ['scared', '👻'], ['shocked', '😲'], ['silly', '🤡'], ['sick', '🤒'], ['sleepy', '😴'],
  ['stressed', '🥵'], ['sympathetic', '🤝'], ['thankful', '🍂'], ['thoughtful', '💭'],
  ['tired', '😪'], ['weird', '🛸'], ['working', '💼'], ['worried', '😟'],
];

const ZODIAC = [
  [1, 20, 'Capricorn'], [2, 19, 'Aquarius'], [3, 20, 'Pisces'], [4, 20, 'Aries'],
  [5, 21, 'Taurus'], [6, 21, 'Gemini'], [7, 22, 'Cancer'], [8, 23, 'Leo'],
  [9, 23, 'Virgo'], [10, 23, 'Libra'], [11, 22, 'Scorpio'], [12, 22, 'Sagittarius'],
  [12, 31, 'Capricorn'],
];

function zodiacFor(birthday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday || ''));
  if (!m) return '';
  const month = Number(m[2]);
  const day = Number(m[3]);
  for (const [zm, zd, name] of ZODIAC) {
    if (month < zm || (month === zm && day <= zd)) return name;
  }
  return '';
}

function ageFor(birthday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthday || ''));
  if (!m) return null;
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const md = t.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && t.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  if (d < 30) return `${Math.floor(d / 7)} week${d < 14 ? '' : 's'} ago`;
  return fmtDate(ts);
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${fmtDate(ts)} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function isOnline(user) {
  return !!user?.last_seen && Date.now() - user.last_seen < 5 * 60 * 1000;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'group';
}

function avatarUrl(user) {
  if (user?.avatar) return `/uploads/${user.avatar}`;
  return `/img/nopic.svg`;
}

// ---- friendship helpers ------------------------------------------------------

const friendRowStmt = db.prepare(`
  SELECT * FROM friendships
  WHERE (requester_id = @a AND addressee_id = @b) OR (requester_id = @b AND addressee_id = @a)
`);

function friendship(a, b) {
  if (!a || !b || a === b) return null;
  return friendRowStmt.get({ a, b }) || null;
}

function areFriends(a, b) {
  if (a === b) return true;
  const f = friendship(a, b);
  return !!f && f.status === 'accepted';
}

/** True if either side has blocked the other. */
function blockedBetween(a, b) {
  if (a === b) return false;
  const f = friendship(a, b);
  return !!f && f.status === 'blocked';
}

const friendIdsStmt = db.prepare(`
  SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
  FROM friendships
  WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
`);

function friendIds(userId) {
  return friendIdsStmt.all(userId, userId, userId).map((r) => r.id);
}

const friendListStmt = db.prepare(`
  SELECT u.* FROM users u
  JOIN friendships f
    ON (f.requester_id = u.id AND f.addressee_id = @me)
    OR (f.addressee_id = u.id AND f.requester_id = @me)
  WHERE f.status = 'accepted' AND u.disabled = 0
  ORDER BY u.last_seen DESC NULLS LAST, u.display_name COLLATE NOCASE
`);

function friendList(userId) {
  return friendListStmt.all({ me: userId });
}

function friendCount(userId) {
  return db
    .prepare(`SELECT COUNT(*) c FROM friendships WHERE status='accepted' AND (requester_id=? OR addressee_id=?)`)
    .get(userId, userId).c;
}

// ---- notifications -----------------------------------------------------------

const insertNotif = db.prepare(
  'INSERT INTO notifications (user_id, actor_id, kind, text, url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);

function notify(userId, { actorId = null, kind, text, url = '/' }) {
  if (!userId || userId === actorId) return;
  insertNotif.run(userId, actorId, kind, text, url, now());
  // push is best-effort and must never take a request down with it
  try {
    const p = require('./push').sendToUser(userId, { title: setting('site_name', 'Thalath Space'), body: text, url });
    if (p && p.catch) p.catch(() => {});
  } catch { /* no VAPID keys, no network, whatever */ }
}

function unreadCounts(userId) {
  if (!userId) return { mail: 0, notifs: 0, requests: 0, im: 0 };
  const mail = db.prepare('SELECT COUNT(*) c FROM messages WHERE recipient_id=? AND read_at IS NULL AND del_recip=0').get(userId).c;
  const notifs = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(userId).c;
  const requests = db.prepare("SELECT COUNT(*) c FROM friendships WHERE addressee_id=? AND status='pending'").get(userId).c;
  const im = db.prepare(`
    SELECT COUNT(*) c FROM im_messages m
    JOIN im_members mem ON mem.thread_id = m.thread_id AND mem.user_id = ?
    WHERE m.id > mem.last_read AND m.author_id <> ?
  `).get(userId, userId).c;
  return { mail, notifs, requests, im };
}

// ---- misc --------------------------------------------------------------------

function intIn(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = {
  MOODS, zodiacFor, ageFor, timeAgo, fmtDate, fmtDateTime, isOnline, slugify, avatarUrl,
  friendship, areFriends, blockedBetween, friendIds, friendList, friendCount,
  notify, unreadCounts, intIn, pick, escapeHtml,
};
