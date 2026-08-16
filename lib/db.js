'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'thalath.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name   TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  is_staff       INTEGER NOT NULL DEFAULT 0,
  avatar         TEXT,
  headline       TEXT    NOT NULL DEFAULT '',
  mood           TEXT    NOT NULL DEFAULT '',
  mood_emoji     TEXT    NOT NULL DEFAULT '',
  away_message   TEXT    NOT NULL DEFAULT '',
  profile_views  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_login     INTEGER,
  last_seen      INTEGER,
  disabled       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  about_me       TEXT NOT NULL DEFAULT '',
  like_to_meet   TEXT NOT NULL DEFAULT '',
  interests      TEXT NOT NULL DEFAULT '',
  music          TEXT NOT NULL DEFAULT '',
  movies         TEXT NOT NULL DEFAULT '',
  television     TEXT NOT NULL DEFAULT '',
  books          TEXT NOT NULL DEFAULT '',
  heroes         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT '',
  here_for       TEXT NOT NULL DEFAULT '',
  birthday       TEXT NOT NULL DEFAULT '',
  show_age       INTEGER NOT NULL DEFAULT 1,
  zodiac         TEXT NOT NULL DEFAULT '',
  hometown       TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  occupation     TEXT NOT NULL DEFAULT '',
  education      TEXT NOT NULL DEFAULT '',
  religion       TEXT NOT NULL DEFAULT '',
  ethnicity      TEXT NOT NULL DEFAULT '',
  children       TEXT NOT NULL DEFAULT '',
  smoke_drink    TEXT NOT NULL DEFAULT '',
  income         TEXT NOT NULL DEFAULT '',
  song_title     TEXT NOT NULL DEFAULT '',
  song_artist    TEXT NOT NULL DEFAULT '',
  song_url       TEXT NOT NULL DEFAULT '',
  song_autoplay  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS layouts (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme            TEXT NOT NULL DEFAULT 'classic',
  bg_color         TEXT NOT NULL DEFAULT '#e5e5e5',
  bg_image         TEXT NOT NULL DEFAULT '',
  bg_repeat        TEXT NOT NULL DEFAULT 'repeat',
  bg_attachment    TEXT NOT NULL DEFAULT 'fixed',
  bg_size          TEXT NOT NULL DEFAULT 'auto',
  bg_position      TEXT NOT NULL DEFAULT 'center top',
  text_color       TEXT NOT NULL DEFAULT '#000000',
  link_color       TEXT NOT NULL DEFAULT '#003399',
  link_hover_color TEXT NOT NULL DEFAULT '#ff0000',
  table_bg         TEXT NOT NULL DEFAULT '#ffffff',
  table_opacity    REAL NOT NULL DEFAULT 1,
  border_color     TEXT NOT NULL DEFAULT '#6699cc',
  header_bg        TEXT NOT NULL DEFAULT '#6699cc',
  header_text      TEXT NOT NULL DEFAULT '#ffffff',
  font_family      TEXT NOT NULL DEFAULT 'Verdana, Arial, sans-serif',
  font_size        TEXT NOT NULL DEFAULT '11px',
  cursor_style     TEXT NOT NULL DEFAULT '',
  custom_css       TEXT NOT NULL DEFAULT '',
  custom_html_top  TEXT NOT NULL DEFAULT '',
  top_count        INTEGER NOT NULL DEFAULT 8,
  top_cols         INTEGER NOT NULL DEFAULT 4,
  top_label        TEXT NOT NULL DEFAULT '',
  show_glitter     INTEGER NOT NULL DEFAULT 0,
  show_snow        INTEGER NOT NULL DEFAULT 0,
  marquee_text     TEXT NOT NULL DEFAULT '',
  contact_style    TEXT NOT NULL DEFAULT 'classic'
);

CREATE TABLE IF NOT EXISTS friendships (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  UNIQUE(requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_add ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_req ON friendships(requester_id, status);

CREATE TABLE IF NOT EXISTS top_friends (
  owner_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  PRIMARY KEY (owner_id, friend_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  approved   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_comments_profile ON comments(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bulletins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bulletins_time ON bulletins(created_at DESC);

CREATE TABLE IF NOT EXISTS blogs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  mood       TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT 'Life',
  privacy    TEXT NOT NULL DEFAULT 'friends',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_blogs_author ON blogs(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id    INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blog_kudos (
  blog_id INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (blog_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER,
  del_sender   INTEGER NOT NULL DEFAULT 0,
  del_recip    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_recip ON messages(recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS albums (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  privacy    TEXT NOT NULL DEFAULT 'friends',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id   INTEGER REFERENCES albums(id) ON DELETE SET NULL,
  file       TEXT NOT NULL,
  caption    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  privacy     TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  locked     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  bumped_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_topic ON posts(topic_id, created_at);

CREATE TABLE IF NOT EXISTS im_threads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'dm',
  name       TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  bumped_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS im_members (
  thread_id INTEGER NOT NULL REFERENCES im_threads(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS im_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL REFERENCES im_threads(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_im_thread ON im_messages(thread_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '/',
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profile_views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_views ON profile_views(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT NOT NULL DEFAULT '',
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS push_subs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function setting(key, fallback = null) {
  const row = getSetting.get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  setSettingStmt.run(key, String(value));
}

const now = () => Date.now();

module.exports = { db, setting, setSetting, now, DATA_DIR };
