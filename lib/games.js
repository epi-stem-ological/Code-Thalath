'use strict';

/**
 * Self-hosted interactive bits a member can put on their profile.
 *
 * A game is a folder of static files under public/play/<slug>/ with an
 * index.html and a game.json beside it. Nothing is uploaded at runtime: games
 * arrive by commit, which means no archive extraction, no path-traversal
 * surface, and the code is reviewable before it ever reaches anyone.
 *
 * They are framed with sandbox="allow-scripts" and NO allow-same-origin, so
 * the frame runs in an opaque origin: it cannot read cookies, cannot touch the
 * page around it, and cannot act as the person viewing it.
 */

const fs = require('fs');
const path = require('path');

const PLAY_DIR = path.join(__dirname, '..', 'public', 'play');

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

let cache = null;

function discover() {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(PLAY_DIR, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    if (!e.isDirectory() || !SLUG.test(e.name)) continue;
    const dir = path.join(PLAY_DIR, e.name);
    if (!fs.existsSync(path.join(dir, 'index.html'))) continue;

    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8'));
    } catch { /* game.json is optional */ }

    out.push({
      slug: e.name,
      title: String(meta.title || e.name).slice(0, 60),
      author: String(meta.author || '').slice(0, 60),
      description: String(meta.description || '').slice(0, 200),
      // height as a share of width, so it scales on a phone
      ratio: Math.min(2.5, Math.max(0.3, Number(meta.ratio) || 0.75)),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Cached, because this is read on every profile render. */
function list() {
  if (!cache) cache = discover();
  return cache;
}

function get(slug) {
  if (!slug || !SLUG.test(String(slug))) return null;
  return list().find((g) => g.slug === slug) || null;
}

function refresh() { cache = null; return list(); }

module.exports = { list, get, refresh, PLAY_DIR, SLUG };
