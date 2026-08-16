# Thalath Space

A private, invite-only social network for one group of people, built like it's 2005.
Profiles with songs and wallpapers, Top 8s (or Top 24s), bulletins, blogs, mail, live IM,
groups — installable on iPhone and Android as a home-screen app with push notifications.

One Node process, one SQLite file, no build step, no external services.

---

## Quick start

```bash
npm install
npm start
```

On first boot it creates the **Tom** account and prints the password once:

```
┌───────────────────────────────────────────────┐
│  First run: your Tom account is ready.        │
└───────────────────────────────────────────────┘
   username: tom
   password: 7Kq2mXpR4vN     <-- save this now, it is not shown again
```

Set `TOM_PASSWORD` before the first run if you'd rather choose it yourself.

Then open http://localhost:3000, log in, go to **/admin**, generate invite codes, and send
people the copy-link button next to each one.

Run the test suite with `npm test` — it spawns its own throwaway server and exercises
every feature (144 checks).

---

## Getting it on phones

The site is a PWA. There is no app store step.

**iPhone / iPad** — open the site in **Safari** → Share → *Add to Home Screen*. It must be
Safari, and it must be opened from the home-screen icon afterwards, or notifications
won't work (that's an Apple restriction, not this app's).

**Android** — Chrome → ⋮ → *Install app*.

Then each person opens **Settings → Turn on notifications here**. Push works for mail,
IMs, comments, friend requests, bulletins and blog activity. VAPID keys are generated
automatically on first boot and stored in the database, so there's nothing to configure.

> Push and "Add to Home Screen" both require **HTTPS** (localhost is exempt). See
> deployment below.

---

## The features

**Profiles** — About Me and Who I'd Like To Meet blurbs, six interest categories, the full
2005 details table (status, here for, zodiac, hometown, occupation, income…), photo albums,
mood with emoji, headline, online status, away message, profile view counter and a
"who viewed me" list.

**Profile song** — upload an MP3/M4A/OGG/WAV/FLAC (or paste a direct audio URL) and it
plays when someone opens your page, with a period-appropriate player. Autoplay is attempted
and falls back to a Play button when the browser blocks it — which it will, on phones. The
player picks up where it left off if you navigate away and come back in the same session.

**Wallpaper and layout** — background image (tile / cover / fixed / scroll), every colour,
box transparency, ten preset themes, ten fonts, joke cursors, a marquee, a custom HTML
block, and a raw **Custom CSS** box with live preview.

The CSS box is the real thing — but every selector is rewritten to be scoped to your
profile area before it's served, and `body { }` is retargeted at your profile shell so old
MySpace layout codes still mostly work. That means you can wreck your own page as
thoroughly as you like and the navigation still works, so you can always get back to the
editor. `@import`, `expression()`, `javascript:` and `behavior:` are stripped.

**Top 8, or Top anything** — set the count to any number from 0 to 64 and pick how many
appear per row. Drag to reorder on desktop, ▲▼ buttons on a phone. Unfilled slots
auto-populate with recently-active friends. Set it to 0 to hide the section.

**Comments** — on profiles and blogs, with HTML, deletable by either the author or the page
owner, with a 3-second anti-spam gap.

**Bulletins** — broadcast to all your friends, with the classic surveys built in.

**Blogs** — categories, current mood, kudos, comments, and three privacy levels
(everyone / friends only / just me).

**Mail** — inbox, sent, unread counts, reply, delete.

**IM** — one-to-one and group chat over Server-Sent Events, with polling fallback and
catch-up on tab focus. Push fires only for people who aren't currently watching the thread.

**Groups** — open or private, with topics, replies, pinning and locking.

**Admin** — invite codes with copy-links, direct account creation, password resets,
enable/disable/delete accounts, promote admins, site name and tagline, Tom's welcome
message, and a broadcast to everyone.

**Tom** — the first account. Every new member is auto-friended with Tom, gets Tom in an
open Top slot, and receives the welcome message (editable in admin).

---

## HTML and safety

About Me, blurbs, comments, blogs, bulletins and mail all accept real HTML — tables,
fonts, `<marquee>`, `<blink>`, inline styles, images. On save, `sanitize-html` strips
scripts, iframes, event handlers and executable style values.

This is a deliberate trade: the whole point of a MySpace profile is that people can put
whatever they want on it. The allowlist is generous, so treat membership as the trust
boundary. Only invite people you'd hand a text editor to.

Uploads are served with `X-Content-Type-Options: nosniff`, a restrictive
`Content-Security-Policy` and `sandbox`, so an uploaded SVG can't execute anything.

