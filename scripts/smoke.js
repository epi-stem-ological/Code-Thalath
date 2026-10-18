'use strict';

/**
 * End-to-end smoke test. Spawns its own server against throwaway data and
 * upload directories, then exercises every feature the way a browser would
 * (cookies, CSRF, multipart uploads, SSE fallbacks).
 *
 *   node scripts/smoke.js              # spawn a private server
 *   node scripts/smoke.js http://host  # test a server that is already up
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTERNAL = process.argv[2];
const PORT = 3100 + (process.pid % 400);
const BASE = EXTERNAL || `http://127.0.0.1:${PORT}`;
const TOM_PASS = 'testpass123';

let child = null;
let tmpDir = null;

async function bootServer() {
  if (EXTERNAL) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tspace-smoke-'));
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: path.join(tmpDir, 'data'),
      UPLOAD_DIR: path.join(tmpDir, 'uploads'),
      TOM_PASSWORD: TOM_PASS,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => { log.push(String(d)); process.stderr.write(d); });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/', { redirect: 'manual' });
      if (res.status) return;
    } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error('server never came up:\n' + log.join(''));
}

function cleanup() {
  if (child) child.kill('SIGKILL');
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}
process.on('exit', cleanup);

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name} ${detail}`); }
}

function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

class Client {
  constructor(label) { this.jar = new Map(); this.label = label; this.csrf = null; }

  cookieHeader() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of raw) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (v === '') this.jar.delete(k); else this.jar.set(k, v);
    }
  }

  async get(path, opts = {}) {
    const res = await fetch(BASE + path, {
      redirect: 'manual',
      headers: { cookie: this.cookieHeader(), ...(opts.headers || {}) },
    });
    this.absorb(res);
    const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
    return { status: res.status, location: res.headers.get('location'), body, headers: res.headers };
  }

  async page(path) {
    let r = await this.get(path);
    let hops = 0;
    while (r.status >= 300 && r.status < 400 && r.location && hops++ < 5) {
      r = await this.get(r.location.startsWith('http') ? r.location.slice(BASE.length) : r.location);
    }
    const m = /name="_csrf" value="([^"]+)"/.exec(r.body);
    if (m) this.csrf = m[1];
    return r;
  }

  async post(path, fields = {}, opts = {}) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => body.append(k, x));
      else body.append(k, v);
    }
    if (this.csrf && !('_csrf' in fields)) body.append('_csrf', this.csrf);
    const res = await fetch(BASE + path, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: this.cookieHeader(),
        'content-type': 'application/x-www-form-urlencoded',
        ...(opts.headers || {}),
      },
      body,
    });
    this.absorb(res);
    const text = res.status >= 300 && res.status < 400 ? '' : await res.text();
    return { status: res.status, location: res.headers.get('location'), body: text };
  }

  async postMultipart(path, fields, files) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (this.csrf) fd.append('_csrf', this.csrf);
    for (const [k, f] of Object.entries(files)) {
      fd.append(k, new Blob([f.data], { type: f.type }), f.name);
    }
    const res = await fetch(BASE + path, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: this.cookieHeader() },
      body: fd,
    });
    this.absorb(res);
    const text = res.status >= 300 && res.status < 400 ? '' : await res.text();
    return { status: res.status, location: res.headers.get('location'), body: text };
  }

  async postJson(path, obj) {
    const res = await fetch(BASE + path, {
      method: 'POST', redirect: 'manual',
      headers: {
        cookie: this.cookieHeader(),
        'content-type': 'application/json',
        'x-csrf-token': this.csrf || '',
      },
      body: JSON.stringify(obj),
    });
    this.absorb(res);
    return { status: res.status, body: await res.text() };
  }
}

// 1x1 gif and a tiny wav, so uploads are real files
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
function wav() {
  const data = Buffer.alloc(1600);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(8000, 24); head.writeUInt32LE(8000, 28);
  head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

(async () => {
  await bootServer();
  console.log(`Smoke testing ${BASE}\n`);

  // ---------------------------------------------------------------- auth
  section('Auth & sessions');
  const tom = new Client('tom');
  let r = await tom.page('/');
  ok('landing page renders', r.status === 200 && r.body.includes('a place for friends'));

  await tom.page('/login');
  r = await tom.post('/login', { username: 'tom', password: 'wrong-password' });
  ok('bad password rejected', r.status === 401 && r.body.includes('incorrect'));

  await tom.page('/login');
  r = await tom.post('/login', { username: 'tom', password: TOM_PASS });
  ok('login succeeds', r.status === 302 && r.location === '/home', `got ${r.status} ${r.location}`);

  r = await tom.page('/home');
  ok('home dashboard loads', r.status === 200 && r.body.includes('My Stuff'));

  // CSRF must actually be enforced
  const noCsrf = await tom.post('/settings/mood', { mood: 'sneaky', _csrf: 'bogus' });
  ok('CSRF rejects a bad token', noCsrf.status === 403);

  // ---------------------------------------------------------------- invites
  section('Invites & registration');
  await tom.page('/admin');
  r = await tom.post('/admin/invite', { count: '2', note: 'smoke test' });
  ok('invite codes generated', r.status === 302);

  r = await tom.page('/admin');
  const codes = [...r.body.matchAll(/<code style="font-size:13px">([A-Z0-9-]+)<\/code>/g)].map((m) => m[1]);
  ok('invite codes listed', codes.length >= 2, `found ${codes.length}`);

  const alice = new Client('alice');
  await alice.page('/register');
  r = await alice.post('/register', {
    code: 'NOT-AREALCODE', username: 'alice', display_name: 'Alice',
    password: 'hunter2hunter2', confirm: 'hunter2hunter2',
  });
  ok('bad invite code rejected', r.status === 400 && r.body.includes('not valid'));

  await alice.page('/register');
  r = await alice.post('/register', {
    code: codes[0], username: 'alice', display_name: 'Alice A',
    password: 'hunter2hunter2', confirm: 'hunter2hunter2',
  });
  ok('registration with valid code works', r.status === 302 && r.location.startsWith('/edit'), `got ${r.location}`);

  const bob = new Client('bob');
  await bob.page('/register');
  r = await bob.post('/register', {
    code: codes[1], username: 'bob', display_name: 'Bob B',
    password: 'hunter2hunter2', confirm: 'hunter2hunter2',
  });
  ok('second user registers', r.status === 302);

  r = await alice.page('/mail');
  ok("Tom's welcome message arrives", r.body.includes('Welcome to the space'));

  r = await alice.page('/u/alice');
  ok('Tom is auto-friended', r.body.includes('/u/tom'));

  // ---------------------------------------------------------------- profile
  section('Profile editing');
  await alice.page('/edit');
  const profileForm = {
    display_name: 'Alice A',
    headline: '<b>xXx</b> queen of the space <marquee>hi</marquee>',
    mood: 'devious', mood_emoji: '😈',
    about_me: '<table><tr><td><font color="#ff00ff" size="5">I <blink>love</blink> tables</font></td></tr></table>'
      + '<script>alert(1)</script><img src=x onerror=alert(2)>',
    like_to_meet: 'literally anyone',
    interests: 'CSS crimes', music: 'Nu-metal', movies: 'The Matrix',
    television: 'Adult Swim', books: 'none', heroes: 'Tom',
    status: 'Single', here_for: 'Friends', birthday: '1988-07-04', show_age: '1',
    hometown: 'Springfield', location: 'The Internet', occupation: 'Webmaster',
    education: 'Self-taught', religion: 'HTML', ethnicity: '-', children: 'No',
    smoke_drink: 'No / Sometimes', income: 'lol',
  };
  r = await alice.post('/edit', profileForm);
  ok('profile saves', r.status === 302);

  r = await alice.page('/u/alice');
  ok('rich HTML survives sanitising', r.body.includes('<blink>love</blink>'));

  // form fields must round-trip, not pick up an extra layer of escaping each save
  r = await alice.page('/edit');
  ok('headline round-trips into the form once', r.body.includes('value="&lt;b&gt;xXx&lt;/b&gt;')
    && !r.body.includes('&amp;lt;b&amp;gt;'), 'double-escaped');
  await alice.post('/edit', { ...profileForm, occupation: "Tom's webmaster" });
  r = await alice.page('/edit');
  ok('apostrophes survive a save/load round-trip', r.body.includes('value="Tom&#39;s webmaster"')
    && !r.body.includes('Tom&amp;#39;s'), 'entity got double-encoded');
  r = await alice.page('/u/alice'); // back to the profile for the checks below
  ok('<script> is stripped', !r.body.includes('alert(1)'));
  ok('onerror handler is stripped', !r.body.includes('onerror'));
  ok('zodiac computed from birthday', r.body.includes('Cancer'));
  ok('age computed', /\d+ years old/.test(r.body));
  ok('mood shows', r.body.includes('devious'));

  // ---------------------------------------------------------------- uploads
  section('Uploads: avatar, wallpaper, song');
  await alice.page('/edit/pic');
  r = await alice.postMultipart('/edit/pic', {}, { avatar: { data: GIF, type: 'image/gif', name: 'me.gif' } });
  ok('avatar uploads', r.status === 302 && r.location.includes('msg='), `got ${r.status}`);

  r = await alice.page('/u/alice');
  const avatarMatch = /src="(\/uploads\/[^"]+)"/.exec(r.body);
  ok('avatar renders on profile', !!avatarMatch);
  if (avatarMatch) {
    const img = await alice.get(avatarMatch[1]);
    ok('uploaded file is served', img.status === 200);
    ok('uploads carry nosniff', img.headers.get('x-content-type-options') === 'nosniff');
    ok('uploads are sandboxed by CSP', (img.headers.get('content-security-policy') || '').includes('sandbox'));
    ok('uploads are not CDN-cacheable', (img.headers.get('cache-control') || '').includes('private'));

    // The site is meant to sit on a public hostname behind Cloudflare, so an
    // upload URL must be worthless without a session.
    const anon = new Client('anon');
    const leaked = await anon.get(avatarMatch[1]);
    ok('uploads are not readable logged out', leaked.status === 404, `got ${leaked.status}`);
  }

  await alice.page('/edit/song');
  r = await alice.postMultipart(
    '/edit/song',
    { song_title: 'Mr. Brightside', song_artist: 'The Killers', song_autoplay: '1' },
    { songfile: { data: wav(), type: 'audio/wav', name: 'song.wav' } }
  );
  ok('song uploads', r.status === 302);

  r = await alice.page('/u/alice');
  ok('player renders with song', r.body.includes('ms-player') && r.body.includes('Mr. Brightside'));
  ok('autoplay flag set', r.body.includes('data-autoplay="1"'));

  r = await alice.post('/edit/song', { song_url: 'javascript:alert(1)', song_title: 'x', song_artist: 'y' });
  ok('javascript: song URL rejected', r.status === 302 && r.location.includes('err='));
  r = await alice.post('/edit/song', { song_url: 'https://evil.example/track.mp3', song_title: 'x', song_artist: 'y' });
  ok('remote song URL rejected', r.status === 302 && r.location.includes('err='), r.location);

  // ------------------------------------------------------- privacy of media
  section('Photo privacy');

  // A real phone photo carries GPS. Upload one and check it does not survive.
  const exifJpeg = (() => {
    const seg = (m, p) => { const l = Buffer.alloc(2); l.writeUInt16BE(p.length + 2);
      return Buffer.concat([Buffer.from([0xFF, m]), l, p]); };
    return Buffer.concat([
      Buffer.from([0xFF, 0xD8]),
      seg(0xE1, Buffer.from('Exif\0\0II*\0GPSLatitude=51.5074 GPSLongitude=-0.1278 Make=iPhone15')),
      seg(0xDB, Buffer.alloc(16, 3)),
      seg(0xDA, Buffer.from([1, 0])),
      Buffer.from([0xA1, 0xB2, 0xC3, 0xD4]),
      Buffer.from([0xFF, 0xD9]),
    ]);
  })();

  await alice.page('/photos/alice');
  r = await alice.postMultipart('/photos/upload', { caption: 'family' },
    { photos: { data: exifJpeg, type: 'image/jpeg', name: 'family.jpg' } });
  ok('photo with EXIF uploads', r.status === 302);

  r = await alice.page('/photos/alice');
  const shots = [...r.body.matchAll(/\/uploads\/([A-Za-z0-9._-]+\.jpg)/g)].map((m) => m[1]);
  ok('uploaded jpeg is listed', shots.length > 0);
  if (shots.length) {
    const got = await fetch(BASE + '/uploads/' + shots[shots.length - 1],
      { headers: { cookie: alice.cookieHeader() } });
    const bytes = Buffer.from(await got.arrayBuffer());
    ok('GPS coordinates stripped from stored file', !bytes.includes('GPSLatitude'), 'GPS SURVIVED');
    ok('device model stripped', !bytes.includes('iPhone15'));
    ok('image data survived scrubbing', bytes.includes(Buffer.from([0xA1, 0xB2, 0xC3, 0xD4])));
    ok('still a valid JPEG', bytes[0] === 0xFF && bytes[1] === 0xD8);
  }

  // A remote <img> in a profile is a tracking pixel. It must not survive.
  await alice.page('/edit');
  await alice.post('/edit', { ...profileForm,
    about_me: 'hi <img src="https://tracker.example/pixel.gif"> there <img src="/uploads/ok.jpg">' });
  r = await alice.page('/u/alice');
  ok('remote tracking image stripped', !r.body.includes('tracker.example'), 'TRACKER SURVIVED');
  ok('local image kept', r.body.includes('/uploads/ok.jpg'));
  await alice.page('/edit');
  await alice.post('/edit', profileForm);

  r = await alice.get('/robots.txt');
  ok('robots.txt disallows everything', r.status === 200 && r.body.includes('Disallow: /'));

  // ---------------------------------------------------------------- design
  section('Design, wallpaper & custom CSS');
  await alice.page('/edit/design');
  r = await alice.postMultipart(
    '/edit/design',
    {
      theme: 'blackglitter', apply_theme: '1',
      bg_repeat: 'repeat', bg_attachment: 'fixed', bg_size: 'auto', bg_position: 'center top',
      table_opacity: '0.6', font_family: 'Comic Sans MS, Verdana, sans-serif', font_size: '12px',
      cursor_style: 'crosshair', contact_style: 'classic',
      marquee_text: '*~*~ WeLcOmE ~*~*',
      custom_html_top: '<center><b>glitter goes here</b></center>',
      custom_css: `
        body { background: #000 url(/img/icon.svg); color: #0ff; }
        .ms-sect { border: 3px dashed #ff33cc !important; }
        @import url("http://evil.example/x.css");
        .bad { background: url(javascript:alert(1)); }
        div { behavior: url(evil.htc); }
        @media (max-width: 500px) { .ms-sect { border-width: 1px; } }
      `,
    },
    { wallpaper: { data: GIF, type: 'image/gif', name: 'tile.gif' } }
  );
  ok('design saves', r.status === 302, `got ${r.status}`);

  r = await alice.page('/u/alice');
  const css = /<style id="ms-user-css">([\s\S]*?)<\/style>/.exec(r.body);
  ok('generated stylesheet present', !!css);
  const sheet = css ? css[1] : '';
  ok('wallpaper applied to body', /body\.profile-view\{background-image:url\("\/uploads\//.test(sheet));
  ok('theme colours applied', sheet.includes('#ff33cc'));
  // apply_theme was ticked, so the theme's own 0.9 opacity wins over the posted 0.6
  ok('box transparency became rgba', /rgba\(\d+,\d+,\d+,0?\.9\)/.test(sheet), sheet.match(/rgba\([^)]*\)/)?.[0]);
  ok('custom CSS is scoped to the profile', /#ms-profile \.ms-sect\{border:\s*3px dashed/.test(sheet));
  ok('body{} rewritten to profile shell', /#ms-profile\{background:\s*#000/.test(sheet));
  ok('@import stripped', !sheet.includes('@import'));
  ok('javascript: url stripped from CSS', !sheet.includes('javascript:'));
  ok('behavior: stripped', !sheet.includes('behavior'));
  ok('@media block preserved', sheet.includes('@media (max-width: 500px)'));
  ok('cursor applied', sheet.includes('cursor:crosshair'));
  ok('marquee renders', r.body.includes('WeLcOmE'));
  ok('custom HTML block renders', r.body.includes('glitter goes here'));
  ok('site chrome survives custom CSS', r.body.includes('id="ms-nav"'));

  r = await alice.post('/edit/design/preview', { custom_css: '.x { color: red }', table_opacity: '1' },
    { headers: { 'x-csrf-token': alice.csrf } });
  ok('live CSS preview endpoint works', r.status === 200 && r.body.includes('#ms-profile .x'));

  // Applying a theme must beat the colour inputs, which always post a value.
  await alice.page('/edit/design');
  r = await alice.postMultipart('/edit/design', {
    theme: 'matrix', apply_theme: '1',
    bg_color: '#ffffff', text_color: '#ffffff', link_color: '#ffffff',
    link_hover_color: '#ffffff', table_bg: '#ffffff', border_color: '#ffffff',
    header_bg: '#ffffff', header_text: '#ffffff',
    table_opacity: '1', font_family: 'Verdana, Arial, sans-serif', font_size: '11px',
    bg_repeat: 'repeat', bg_attachment: 'fixed', bg_size: 'auto', bg_position: 'center top',
    custom_css: '', custom_html_top: '', marquee_text: '', contact_style: 'classic',
  }, {});
  ok('theme save accepted', r.status === 302);
  r = await alice.page('/u/alice');
  const themeSheet = (/<style id="ms-user-css">([\s\S]*?)<\/style>/.exec(r.body) || ['', ''])[1];
  ok('applied theme beats the posted colour inputs', themeSheet.includes('#33ff66'), 'matrix green missing');
  ok('applied theme sets its font too', themeSheet.includes('Courier New'));

  // …and without the checkbox, the posted colours are respected.
  await alice.page('/edit/design');
  r = await alice.postMultipart('/edit/design', {
    theme: 'matrix',
    bg_color: '#123456', text_color: '#abcdef', link_color: '#00ff00',
    link_hover_color: '#ff0000', table_bg: '#ffffff', border_color: '#6699cc',
    header_bg: '#ff9933', header_text: '#ffffff',
    table_opacity: '1', font_family: 'Georgia, Times New Roman, serif', font_size: '12px',
    bg_repeat: 'repeat', bg_attachment: 'fixed', bg_size: 'auto', bg_position: 'center top',
    custom_css: '', custom_html_top: '', marquee_text: '', contact_style: 'classic',
  }, {});
  r = await alice.page('/u/alice');
  const ownSheet = (/<style id="ms-user-css">([\s\S]*?)<\/style>/.exec(r.body) || ['', ''])[1];
  ok('own colours kept when theme not applied', ownSheet.includes('#123456') && ownSheet.includes('#abcdef'));
  ok('own font kept when theme not applied', ownSheet.includes('Georgia'));

  await alice.page('/edit/design');
  await alice.postMultipart('/edit/design', {
    theme: 'classic', bg_color: '#123456', text_color: '#abcdef', link_color: '#00ff00',
    link_hover_color: '#ff0000', table_bg: '#ffffff', border_color: '#6699cc',
    header_bg: '#ff9933', header_text: '#ffffff', table_opacity: '0.35',
    font_family: 'Verdana, Arial, sans-serif', font_size: '11px',
    bg_repeat: 'repeat', bg_attachment: 'fixed', bg_size: 'auto', bg_position: 'center top',
    custom_css: '', custom_html_top: '', marquee_text: '', contact_style: 'classic',
  }, {});
  r = await alice.page('/u/alice');
  ok('own opacity kept when theme not applied',
    /rgba\(\d+,\d+,\d+,0?\.35\)/.test(r.body));

  // ------------------------------------------------------------------ games
  section('Profile games (sandboxed)');

  r = await alice.get('/play/pebbles/');
  ok('a game is served', r.status === 200 && r.body.includes('<canvas'));
  const gcsp = r.headers.get('content-security-policy') || '';
  ok('game cannot phone home', gcsp.includes("connect-src 'none'"), gcsp.slice(0, 80));
  ok('game cannot be framed off-site', gcsp.includes("frame-ancestors 'self'"));
  ok('game cannot submit forms anywhere', gcsp.includes("form-action 'none'"));

  await alice.page('/edit/design');
  r = await alice.postMultipart('/edit/design', {
    theme: 'classic', embed_slug: 'pebbles',
    bg_color: '#123456', text_color: '#abcdef', link_color: '#00ff00',
    link_hover_color: '#ff0000', table_bg: '#ffffff', border_color: '#6699cc',
    header_bg: '#ff9933', header_text: '#ffffff', table_opacity: '1',
    font_family: 'Verdana, Arial, sans-serif', font_size: '11px',
    bg_repeat: 'repeat', bg_attachment: 'fixed', bg_size: 'auto', bg_position: 'center top',
    custom_css: '', custom_html_top: '', marquee_text: '', contact_style: 'classic',
  }, {});
  ok('a game can be chosen', r.status === 302);

  r = await alice.page('/u/alice');
  ok('game appears on the profile', r.body.includes('/play/pebbles/'));
  const frame = /<iframe[\s\S]*?<\/iframe>/.exec(r.body);
  ok('it is framed', !!frame);
  if (frame) {
    const f = frame[0];
    ok('frame is sandboxed', /sandbox="[^"]*allow-scripts/.test(f));
    // allow-same-origin alongside allow-scripts would let the frame reach
    // cookies and the page around it, undoing the whole sandbox.
    ok('frame is NOT given same-origin', !/allow-same-origin/.test(f), 'SANDBOX DEFEATED');
    ok('frame sends no referrer', /referrerpolicy="no-referrer"/.test(f));
  }
  r = await alice.page('/home');
  ok('site CSP permits only our own frames',
     (r.headers.get('content-security-policy') || '').includes("frame-src 'self'"));

  // an unknown slug must not be storable
  await alice.page('/edit/design');
  await alice.postMultipart('/edit/design', {
    theme: 'classic', embed_slug: '../../etc/passwd',
    bg_color: '#123456', text_color: '#abcdef', link_color: '#00ff00',
    link_hover_color: '#ff0000', table_bg: '#ffffff', border_color: '#6699cc',
    header_bg: '#ff9933', header_text: '#ffffff', table_opacity: '1',
    font_family: 'Verdana, Arial, sans-serif', font_size: '11px',
    bg_repeat: 'repeat', bg_attachment: 'fixed', bg_size: 'auto', bg_position: 'center top',
    custom_css: '', custom_html_top: '', marquee_text: '', contact_style: 'classic',
  }, {});
  r = await alice.page('/u/alice');
  ok('a bogus game slug is rejected', !r.body.includes('etc/passwd') && !r.body.includes('<iframe'),
     'bad slug stored');

  // ---------------------------------------------------------------- friends
  section('Friends & Top N');
  await bob.page('/u/alice');
  r = await bob.post('/friends/add/alice');
  ok('friend request sent', r.status === 302);

  r = await alice.page('/friends');
  ok('request shows up for alice', r.body.includes('Bob B'));

  r = await alice.post('/friends/accept/bob');
  ok('friend request accepted', r.status === 302);

  r = await alice.page('/u/alice');
  ok('friend count updated', /2\s*<\/b>\s*friends|2 friends/.test(r.body) || r.body.includes('has <b>2</b> friends'));

  await alice.page('/edit/top');
  r = await alice.post('/edit/top', { top_count: '24', top_cols: '6', top_label: "Alice's Top 24", order: '' });
  ok('Top N count saved (24)', r.status === 302 && r.location.includes('Top%2024'), r.location);

  r = await alice.page('/u/alice');
  ok('grid columns follow setting', r.body.includes('grid-template-columns:repeat(6,minmax(0,1fr))'));
  ok('custom top label used', r.body.includes('Alice&#39;s Top 24'));
  ok('empty slots auto-filled with friends', r.body.includes('Showing top 2'));

  const bobId = /data-add-top="(\d+)"/.exec((await alice.page('/edit/top')).body);
  await alice.page('/edit/top');
  r = await alice.post('/edit/top', { top_count: '3', top_cols: '3', top_label: '', order: '' });
  ok('Top count can be lowered to 3', r.status === 302 && r.location.includes('Top%203'));

  await alice.page('/edit/top');
  r = await alice.post('/edit/top', { top_count: '0', top_cols: '4', order: '' });
  ok('Top count 0 accepted', r.status === 302);
  r = await alice.page('/u/alice');
  ok('Top section empty at 0', r.body.includes('No top friends yet'));

  await alice.page('/edit/top');
  await alice.post('/edit/top', { top_count: '8', top_cols: '4', order: '' });

  await alice.page('/edit/top');
  r = await alice.post('/edit/top', { top_count: '8', top_cols: '4', order: '999999' });
  ok('non-friend ids rejected from top list', r.status === 302);

  // ---------------------------------------------------------------- comments
  section('Comments');
  await bob.page('/u/alice');
  r = await bob.post('/u/alice/comment', { body: 'first!! <b>nice page</b>' });
  ok('comment posted', r.status === 302);

  r = await alice.page('/u/alice');
  ok('comment appears', r.body.includes('nice page'));

  r = await bob.post('/u/alice/comment', { body: 'spam' });
  ok('comment rate limit fires', r.status === 302 && r.location.includes('err='));

  r = await alice.page('/notifications');
  ok('comment notification delivered', r.body.includes('left you a comment'));

  // -------------------------------------------------------- member invites
  section('Member invitations');

  r = await bob.page('/invite');
  ok('members can reach the invite page', r.status === 200 && r.body.includes('Invite someone'));
  ok('shows a remaining allowance', /You have <b>\d+<\/b> invitation/.test(r.body), 'no allowance shown');

  await bob.page('/invite');
  r = await bob.post('/invite', { note: 'my cousin' });
  ok('member can create an invitation', r.status === 302 && r.location.includes('new='), r.location);
  const memberCode = decodeURIComponent((r.location.split('new=')[1] || '').split('&')[0]);
  ok('code looks right', /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(memberCode), memberCode);

  r = await bob.page('/invite');
  ok('the new code is listed', r.body.includes(memberCode));
  ok('allowance went down', r.body.includes('<b>2</b> invitation'), 'quota not decremented');

  // a code made by a member must actually work
  const cousin = new Client('cousin');
  await cousin.page('/register');
  r = await cousin.post('/register', {
    code: memberCode, username: 'cousin', display_name: 'The Cousin',
    password: 'hunter2hunter2', confirm: 'hunter2hunter2',
  });
  ok("a member's invite creates an account", r.status === 302 && r.location.startsWith('/edit'), r.location);

  // the real scenario: the link gets forwarded and a second person tries it
  const gatecrasher = new Client('gatecrasher');
  await gatecrasher.page('/register');
  r = await gatecrasher.post('/register', {
    code: memberCode, username: 'gatecrasher', display_name: 'Nope',
    password: 'hunter2hunter2', confirm: 'hunter2hunter2',
  });
  ok('a forwarded invite cannot be reused', r.status === 400 && r.body.includes('not valid'),
     `got ${r.status}`);

  r = await bob.page('/invite');
  ok('invite page shows who joined', r.body.includes('The Cousin'));

  // quota is a real limit
  for (let i = 0; i < 2; i++) { await bob.page('/invite'); await bob.post('/invite', { note: 'x' }); }
  await bob.page('/invite');
  r = await bob.post('/invite', { note: 'one too many' });
  ok('allowance is enforced', r.status === 302 && r.location.includes('err='), r.location);

  // withdrawing an unused code returns the slot
  const spare = (await bob.page('/invite')).body.match(/\/invite\/([A-Z2-9-]+)\/revoke/);
  ok('an unused code can be found to revoke', !!spare);
  if (spare) {
    await bob.page('/invite');
    r = await bob.post(`/invite/${spare[1]}/revoke`);
    ok('invitation withdrawn', r.status === 302 && r.location.includes('msg='));
    r = await bob.page('/invite');
    ok('slot returned to the member', r.body.includes('<b>1</b> invitation'), 'quota not refunded');
  }

  r = await alice.post(`/invite/${memberCode}/revoke`);
  ok("cannot revoke someone else's used code", r.status === 302 && r.location.includes('err='));

  // ------------------------------------------------------------ privacy page
  section('Privacy page');
  r = await alice.page('/privacy');
  ok('privacy page renders', r.status === 200);
  ok('states the admin can read messages', /not end-to-end encrypted/i.test(r.body), 'omits the honest caveat');
  ok('states screenshots cannot be stopped', /screenshot/i.test(r.body));
  ok('states location data is stripped', /location data is removed/i.test(r.body.replace(/<[^>]+>/g, '')));
  ok('linked from the footer', (await alice.page('/home')).body.includes('/privacy'));

  // ---------------------------------------------------------------- mail
  section('Mail');
  await alice.page('/mail/compose');
  r = await alice.post('/mail/send', { to: 'bob', subject: 'hey', body: 'check out my new layout' });
  ok('mail sends', r.status === 302 && r.location.includes('msg='));

  r = await bob.page('/mail');
  ok('mail lands in inbox', r.body.includes('hey'));
  ok('unread styling applied', r.body.includes('class="unread"'));

  const mailId = /\/mail\/(\d+)"/.exec(r.body);
  ok('message id found', !!mailId);
  if (mailId) {
    r = await bob.page('/mail/' + mailId[1]);
    ok('message opens', r.body.includes('check out my new layout'));
    r = await bob.page('/mail');
    // scope to this message's row — Tom's welcome mail is legitimately unread
    const row = new RegExp(`<tr class="([^"]*)">(?:(?!</tr>)[\\s\\S])*?/mail/${mailId[1]}"`);
    const rowMatch = row.exec(r.body);
    ok('marked read after opening', rowMatch && !rowMatch[1].includes('unread'),
      rowMatch ? `class="${rowMatch[1]}"` : 'row not found');
  }

  r = await alice.post('/mail/send', { to: 'alice', subject: 'x', body: 'y' });
  ok('cannot mail yourself', r.status === 302 && r.location.includes('err='));

  // ---------------------------------------------------------------- IM
  section('Instant messenger');
  r = await bob.page('/im/with/alice');
  ok('DM thread opens', r.status === 200 && r.body.includes('im-log'));
  const threadId = /\/im\/t\/(\d+)\/send/.exec(r.body);
  ok('thread id found', !!threadId);

  if (threadId) {
    const tid = threadId[1];
    r = await bob.post(`/im/t/${tid}/send`, { body: 'yo' }, { headers: { 'x-requested-with': 'fetch' } });
    ok('IM sends', r.status === 200 && r.body.includes('"ok":true'));

    r = await alice.get(`/im/t/${tid}/messages?after=0`);
    ok('IM polling returns the message', r.body.includes('yo'));

    // second call to the same DM must reuse the thread, not create a new one
    const again = await bob.page('/im/with/alice');
    const tid2 = /\/im\/t\/(\d+)\/send/.exec(again.body);
    ok('DM thread is reused, not duplicated', tid2 && tid2[1] === tid, `${tid} vs ${tid2 && tid2[1]}`);

    const stranger = await tom.get(`/im/t/${tid}/messages?after=0`);
    ok('non-members cannot read a thread', stranger.status === 403);
  }

  r = await alice.page('/im');
  ok('IM list shows the conversation', r.body.includes('Bob B'));

  // ---------------------------------------------------------------- bulletins
  section('Bulletins');
  await alice.page('/bulletins/compose');
  r = await alice.post('/bulletins/post', { subject: 'party at mine', body: 'bring <b>snacks</b>' });
  ok('bulletin posts', r.status === 302);

  r = await bob.page('/bulletins');
  ok("friend's bulletin visible", r.body.includes('party at mine'));

  r = await alice.page('/bulletins/compose?survey=basics');
  ok('survey template loads', r.body.includes('The Basics Survey'));

  // ---------------------------------------------------------------- blogs
  section('Blogs');
  await alice.page('/blog/new');
  r = await alice.post('/blog/new', {
    title: 'dear diary', body: '<p>today I discovered <b>CSS</b></p>',
    category: 'Life', mood: 'geeky', privacy: 'friends',
  });
  ok('blog publishes', r.status === 302 && r.location.startsWith('/blog/entry/'));
  const blogId = r.location.split('/').pop();

  r = await bob.page('/blog/entry/' + blogId);
  ok('friend can read a friends-only entry', r.body.includes('today I discovered'));

  r = await bob.post('/blog/entry/' + blogId + '/kudos');
  ok('kudos given', r.status === 302);
  r = await bob.page('/blog/entry/' + blogId);
  ok('kudos counted', r.body.includes('Kudos (1)'));

  r = await bob.post('/blog/entry/' + blogId + '/comment', { body: 'relatable' });
  ok('blog comment posted', r.status === 302);
  r = await alice.page('/blog/entry/' + blogId);
  ok('blog comment visible', r.body.includes('relatable'));

  await alice.page('/blog/new');
  r = await alice.post('/blog/new', { title: 'secret', body: 'nobody sees this', category: 'Life', privacy: 'private' });
  const privId = r.location.split('/').pop();
  r = await bob.get('/blog/entry/' + privId);
  ok('private entry hidden from others', r.status === 404, `got ${r.status}`);
  r = await alice.page('/blog/entry/' + privId);
  ok('private entry visible to the author', r.body.includes('nobody sees this'));

  r = await alice.page('/u/alice');
  ok('latest blog shows on profile', r.body.includes('Latest Blog Entry'));

  // ---------------------------------------------------------------- groups
  section('Groups & forums');
  await tom.page('/groups/new');
  r = await tom.postMultipart('/groups/new', { name: 'Movie Night', description: 'friday films', privacy: 'open' }, {});
  ok('group created', r.status === 302 && r.location.includes('/groups/movie-night'));

  r = await alice.page('/groups/movie-night');
  ok('group page loads', r.body.includes('friday films'));

  r = await alice.post('/groups/movie-night/topic', { title: 'x', body: 'y' });
  ok('non-members cannot post', r.status === 302 && r.location.includes('err='));

  await alice.page('/groups/movie-night');
  r = await alice.post('/groups/movie-night/join');
  ok('joined group', r.status === 302);

  await alice.page('/groups/movie-night');
  r = await alice.post('/groups/movie-night/topic', { title: 'The Matrix?', body: 'thoughts' });
  ok('topic created', r.status === 302 && r.location.includes('/t/'));
  const topicUrl = r.location;

  await tom.page(topicUrl);
  r = await tom.post(topicUrl + '/reply', { body: 'obviously yes' });
  ok('reply posted', r.status === 302);
  r = await alice.page(topicUrl);
  ok('reply visible', r.body.includes('obviously yes'));

  await tom.page(topicUrl);
  r = await tom.post(topicUrl + '/lock');
  ok('owner can lock a topic', r.status === 302);
  await alice.page(topicUrl);
  r = await alice.post(topicUrl + '/reply', { body: 'sneaking in' });
  ok('locked topic refuses replies', r.status === 302 && r.location.includes('err='));

  // private group access
  await tom.page('/groups/new');
  r = await tom.postMultipart('/groups/new', { name: 'Secret Club', description: 'shh', privacy: 'private' }, {});
  r = await alice.get('/groups/secret-club');
  ok('private group blocked for non-members', r.status === 403);

  // ---------------------------------------------------------------- photos
  section('Photos');
  await alice.page('/photos/alice');
  r = await alice.postMultipart('/photos/upload', { caption: 'me irl' }, {
    photos: { data: GIF, type: 'image/gif', name: 'a.gif' },
  });
  ok('photo uploads', r.status === 302);

  r = await alice.page('/photos/alice');
  ok('photo listed', r.body.includes('me irl'));
  const photoId = /\/photos\/view\/(\d+)/.exec(r.body);
  ok('photo page id found', !!photoId);
  if (photoId) {
    r = await alice.page('/photos/view/' + photoId[1]);
    ok('photo page loads', r.status === 200);
  }

  r = await bob.postMultipart('/photos/upload', {}, {
    photos: { data: Buffer.from('#!/bin/sh\necho hi'), type: 'application/x-sh', name: 'evil.sh' },
  });
  ok('non-image upload rejected', r.status === 400, `got ${r.status}`);

  // ---------------------------------------------------------------- views
  section('Profile views & search');
  r = await alice.page('/viewers');
  ok('who-viewed-me works', r.body.includes('Bob B') || r.body.includes('Tom'));

  r = await alice.page('/search?q=Bob');
  ok('search finds people', r.body.includes('Bob B'));
  r = await alice.page('/search?q=diary');
  ok('search finds blogs', r.body.includes('dear diary'));

  r = await alice.page('/browse');
  ok('browse lists members', r.body.includes('Bob B') && r.body.includes('Tom'));

  // ---------------------------------------------------------------- pwa
  section('PWA & push');
  r = await alice.get('/manifest.webmanifest');
  ok('manifest served', r.status === 200 && r.body.includes('"display":"standalone"'));
  r = await alice.get('/sw.js');
  ok('service worker served', r.status === 200 && r.body.includes('addEventListener'));
  r = await alice.get('/img/icon-192.png');
  ok('icon served', r.status === 200);
  r = await alice.get('/offline.html');
  ok('offline page served', r.status === 200);

  r = await alice.get('/push/key');
  ok('VAPID public key exposed', r.status === 200 && JSON.parse(r.body).key.length > 40);

  await alice.page('/settings');
  r = await alice.postJson('/push/subscribe', {
    endpoint: 'https://push.example.com/x' + Date.now(),
    keys: { p256dh: 'BFakeKey', auth: 'FakeAuth' },
  });
  ok('push subscription stored', r.status === 200 && r.body.includes('"ok":true'));

  // ---------------------------------------------------------------- security
  section('Access control');
  const ghost = new Client('ghost');
  r = await ghost.get('/home');
  ok('logged-out user redirected from /home', r.status === 302 && r.location.startsWith('/login'));
  r = await ghost.get('/u/alice');
  ok('profiles are not public', r.status === 302);
  r = await ghost.get('/admin');
  ok('admin blocked when logged out', r.status === 302);
  r = await alice.get('/admin');
  ok('admin blocked for normal users', r.status === 403);

  r = await bob.post('/comment/1/delete');
  ok("cannot delete someone else's comment", r.status === 403 || r.status === 302);

  r = await alice.get('/uploads/../data/thalath.db');
  ok('path traversal on /uploads blocked', r.status === 404 || r.status === 301 || r.status === 400, `got ${r.status}`);

  // headers for sitting on a public hostname
  r = await alice.get('/home');
  const csp = r.headers.get('content-security-policy') || '';
  ok('CSP blocks framing', csp.includes("frame-ancestors 'none'"));
  ok('CSP blocks plugins and base injection', csp.includes("object-src 'none'") && csp.includes("base-uri 'self'"));
  ok('CSP pins form submissions to this origin', csp.includes("form-action 'self'"));
  ok('CSP forbids remote images (tracking pixels)', csp.includes("img-src 'self' data:") && !/img-src[^;]*https:/.test(csp));
  ok('CSP forbids remote media', csp.includes("media-src 'self'") && !/media-src[^;]*https:/.test(csp));
  ok('clickjacking header set', r.headers.get('x-frame-options') === 'DENY');
  ok('referrer policy set', r.headers.get('referrer-policy') === 'same-origin');

  r = await ghost.get('/healthz');
  ok('health endpoint is public', r.status === 200 && r.body === 'ok');

  // ---------------------------------------------------------------- admin
  section('Admin panel');
  r = await tom.page('/admin');
  ok('admin panel loads', r.body.includes('Site Stats'));
  r = await tom.post('/admin/site', { site_name: 'Thalath Space', tagline: 'a place for friends', welcome_message: 'hi' });
  ok('site settings save', r.status === 302);
  await tom.page('/admin');
  r = await tom.post('/admin/broadcast', { subject: 'server maintenance', body: 'back in 5' });
  ok('broadcast sends', r.status === 302);
  r = await alice.page('/mail');
  ok('broadcast received', r.body.includes('server maintenance'));

  // ---------------------------------------------------------------- misc
  section('Misc pages');
  for (const p of ['/about', '/help', '/friends', '/notifications', '/settings', '/blog', '/bulletins', '/groups', '/mail', '/im', '/browse']) {
    r = await alice.page(p);
    ok(`${p} renders`, r.status === 200, `got ${r.status}`);
  }
  r = await alice.get('/u/definitely-not-a-user');
  ok('404 page for unknown profile', r.status === 404);

  await alice.page('/settings');
  r = await alice.post('/settings/password', { current: 'hunter2hunter2', next: 'newpassword123', confirm: 'newpassword123' });
  ok('password change works', r.status === 302 && r.location.includes('msg='));
  const alice2 = new Client('alice2');
  await alice2.page('/login');
  r = await alice2.post('/login', { username: 'alice', password: 'newpassword123' });
  ok('login with new password', r.status === 302 && r.location === '/home');

  await tom.page('/');
  r = await tom.post('/logout');
  ok('logout works', r.status === 302);
  r = await tom.get('/home');
  ok('session gone after logout', r.status === 302 && r.location.startsWith('/login'));

  // ---------------------------------------------------------------- summary
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  ✗ ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nSmoke test crashed:', e);
  process.exit(2);
});
