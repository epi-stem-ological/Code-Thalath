# Putting your game on your profile

Anyone with a game can have it running on their own profile page here. This is
everything you need to know to port one across.

It takes about ten minutes if your game is already self-contained, and a bit
longer if it currently loads anything from the internet.

---

## What you're building

A folder of plain static files:

```
your-game/
  index.html        <- the entry point, must be called this
  game.json         <- a few lines of metadata
  (anything else: .js, .css, images, audio, fonts)
```

`game.json`:

```json
{
  "title": "Your Game",
  "author": "Your Name",
  "description": "One line that shows under the frame.",
  "ratio": 0.75
}
```

`ratio` is **height ÷ width**. The frame fills the column and uses this to work
out how tall to be, so it scales on a phone without you doing anything.
`0.75` is 4:3, `0.5625` is 16:9, `1` is square, `1.4` is portrait.

That's it. No build step required, no framework expected. If it runs by opening
`index.html` off a local web server, it'll run here.

---

## The one thing that will trip you up

Your game runs inside a sandboxed frame. Concretely, it's embedded like this:

```html
<iframe src="/play/your-game/" sandbox="allow-scripts allow-pointer-lock"></iframe>
```

Note what's **missing**: `allow-same-origin`. That's deliberate and it isn't
negotiable — it's the thing that makes it safe to let people put code on a page
other members visit. Your game gets an *opaque origin*, which means:

### Things that will throw

| What | Why | What to do instead |
|---|---|---|
| `localStorage` / `sessionStorage` | Opaque origins have no storage access — it throws on *access*, not just write | Keep state in a plain variable. If you must try, wrap every read and write in `try/catch`. |
| `document.cookie` | Same | Don't. |
| `window.parent.anything` | Can't see the page around it | Nothing to do — just don't. |

### Things that are blocked by policy

Anything that leaves the server. The page is served with `connect-src 'none'`
and everything else locked to `'self'`:

- `fetch()` / `XMLHttpRequest` to anywhere — **including** your own API
- Google Fonts, or any `<link>` to a CDN
- `<script src="https://cdn...">` — jQuery, Three.js, Phaser, howler, all of it
- Analytics, error reporting, leaderboards, high-score servers
- Images or audio hotlinked from another site

**Fix: bundle everything into your folder.** Download the library, drop it in,
reference it relatively (`<script src="phaser.min.js">`). Same for fonts and
assets.

This is the bit worth checking before you start porting — if your game pulls a
font or a library from a CDN, it'll look broken here and the console will be
full of CSP errors, and that's why.

### Things that work completely normally

Canvas 2D, WebGL, Web Audio and `<audio>`, keyboard, mouse, touch and pointer
events, `requestAnimationFrame`, CSS animations, pointer lock, gamepad,
workers, WASM. Anything self-contained is fine.

---

## Test it properly before you send it

Reproduce the sandbox locally — it takes two minutes and saves you a round
trip. In the folder *above* your game, save this as `test.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>sandbox test</title>
<body style="margin:0;background:#222">
<iframe
  src="./your-game/"
  sandbox="allow-scripts allow-pointer-lock"
  style="display:block;width:100vw;height:100vh;border:0"></iframe>
```

Then serve it over HTTP (opening it as a `file://` URL behaves differently):

```bash
npx serve .          # or: python3 -m http.server
```

Open `http://localhost:3000/test.html`, play it, and **keep the console open**.
If it works there with no errors, it'll work on the site. If you see
`SecurityError` or `Content Security Policy`, that's the sandbox telling you
about one of the things in the table above.

---

## Size

Keep the whole folder comfortably under a few megabytes. It ships inside the
app and gets downloaded by everyone who opens a profile using it, some of them
on phone data.

If you've got big audio, convert to compressed formats. If you've got a 4MB
PNG, it probably doesn't need to be.

---

## Sending it over

Two ways, whichever suits:

**Give me the folder.** Zip it and send it, or point me at the repo and I'll
pull it in. I'll drop it into `public/play/` and deploy.

**Or do it yourself.** Ask for access to the site's repo and open a pull
request adding `public/play/your-game/`. I'll review and deploy it.

Either way the code gets read before it goes live. Not a comment on you — it's
the rule for everyone, and it's the reason uploads aren't self-service.

---

## What happens then

Once it's deployed, it shows up in a dropdown under **Edit Profile → Design**,
under "Something to play with". Pick it, save, and it's on your page for
anyone who visits.

It's available to every member, not just you — so if you make something good,
other people can put it on their pages too.

---

## Questions worth asking before you start

**"Can it save high scores?"** Not across visits, and not to a server. In-memory
during a session is fine. If a persistent scoreboard matters, say so — it'd
need building into the site itself rather than the game.

**"Can it know who's playing?"** No, by design. The frame can't see the logged-in
member, and that's the point.

**"Can it be multiplayer?"** Not as it stands — that needs network access. Worth
a conversation if you want it.

**"Can it go full screen?"** The Fullscreen API needs an extra sandbox
permission that isn't on. Ask if you want it; it's a small change.
