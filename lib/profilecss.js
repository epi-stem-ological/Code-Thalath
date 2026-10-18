'use strict';

const { scopedCss, cssValue } = require('./sanitize');

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function bgUrl(value) {
  if (!value) return '';
  const v = String(value);
  // Uploaded files only. A remote wallpaper URL would fetch from a third-party
  // server on every page view, handing them every visitor's IP address.
  if (/^[A-Za-z0-9._-]+$/.test(v)) return `/uploads/${v}`;
  return '';
}

/**
 * Turn the layout row into a stylesheet.
 *  - the wallpaper goes on <body>, like it did in 2005
 *  - everything else is scoped to #ms-profile so the site chrome survives
 *    whatever the user pastes into the custom-CSS box
 */
function profileCss(layout) {
  if (!layout) return '';
  const c = (v, f) => cssValue(v, f);
  const L = {
    bg_color: c(layout.bg_color, '#e5e5e5'),
    text_color: c(layout.text_color, '#000000'),
    link_color: c(layout.link_color, '#003399'),
    link_hover: c(layout.link_hover_color, '#ff0000'),
    table_bg: c(layout.table_bg, '#ffffff'),
    border: c(layout.border_color, '#6699cc'),
    head_bg: c(layout.header_bg, '#ff9933'),
    head_tx: c(layout.header_text, '#ffffff'),
    font: c(layout.font_family, 'Verdana, Arial, sans-serif'),
    size: c(layout.font_size, '11px'),
    cursor: c(layout.cursor_style, ''),
    repeat: c(layout.bg_repeat, 'repeat'),
    attach: c(layout.bg_attachment, 'fixed'),
    size_bg: c(layout.bg_size, 'auto'),
    pos: c(layout.bg_position, 'center top'),
  };
  const img = bgUrl(layout.bg_image);
  const opacity = Number(layout.table_opacity);
  const panel = Number.isFinite(opacity) && opacity < 1
    ? (hexToRgba(L.table_bg, opacity) || L.table_bg)
    : L.table_bg;

  const out = [];

  out.push(`body.profile-view{background-color:${L.bg_color};color:${L.text_color};}`);
  if (img) {
    out.push(
      `body.profile-view{background-image:url("${img}");background-repeat:${L.repeat};` +
      `background-attachment:${L.attach};background-size:${L.size_bg};background-position:${L.pos};}`
    );
  }
  if (L.cursor) out.push(`body.profile-view,body.profile-view *{cursor:${L.cursor};}`);

  out.push(
    `#ms-profile{background:transparent;border:0;padding:0;color:${L.text_color};` +
    `font-family:${L.font};font-size:${L.size};}`
  );
  out.push(`#ms-profile a{color:${L.link_color};}`);
  out.push(`#ms-profile a:hover{color:${L.link_hover};}`);
  out.push(`#ms-profile .ms-sect,#ms-profile .extendedNetwork{background:${panel};border-color:${L.border};}`);
  out.push(`#ms-profile .ms-secthead{background:${L.head_bg};color:${L.head_tx};}`);
  out.push(`#ms-profile table.interests td.lbl{background:${L.head_bg};color:${L.head_tx};}`);
  out.push(`#ms-profile .nametext,#ms-profile h1.profile-name{color:${L.link_color};}`);
  out.push(`#ms-profile .pic-main,#ms-profile .topfriend img,#ms-profile .cmt .who img{border-color:${L.border};}`);
  out.push(`#ms-profile .friendsComments .cmt{border-top-color:${L.border};}`);
  out.push(`#ms-profile .dim,#ms-profile .cmt .when{color:${L.text_color};opacity:.65;}`);

  const cols = Math.max(1, Math.min(12, Number(layout.top_cols) || 4));
  out.push(`#ms-profile .friendSpace .topgrid{grid-template-columns:repeat(${cols},minmax(0,1fr));}`);

  const custom = scopedCss(layout.custom_css, '#ms-profile');
  if (custom) out.push('\n/* --- custom --- */\n' + custom);

  return out.join('\n');
}

module.exports = { profileCss, hexToRgba, bgUrl };
