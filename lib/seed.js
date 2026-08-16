'use strict';

const crypto = require('crypto');
const { db, setting, setSetting, now } = require('./db');
const { createUser } = require('./users');

const TOM_ABOUT = `Hi, I'm Tom. I set this place up so we'd have somewhere of our own to talk —
no algorithm, no ads, no one selling the guest list.

<br><br>Add it to your home screen and it behaves like an app. Push notifications work
once you allow them in <b>Settings</b>.

<br><br>Some things you can do here:
<ul>
<li>Pick a <b>profile song</b> — it plays when someone lands on your page.</li>
<li>Set a <b>wallpaper</b> and paste <b>custom CSS</b>. Break your layout. It's tradition.</li>
<li>Rank your <b>Top 8</b>. Or Top 4. Or Top 24. The number is a setting now.</li>
<li>Leave <b>comments</b>, post <b>bulletins</b>, keep a <b>blog</b>, argue in <b>groups</b>.</li>
<li><b>Mail</b> for long things, <b>IM</b> for fast things.</li>
</ul>`;

function ensureSeed() {
  if (setting('seeded')) {
    ensureTomExists();
    return;
  }

  const username = process.env.TOM_USERNAME || 'tom';
  const password = process.env.TOM_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const generated = !process.env.TOM_PASSWORD;

  const tomId = createUser({
    username,
    displayName: process.env.TOM_DISPLAY_NAME || 'Tom',
    password,
    isAdmin: 1,
    headline: 'a place for friends',
  });

  db.prepare('UPDATE users SET is_staff = 1, mood = ?, mood_emoji = ? WHERE id = ?')
    .run('welcoming', '😃', tomId);
  db.prepare(`
    UPDATE profiles SET about_me = ?, like_to_meet = ?, status = ?, here_for = ?, location = ?, occupation = ?
    WHERE user_id = ?
  `).run(
    TOM_ABOUT,
    'You. Obviously.',
    'In a relationship with this website',
    'Friends, Networking',
    'The Internet',
    'Website',
    tomId
  );
  db.prepare("UPDATE layouts SET theme='classic', top_count=8, top_cols=4, top_label='Tom''s Top 8' WHERE user_id = ?")
    .run(tomId);

  setSetting('tom_id', tomId);
  setSetting('seeded', '1');

  // A general group everybody lands in.
  const ts = now();
  const gid = db.prepare(`
    INSERT INTO groups (slug, name, description, owner_id, privacy, created_at)
    VALUES ('general', 'General', 'Everything that does not have its own group yet.', ?, 'open', ?)
  `).run(tomId, ts).lastInsertRowid;
  db.prepare("INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
    .run(gid, tomId, ts);

  db.prepare('INSERT INTO bulletins (author_id, subject, body, created_at) VALUES (?, ?, ?, ?)')
    .run(tomId, 'the space is open', "Profiles, songs, wallpapers, Top 8 — it all works. Go set yours up.<br><br>– Tom", ts);

  console.log('\n  ┌───────────────────────────────────────────────┐');
  console.log('  │  First run: your Tom account is ready.        │');
  console.log('  └───────────────────────────────────────────────┘');
  console.log(`     username: ${username}`);
  if (generated) {
    console.log(`     password: ${password}    <-- save this now, it is not shown again`);
  } else {
    console.log('     password: (from TOM_PASSWORD)');
  }
  console.log('     Make invite codes at /admin once you log in.\n');
}

function ensureTomExists() {
  const tomId = Number(setting('tom_id', 0));
  if (tomId && db.prepare('SELECT 1 FROM users WHERE id = ?').get(tomId)) return;
  const anyAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
  if (anyAdmin) setSetting('tom_id', anyAdmin.id);
}

module.exports = { ensureSeed };
