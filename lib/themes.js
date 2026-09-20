'use strict';

/**
 * Preset layouts. Each one is just a bag of `layouts` column values, so
 * "apply a theme" is the same code path as "the user tweaked one colour".
 */
const THEMES = {
  classic: {
    label: 'MySpace Classic',
    bg_color: '#e5e5e5', text_color: '#000000', link_color: '#003399',
    link_hover_color: '#ff0000', table_bg: '#ffffff', border_color: '#6699cc',
    header_bg: '#ff9933', header_text: '#ffffff',
    font_family: 'Verdana, Arial, sans-serif', font_size: '11px', table_opacity: 1,
  },
  blackglitter: {
    label: 'Black Glitter',
    bg_color: '#000000', text_color: '#e8e8e8', link_color: '#ff33cc',
    link_hover_color: '#66ffff', table_bg: '#0d0d0d', border_color: '#ff33cc',
    header_bg: '#ff33cc', header_text: '#000000',
    font_family: 'Verdana, Arial, sans-serif', font_size: '11px', table_opacity: 0.9,
  },
  emo: {
    label: 'Emo Night',
    bg_color: '#141414', text_color: '#d6d6d6', link_color: '#cc0033',
    link_hover_color: '#ffffff', table_bg: '#1c1c1c', border_color: '#cc0033',
    header_bg: '#cc0033', header_text: '#ffffff',
    font_family: 'Courier New, monospace', font_size: '11px', table_opacity: 0.94,
  },
  scene: {
    label: 'Scene Kid',
    bg_color: '#ff66cc', text_color: '#1a1a1a', link_color: '#00ccff',
    link_hover_color: '#ffff00', table_bg: '#ffffff', border_color: '#00ccff',
    header_bg: '#00ccff', header_text: '#ffffff',
    font_family: 'Comic Sans MS, Verdana, sans-serif', font_size: '12px', table_opacity: 0.92,
  },
  matrix: {
    label: 'Matrix',
    bg_color: '#000000', text_color: '#33ff66', link_color: '#00ff00',
    link_hover_color: '#ccffcc', table_bg: '#020a02', border_color: '#00aa33',
    header_bg: '#003b11', header_text: '#66ff99',
    font_family: 'Courier New, monospace', font_size: '12px', table_opacity: 0.85,
  },
  vaporwave: {
    label: 'Vaporwave',
    bg_color: '#2b1055', text_color: '#f2e9ff', link_color: '#00f0ff',
    link_hover_color: '#ff71ce', table_bg: '#3a1a6b', border_color: '#ff71ce',
    header_bg: '#ff71ce', header_text: '#2b1055',
    font_family: 'Verdana, Arial, sans-serif', font_size: '12px', table_opacity: 0.88,
  },
  y2k: {
    label: 'Y2K Chrome',
    bg_color: '#b3d9ff', text_color: '#00204d', link_color: '#0044cc',
    link_hover_color: '#ff6600', table_bg: '#eef7ff', border_color: '#4d94ff',
    header_bg: '#0066cc', header_text: '#ffffff',
    font_family: 'Tahoma, Verdana, sans-serif', font_size: '11px', table_opacity: 1,
  },
  sunset: {
    label: 'Sunset Strip',
    bg_color: '#ff9966', text_color: '#331100', link_color: '#993300',
    link_hover_color: '#ffffff', table_bg: '#fff2e6', border_color: '#cc5200',
    header_bg: '#cc5200', header_text: '#ffffff',
    font_family: 'Georgia, serif', font_size: '12px', table_opacity: 0.95,
  },
  paper: {
    label: 'Clean Paper',
    bg_color: '#f5f2ea', text_color: '#22201c', link_color: '#8a5a00',
    link_hover_color: '#c07800', table_bg: '#fffdf7', border_color: '#d8cfba',
    header_bg: '#8a7a5a', header_text: '#fffdf7',
    font_family: 'Georgia, serif', font_size: '12px', table_opacity: 1,
  },
  midnight: {
    label: 'Midnight Blue',
    bg_color: '#0b1b33', text_color: '#dbe7f7', link_color: '#66b3ff',
    link_hover_color: '#ffcc00', table_bg: '#12294a', border_color: '#2f5c96',
    header_bg: '#2f5c96', header_text: '#ffffff',
    font_family: 'Verdana, Arial, sans-serif', font_size: '11px', table_opacity: 0.95,
  },
};

const CURSORS = [
  ['', 'Default'],
  ['crosshair', 'Crosshair'],
  ['pointer', 'Pointer / hand'],
  ['help', 'Help'],
  ['wait', 'Hourglass'],
  ['move', 'Move'],
  ['progress', 'Progress'],
  ['cell', 'Cell'],
  ['zoom-in', 'Zoom in'],
  ['grab', 'Grab'],
  ['none', 'Invisible (evil)'],
];

const FONTS = [
  'Verdana, Arial, sans-serif',
  'Tahoma, Verdana, sans-serif',
  'Arial, Helvetica, sans-serif',
  'Georgia, Times New Roman, serif',
  'Times New Roman, Georgia, serif',
  'Courier New, monospace',
  'Comic Sans MS, Verdana, sans-serif',
  'Impact, Charcoal, sans-serif',
  'Trebuchet MS, Verdana, sans-serif',
  'Papyrus, Comic Sans MS, fantasy',
];

const HERE_FOR = ['Networking', 'Dating', 'Serious Relationships', 'Friends', 'Chaos'];

const BLOG_CATEGORIES = [
  'Life', 'Music', 'Movies, TV, Celebrities', 'Writing and Poetry', 'Travel and Places',
  'News and Politics', 'Religion and Philosophy', 'Games', 'Food and Restaurants',
  'Jobs, Work, Careers', 'Dreams and the Supernatural', 'Blogging', 'Goals, Plans, Hopes',
];

module.exports = { THEMES, CURSORS, FONTS, HERE_FOR, BLOG_CATEGORIES };
