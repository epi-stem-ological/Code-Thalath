'use strict';

const sanitizeHtml = require('sanitize-html');

/**
 * 2005 markup allowlist. Deliberately generous — <marquee>, <blink>, <font>,
 * nested tables and inline styles are the whole point of a MySpace profile —
 * but scripts, iframes to arbitrary hosts, and event handlers are stripped.
 */
const RICH = {
  allowedTags: [
    'a', 'b', 'i', 'u', 's', 'strike', 'em', 'strong', 'small', 'big', 'sub', 'sup',
    'p', 'br', 'hr', 'div', 'span', 'center', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'img', 'font', 'marquee', 'blink', 'nobr', 'wbr', 'abbr', 'cite', 'q',
    'figure', 'figcaption', 'details', 'summary', 'audio', 'video', 'source',
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'id', 'title', 'align', 'valign', 'dir'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'border', 'hspace', 'vspace'],
    font: ['color', 'face', 'size'],
    marquee: ['behavior', 'direction', 'scrollamount', 'scrolldelay', 'loop', 'width', 'height', 'bgcolor'],
    table: ['width', 'height', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'background'],
    td: ['width', 'height', 'colspan', 'rowspan', 'bgcolor', 'background', 'nowrap'],
    th: ['width', 'height', 'colspan', 'rowspan', 'bgcolor', 'background'],
    tr: ['bgcolor', 'height'],
    hr: ['width', 'size', 'noshade', 'color'],
    audio: ['src', 'controls', 'loop'],
    video: ['src', 'controls', 'loop', 'width', 'height', 'poster'],
    source: ['src', 'type'],
    div: ['style', 'class', 'id', 'title', 'align'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'data'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: true,
  allowedStyles: false, // validated by our own pass below
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      const external = /^https?:\/\//i.test(href);
      return {
        tagName: 'a',
        attribs: external
          ? { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' }
          : attribs,
      };
    },
  },
  exclusiveFilter: () => false,
};

const CSS_BAD = /(expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|@import|<\/?script)/i;

function cleanStyleAttr(html) {
  // sanitize-html with allowedStyles:false keeps style attrs verbatim; strip
  // the handful of values that can execute.
  return String(html).replace(/style\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
    const val = dq !== undefined ? dq : sq;
    if (CSS_BAD.test(val)) return '';
    return m;
  });
}

/** Rich profile HTML (about me, blogs, bulletins, comments). */
function richHtml(input) {
  if (!input) return '';
  return cleanStyleAttr(sanitizeHtml(String(input), RICH));
}

/** Short, plain-ish text: links + basic emphasis only. */
function lightHtml(input) {
  if (!input) return '';
  return sanitizeHtml(String(input), {
    allowedTags: ['a', 'b', 'i', 'u', 'em', 'strong', 'br', 'font', 'span', 'marquee'],
    allowedAttributes: { a: ['href', 'target', 'rel'], font: ['color', 'face', 'size'], span: ['style'], marquee: [] },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&#39;': "'", '&#x27;': "'", '&#x2F;': '/', '&nbsp;': ' ',
};

/**
 * Tag-free text. sanitize-html escapes what it strips, so decode afterwards —
 * these values are re-escaped by the template on the way out, and storing
 * `Alice&#39;s` would surface as `Alice&amp;#39;s` on the page.
 */
function plain(input, max = 2000) {
  const stripped = sanitizeHtml(String(input ?? ''), { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#x2F);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (m, d) => {
      const code = Number(d);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    .slice(0, max);
}

/**
 * Scope user CSS to the profile shell so a bad rule can't nuke the site chrome.
 * Splits on top-level braces, rewrites selectors, keeps @media/@keyframes,
 * drops @import and executable values.
 */
function scopedCss(css, scope = '#ms-profile') {
  if (!css) return '';
  let src = String(css).slice(0, 60000);
  src = src.replace(/<\/?[a-z][\s\S]*?>/gi, ''); // no smuggled tags
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');    // comments
  src = src.replace(/@import[^;]*;?/gi, '');
  src = src.replace(/@charset[^;]*;?/gi, '');

  const out = [];
  let i = 0;
  const len = src.length;

  function parseBlock(prefixSelectors, insideKeyframes) {
    while (i < len) {
      // read until '{' or '}'
      let start = i;
      while (i < len && src[i] !== '{' && src[i] !== '}') i++;
      const head = src.slice(start, i).trim();
      if (i >= len) {
        if (head) out.push('');
        return;
      }
      if (src[i] === '}') { i++; return; }
      i++; // consume '{'

      if (head.startsWith('@')) {
        const at = head.toLowerCase();
        if (at.startsWith('@media') || at.startsWith('@supports')) {
          out.push(head + '{');
          parseBlock(prefixSelectors, insideKeyframes);
          out.push('}');
        } else if (at.startsWith('@keyframes') || at.startsWith('@-webkit-keyframes')) {
          out.push(head + '{');
          parseBlock(null, true);
          out.push('}');
        } else if (at.startsWith('@font-face')) {
          const body = readDecls();
          out.push('@font-face{' + body + '}');
        } else {
          readDecls(); // unknown at-rule: drop
        }
        continue;
      }

      const body = readDecls();
      if (!body) continue;
      const sel = insideKeyframes ? head : scopeSelector(head, scope);
      if (sel) out.push(sel + '{' + body + '}');
    }
  }

  function readDecls() {
    let start = i;
    let depth = 0;
    while (i < len) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    const raw = src.slice(start, i);
    i++; // consume '}'
    return raw
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && !CSS_BAD.test(d))
      .join(';');
  }

  parseBlock(null, false);
  return out.join('\n');
}

function scopeSelector(selectorList, scope) {
  return selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (/^(html|body)\b/i.test(s)) {
        // body { background: ... } is *the* MySpace move — retarget it at the shell.
        const rest = s.replace(/^(html|body)\s*/i, '').trim();
        return rest ? `${scope} ${rest}` : scope;
      }
      if (s.startsWith(':root')) return scope + s.slice(5);
      if (s.startsWith('&')) return scope + s.slice(1);
      return `${scope} ${s}`;
    })
    .join(',');
}

/** A single CSS colour/length token from a form field. */
function cssValue(v, fallback = '') {
  const s = String(v ?? '').trim().slice(0, 120);
  if (!s) return fallback;
  if (CSS_BAD.test(s) || /[{};<>]/.test(s)) return fallback;
  return s;
}

function cssUrl(v) {
  const s = String(v ?? '').trim().slice(0, 500);
  if (!s) return '';
  if (!/^(https?:\/\/|\/)/i.test(s)) return '';
  if (/["'()\\<>]/.test(s)) return '';
  return s;
}

module.exports = { richHtml, lightHtml, plain, scopedCss, cssValue, cssUrl };
