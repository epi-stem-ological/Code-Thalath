'use strict';

/**
 * Drives a real browser through the app and writes screenshots, so the
 * layout can be eyeballed at desktop and phone widths.
 *   node scripts/screenshot.js [outDir]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'tspace-shots');
const PORT = 3500 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = 'testpass123';

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function tile(color1, color2) {
  // a checkerboard PNG so the wallpaper is obviously a wallpaper
  const { execSync } = require('child_process');
  void execSync; // (kept simple: reuse the icon generator's encoder)
  const zlib = require('zlib');
  const S = 32;
  const px = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? color1 : color2;
      const i = (y * S + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tspace-shot-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), HOST: '127.0.0.1',
      DATA_DIR: path.join(tmp, 'data'), UPLOAD_DIR: path.join(tmp, 'uploads'),
      TOM_PASSWORD: PASS,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const done = () => { server.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); };
  process.on('exit', done);

  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }

  const wallFile = path.join(tmp, 'wall.png');
  const avaFile = path.join(tmp, 'ava.gif');
  fs.writeFileSync(wallFile, tile([20, 0, 40], [60, 0, 90]));
  fs.writeFileSync(avaFile, GIF);

  // the sandbox ships a pinned chromium that may not match this playwright build
  const pinned = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(
    fs.existsSync(pinned) ? { executablePath: pinned } : {}
  );

  async function session(width, height, label) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: width < 500,
      hasTouch: width < 500,
    });
    const page = await ctx.newPage();
    return { ctx, page, label };
  }

  async function shot(page, name, label) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`), fullPage: true });
  }

  // ---- set up content as Tom, on desktop --------------------------------
  const { page: d } = await session(1100, 900, 'desktop');

  await d.goto(BASE + '/login');
  await d.fill('#username', 'tom');
  await d.fill('#password', PASS);
  await d.click('form[action="/login"] button[type=submit]');
  await d.waitForURL('**/home');

  // invite + register a friend
  await d.goto(BASE + '/admin');
  await d.fill('input[name=note]', 'screenshot buddy');
  await d.click('form[action="/admin/invite"] button');
  const code = await d.locator('code').first().innerText();

  const { page: reg } = await session(1100, 900, 'tmp');
  await reg.goto(BASE + '/register?code=' + code);
  await reg.fill('#username', 'jenn');
  await reg.fill('#display_name', 'Jenn ✿');
  await reg.fill('#password', 'hunter2hunter2');
  await reg.fill('#confirm', 'hunter2hunter2');
  await reg.click('form[action="/register"] button[type=submit]');
  await reg.goto(BASE + '/edit/pic');
  await reg.setInputFiles('input[name=avatar]', avaFile);
  await reg.click('form[action="/edit/pic"] button[type=submit]');
  await reg.goto(BASE + '/u/tom');
  await reg.fill('textarea[name=body]', 'omg love the new layout!! <b>hmu</b>');
  await reg.click('button:has-text("Post Comment")');

  // Tom's profile content
  await d.goto(BASE + '/edit');
  await d.fill('#display_name', 'Tom');
  await d.fill('#headline', '<font color="#00ffcc">still here, still yours</font>');
  await d.selectOption('#mood', 'devious');
  await d.fill('#about_me', `<center><font size="4" color="#ff33cc">✧･ﾟ WELCOME TO MY SPACE ･ﾟ✧</font></center>
<br>I built this so we'd have somewhere of our own. Set your song, wreck your layout,
rank your top 8. <b>The number is a setting now.</b>
<br><br><marquee scrollamount="3">~*~ thanks for the add ~*~</marquee>`);
  await d.fill('#like_to_meet', 'People who still know how to close a &lt;table&gt; tag.');
  await d.fill('#music', 'The Killers, Bloc Party, anything with a synth');
  await d.fill('#movies', 'Garden State (sorry)');
  await d.fill('#books', 'CSS: The Definitive Guide');
  await d.fill('#location', 'The Internet');
  await d.fill('#occupation', 'Website');
  await d.fill('#status', 'In a relationship with this website');
  await d.click('button:has-text("Save All Changes")');

  await d.goto(BASE + '/edit/pic');
  await d.setInputFiles('input[name=avatar]', avaFile);
  await d.click('form[action="/edit/pic"] button[type=submit]');

  await d.goto(BASE + '/edit/design');
  await d.check('input[name=apply_theme]');
  await d.check('input[value=vaporwave]');
  await d.setInputFiles('input[name=wallpaper]', wallFile);
  await d.fill('#marquee_text', '*~*~ tom dot space ~*~*');
  await d.fill('#custom_css', `.ms-sect { border-radius: 8px; box-shadow: 0 0 12px #ff71ce; }
.ms-secthead { letter-spacing: 2px; text-transform: uppercase; }
body { text-shadow: 0 0 6px rgba(255,113,206,.6); }`);
  await d.click('button:has-text("Save Layout")');

  await d.goto(BASE + '/edit/top');
  await d.fill('#top_count', '12');
  await d.fill('#top_cols', '4');
  await d.click('button:has-text("Save Top Friends")');

  await d.goto(BASE + '/bulletins/compose');
  await d.fill('#subject', 'the space is open');
  await d.fill('#body', 'profiles, songs, wallpapers, top 8s. go set yours up.');
  await d.click('button:has-text("Post to Friends")');

  await d.goto(BASE + '/blog/new');
  await d.fill('#title', 'why i still like tables for layout');
  await d.fill('#body', '<p>hear me out.</p><p>they never needed a build step.</p>');
  await d.selectOption('#mood', 'nerdy');
  await d.click('button:has-text("Publish")');

  // ---- capture -----------------------------------------------------------
  const routes = [
    ['/home', 'home'],
    ['/u/tom', 'profile'],
    ['/edit/design', 'design'],
    ['/edit/top', 'top-friends'],
    ['/edit/song', 'song'],
    ['/bulletins', 'bulletins'],
    ['/blog', 'blogs'],
    ['/mail', 'mail'],
    ['/im/with/jenn', 'im'],
    ['/groups', 'groups'],
    ['/browse', 'browse'],
    ['/admin', 'admin'],
    ['/help', 'help'],
  ];

  for (const [url, name] of routes) {
    // not networkidle: the IM page holds an SSE connection open forever
    await d.goto(BASE + url, { waitUntil: 'load' });
    await shot(d, name, 'desktop');
  }

  // phone pass, same session cookies
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const p = await phone.newPage();
  await p.goto(BASE + '/login');
  await p.fill('#username', 'tom');
  await p.fill('#password', PASS);
  await p.click('form[action="/login"] button[type=submit]');
  await p.waitForURL('**/home');

  for (const [url, name] of [['/home', 'home'], ['/u/tom', 'profile'], ['/im/with/jenn', 'im'], ['/edit/top', 'top-friends']]) {
    await p.goto(BASE + url, { waitUntil: 'load' });
    await shot(p, name, 'phone');
  }

  await browser.close();
  console.log('screenshots in ' + OUT);
  console.log(fs.readdirSync(OUT).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
