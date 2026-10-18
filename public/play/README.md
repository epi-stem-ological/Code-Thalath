# Adding a game

A game is a folder here with an `index.html` and a `game.json`:

```
public/play/your-game/
  index.html
  game.json
  (whatever else it needs: js, css, images, audio)
```

`game.json`:

```json
{
  "title": "Your Game",
  "author": "Your Name",
  "description": "One line about it.",
  "ratio": 0.75
}
```

`ratio` is height divided by width, so the frame scales on a phone. 0.75 is
4:3, 0.5625 is 16:9, 1 is square.

Commit it, deploy, and it appears in the picker under **Edit Profile ->
Design**. Members choose one for their own page.

## What your game can and cannot do

It runs in `sandbox="allow-scripts"` with **no** `allow-same-origin`. That
means an opaque origin:

- **Works:** canvas, WebGL, audio, keyboard and touch input, requestAnimationFrame,
  anything self-contained.
- **Does not work:** `localStorage` and `sessionStorage` (they throw - wrap any
  use in try/catch, or keep state in memory), cookies, reading the page around
  it, navigating the top window.
- **Blocked by policy:** any network request off this server. `connect-src`,
  `img-src` and the rest are locked to `'self'`, so fonts, analytics, CDN
  scripts and leaderboards hosted elsewhere will all fail. Bundle everything
  into your folder.

This is deliberate. A game on someone's profile is third-party code running in
front of every member who visits, and the sandbox is what makes that safe to
allow at all.

## Size

Keep the whole folder well under a few MB. It ships inside the app image and is
downloaded by every visitor who opens a profile using it.