Other protections: scrypt password hashing, HTTP-only session cookies with a 60-day
lifetime, CSRF tokens on every mutating request (including multipart uploads, which are
checked after the body is parsed), login and registration throttling, and per-route
authorisation checks.

Photos and profiles are visible to any signed-in member. There is no per-photo privacy —
if something shouldn't be seen by the whole group, don't upload it.

---

## Configuration

Everything is optional. Copy `.env.example` if you want a reference.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Bind address |
| `SITE_NAME` | `Thalath Space` | Initial site name (later editable in admin) |
| `TOM_USERNAME` | `tom` | Username for the first account |
| `TOM_PASSWORD` | *(random)* | Password for the first account, first boot only |
| `TOM_DISPLAY_NAME` | `Tom` | Display name for the first account |
| `DATA_DIR` | `./data` | Where the SQLite database lives |
| `UPLOAD_DIR` | `./uploads` | Where uploaded files live |
| `MAX_IMAGE_MB` | `12` | Per-image upload limit |
| `MAX_AUDIO_MB` | `25` | Per-song upload limit |
| `SECURE_COOKIES` | off | Set to `1` when serving over HTTPS |
| `TRUST_PROXY` | `1` | Hops of reverse proxy to trust |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | *(generated)* | Override the auto-generated push keys |
| `VAPID_SUBJECT` | `mailto:tom@thalath.space` | Contact for push services |
| `NODE_ENV` | — | Set to `production` to hide stack traces |

Environment variables are read at boot; the site name, tagline, open-signup toggle and
welcome message are all editable at runtime in `/admin`.

---

## Deploying

You need HTTPS for the home-screen app and push to work. Any of these is fine:

### Behind Caddy (simplest)

```
space.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
SECURE_COOKIES=1 NODE_ENV=production npm start
```

Caddy gets the certificate on its own. Point the DNS record at the box first.

### systemd

```ini
# /etc/systemd/system/thalath.service
[Unit]
Description=Thalath Space
After=network.target

[Service]
Type=simple
User=thalath
WorkingDirectory=/srv/thalath
Environment=NODE_ENV=production
Environment=SECURE_COOKIES=1
Environment=DATA_DIR=/srv/thalath/data
Environment=UPLOAD_DIR=/srv/thalath/uploads
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now thalath
sudo journalctl -u thalath -f    # the first-run password prints here
```

### Docker

```bash
docker build -t thalath .
docker run -d --name thalath -p 3000:3000 \
  -v thalath-data:/app/data -v thalath-uploads:/app/uploads \
  -e SECURE_COOKIES=1 -e NODE_ENV=production thalath
docker logs thalath            # first-run password
```

### Nginx note

If you use nginx, disable buffering on the IM stream or live chat will lag:

```nginx
location /im/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
}
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 30m;
}
```

---

## Backups

Everything that matters is two paths:

```bash
sqlite3 data/thalath.db ".backup '/backup/thalath-$(date +%F).db'"
tar czf /backup/uploads-$(date +%F).tar.gz uploads/
```

Use `.backup` rather than copying the file — the database runs in WAL mode, so a plain
`cp` while the server is running can catch it mid-write.

---

## Layout of the code

```
server.js              express app, middleware order, error handling
lib/db.js              schema (created on boot) and settings helpers
lib/auth.js            scrypt hashing, sessions, CSRF (incl. the multipart path)
lib/sanitize.js        HTML allowlist + the CSS scoper
lib/profilecss.js      turns a layout row into a stylesheet
lib/users.js           account creation, validation, "everybody gets Tom"
lib/upload.js          multer configs, each bundled with its CSRF check
lib/push.js            VAPID keys and web-push delivery
lib/themes.js          the ten preset layouts, fonts, cursors, categories
lib/util.js            friendship queries, notifications, formatting, moods
routes/                one file per area
views/                 EJS templates; partials/header + partials/footer wrap each page
public/css/site.css    the chrome — user CSS can never override it
public/js/app.js       music player, drag-sort, PWA registration, push opt-in
public/sw.js           service worker: offline shell, push, notification clicks
scripts/smoke.js       the test suite (npm test)
scripts/make-icons.js  regenerates the PNG icons
scripts/screenshot.js  drives a real browser and writes screenshots
```

Adding a field to profiles: add the column in `lib/db.js`, add it to the `UPDATE` in
`routes/profile.js`, add the input in `views/edit-info.ejs`, and render it in
`views/profile.ejs`. Nothing else needs to know.

---

Not affiliated with MySpace. It's a tribute.
