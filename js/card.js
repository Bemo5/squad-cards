// The card itself: one SVG string per player. Everything the face shows comes
// from the deck config (stats, roles, tiers, skins), so nothing here knows
// about any particular friend group.
import { overall, skinFor } from './overall.js';

// Skins are pure palettes. Adding one here makes it selectable everywhere.
export const SKINS = {
  gold:   { label: 'Gold',   bg: ['#fff4c8', '#efd07a', '#fde9a8', '#d9b04a', '#c4972f', '#8a6418'], ink: '#2e2306', sub: '#4a3a10', edge: '#6e5112', hi: '#fff6d6', ray: '#fff', rayA: .13, glow: '#c99d3a' },
  silver: { label: 'Silver', bg: ['#ffffff', '#d6dade', '#f3f5f7', '#b7bdc4', '#a4abb3', '#6c737b'], ink: '#1e2226', sub: '#353b41', edge: '#565d65', hi: '#ffffff', ray: '#fff', rayA: .13, glow: '#9aa3ad' },
  bronze: { label: 'Bronze', bg: ['#f6d2ae', '#d9965f', '#efbf92', '#bf7c48', '#a8683a', '#6f4220'], ink: '#2c1708', sub: '#46270f', edge: '#5e3415', hi: '#ffe6cc', ray: '#fff', rayA: .12, glow: '#b8743f' },
  toty:   { label: 'Team of the Year', bg: ['#2a4fb8', '#1a3c96', '#13307e', '#0e2566', '#0b1f57', '#060f30'], ink: '#f3d77e', sub: '#e8c869', edge: '#d6b257', hi: '#ffe9a8', ray: '#f3d77e', rayA: .07, glow: '#2c56c9', stars: true, tag: 'TEAM OF THE YEAR' },
  icon:   { label: 'Icon',   bg: ['#fffdf6', '#efe4cc', '#fbf5e6', '#dccaa2', '#cdb98d', '#9c8556'], ink: '#33280f', sub: '#4d3f1e', edge: '#8a7444', hi: '#ffffff', ray: '#c9a960', rayA: .12, glow: '#d9c48f', tag: 'ICON' },
};

// Flags as stripe lists, so a new one is one line. 'h' = horizontal stripes.
export const FLAGS = {
  none: null,
  eg: { name: 'Egypt',       dir: 'h', c: ['#ce1126', '#ffffff', '#111111'], dot: '#c09300' },
  sa: { name: 'Saudi Arabia', dir: 'h', c: ['#006c35'] },
  ae: { name: 'UAE',          dir: 'h', c: ['#00732f', '#ffffff', '#111111'], hoist: '#ff0000' },
  ps: { name: 'Palestine',    dir: 'h', c: ['#111111', '#ffffff', '#009639'], tri: '#ce1126' },
  jo: { name: 'Jordan',       dir: 'h', c: ['#111111', '#ffffff', '#007a3d'], tri: '#ce1126' },
  sy: { name: 'Syria',        dir: 'h', c: ['#ce1126', '#ffffff', '#111111'] },
  iq: { name: 'Iraq',         dir: 'h', c: ['#ce1126', '#ffffff', '#111111'] },
  ye: { name: 'Yemen',        dir: 'h', c: ['#ce1126', '#ffffff', '#111111'] },
  lb: { name: 'Lebanon',      dir: 'h', c: ['#ed1c24', '#ffffff', '#ffffff', '#ed1c24'], dot: '#00a651' },
  ma: { name: 'Morocco',      dir: 'h', c: ['#c1272d'], dot: '#006233' },
  de: { name: 'Germany',      dir: 'h', c: ['#111111', '#dd0000', '#ffce00'] },
  nl: { name: 'Netherlands',  dir: 'h', c: ['#ae1c28', '#ffffff', '#21468b'] },
  fr: { name: 'France',       dir: 'v', c: ['#002395', '#ffffff', '#ed2939'] },
  it: { name: 'Italy',        dir: 'v', c: ['#009246', '#ffffff', '#ce2b37'] },
  ie: { name: 'Ireland',      dir: 'v', c: ['#169b62', '#ffffff', '#ff883e'] },
  be: { name: 'Belgium',      dir: 'v', c: ['#111111', '#fdda24', '#ef3340'] },
  ng: { name: 'Nigeria',      dir: 'v', c: ['#008751', '#ffffff', '#008751'] },
};

const SHAPE = 'M22 34 Q78 34 112 12 L150 2 L188 12 Q222 34 278 34 L300 46 L300 362 Q300 378 284 385 L150 420 L16 385 Q0 378 0 362 L0 46 Z';
let seq = 0;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const flagBadge = code => FLAGS[code] ? `<svg viewBox="0 0 34 22" xmlns="http://www.w3.org/2000/svg">${flagSvg(code, 0, 0)}</svg>` : '';

function flagSvg(code, x, y, w = 34, h = 22) {
  const f = FLAGS[code];
  if (!f) return '';
  const n = f.c.length;
  let out = `<g transform="translate(${x} ${y})">`;
  f.c.forEach((c, i) => {
    out += f.dir === 'v'
      ? `<rect x="${(w / n) * i}" width="${w / n + .3}" height="${h}" fill="${c}"/>`
      : `<rect y="${(h / n) * i}" width="${w}" height="${h / n + .3}" fill="${c}"/>`;
  });
  if (f.tri) out += `<path d="M0 0 L${w * .42} ${h / 2} L0 ${h} Z" fill="${f.tri}"/>`;
  if (f.hoist) out += `<rect width="${w * .26}" height="${h}" fill="${f.hoist}"/>`;
  if (f.dot) out += `<circle cx="${w / 2}" cy="${h / 2}" r="${h * .13}" fill="${f.dot}"/>`;
  return out + `<rect width="${w}" height="${h}" fill="none" stroke="#0003" stroke-width=".8"/></g>`;
}

function bust(S) {
  return `<g transform="translate(96 40) scale(1.02)">
 <path d="M0 220 C2 184 20 166 56 156 C70 152 80 148 86 142 Q100 160 114 142 C120 148 130 152 144 156 C180 166 198 184 200 220 Z" fill="${S.ink}" opacity=".78"/>
 <path d="M84 120 L84 150 Q100 162 116 150 L116 120 Z" fill="${S.ink}" opacity=".62"/>
 <ellipse cx="61" cy="84" rx="6" ry="12" fill="${S.ink}" opacity=".6"/><ellipse cx="139" cy="84" rx="6" ry="12" fill="${S.ink}" opacity=".6"/>
 <path d="M100 22 C128 22 140 44 139 70 C139 82 137 94 133 104 C128 120 116 132 100 134 C84 132 72 120 67 104 C63 94 61 82 61 70 C60 44 72 22 100 22 Z" fill="${S.ink}" opacity=".6"/>
 <path d="M59 70 C54 34 76 10 102 10 C132 10 148 34 141 70 C137 54 128 44 112 42 C96 48 78 46 66 52 C62 56 60 62 59 70 Z" fill="${S.ink}" opacity=".85"/>
 <path d="M84 146 L100 174 L116 146" fill="none" stroke="${S.hi}" stroke-opacity=".35" stroke-width="3"/>
</g>`;
}

// Photo box: 200 wide, top at y=34, centred on x=190, then nudged by photoPos.
function photo(src, pos = {}) {
  // Photos come from other people's writes: only ever an image data URL.
  if (!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(src)) return '';
  const n = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
  const s = n(pos?.s, 1), w = 200 * s;
  const x = 190 - w / 2 + n(pos?.x, 0), y = 34 + n(pos?.y, 0);
  return `<image href="${src}" x="${x}" y="${y}" width="${w}" height="${w * 1.4}" preserveAspectRatio="xMidYMin meet"/>`;
}

function statBlock(deck, p, S) {
  const stats = deck.stats || [];
  const n = stats.length;
  if (!n) return '';
  const single = n <= 3;
  const rows = single ? n : Math.ceil(n / 2);
  const top = 296, span = 84;
  const step = Math.min(29, span / rows);
  const fs = Math.min(27, step * .95);
  let out = single ? '' : `<line x1="150" x2="150" y1="${top - 3}" y2="${top + rows * step - 4}" stroke="${S.edge}" stroke-opacity=".6"/>`;
  stats.forEach((st, i) => {
    const col = single ? 0 : (i < rows ? 0 : 1), r = single ? i : i % rows;
    const x = single ? 114 : (col ? 170 : 58);
    const y = top + step * (r + 1) - step * .18;
    const v = p.stats?.[st.key] ?? '';
    out += `<text x="${x + 30}" y="${y}" font-size="${fs}" font-weight="800" text-anchor="end" fill="${S.ink}">${esc(v)}</text>`
         + `<text x="${x + 36}" y="${y}" font-size="${fs * .89}" font-weight="400" fill="${S.sub}">${esc(st.key)}</text>`;
  });
  return out;
}

// Shared by both faces: background, rays, sheen and the embossed border.
function frame(deck, p, opts) {
  const id = 'k' + (++seq);
  const ovr = overall(p, deck);
  const S = SKINS[skinFor(p, deck, ovr)] || SKINS.gold;
  const stops = S.bg.map((c, i) => `<stop offset="${i / (S.bg.length - 1)}" stop-color="${c}"/>`).join('');
  let rays = '';
  for (let a = -80; a <= 80; a += 8) {
    const t = Math.tan(a * Math.PI / 180) * 260 + 150;
    rays += `<path d="M150 -20 L${t - 7} 240 L${t + 7} 240 Z"/>`;
  }
  const stars = S.stars ? Array.from({ length: 26 }, (_, j) =>
    `<circle cx="${(j * 67) % 290 + 5}" cy="${(j * 131) % 400 + 10}" r="${.6 + (j % 3) * .6}" fill="#fff" opacity="${.25 + (j % 4) * .15}"/>`).join('') : '';
  const W = opts.width ? ` width="${Number(opts.width)}"` : '';
  const out = opts.lives && opts.lives.total > 0 && opts.lives.left === 0;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420"${W} class="card-svg">
 ${opts.fontCss ? `<style>${opts.fontCss}</style>` : ''}
 <defs><linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
 <clipPath id="c${id}"><path d="${SHAPE}"/></clipPath>
 <linearGradient id="f${id}" x1="0" y1="0" x2="0" y2="1"><stop offset=".83" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <mask id="m${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="300" height="420"><rect width="300" height="268" fill="url(#f${id})"/></mask>
 <linearGradient id="s${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 ${out ? `<filter id="o${id}"><feColorMatrix type="saturate" values=".15"/></filter>` : ''}</defs>
 <g${out ? ` filter="url(#o${id})"` : ''}>
 <path d="${SHAPE}" fill="url(#g${id})"/>
 <g clip-path="url(#c${id})">
  <g fill="${S.ray}" opacity="${S.rayA}">${rays}</g>${stars}
  <rect x="-60" y="-40" width="70" height="520" fill="url(#s${id})" transform="rotate(22)"/>
  <rect x="150" y="-60" width="30" height="560" fill="url(#s${id})" transform="rotate(22)" opacity=".7"/>
  <path d="${SHAPE}" fill="none" stroke="${S.edge}" stroke-width="7"/>
 </g>
 <path d="${SHAPE}" fill="none" stroke="${S.hi}" stroke-opacity=".8" stroke-width="1.5" transform="translate(5.5 6.5) scale(.963)"/>
 <path d="${SHAPE}" fill="none" stroke="${S.edge}" stroke-opacity=".7" stroke-width="1.5" transform="translate(11 13) scale(.926)"/>`;
  // Out of lives: the whole card goes grey under a red stamp, so the
  // stamp is drawn after the face's group closes.
  const close = ` <path d="M140 396 L150 390 L160 396 L150 402 Z" fill="${S.edge}" opacity=".8"/>
 </g>${out ? `<g transform="rotate(-18 150 210)">
  <rect x="58" y="176" width="184" height="64" rx="6" fill="none" stroke="#c8231d" stroke-width="6"/>
  <text x="150" y="228" font-size="56" font-weight="800" text-anchor="middle" fill="#c8231d" letter-spacing="6">OUT</text></g>` : ''}
</svg>`;
  return { id, ovr, S, open, close };
}

const HEART = 'M4 7.4 L0.7 4 A2.1 2.1 0 0 1 4 1.3 A2.1 2.1 0 0 1 7.3 4 Z';

// A row of hearts, centred on cx. Lost lives are outlines.
function hearts(S, lives, cx, y, size = 1) {
  if (!lives || !(lives.total > 0)) return '';
  const { left, total } = lives;
  const gap = Math.min(9, 44 / total) * size;
  const x0 = cx - (gap * (total - 1) + 8 * size) / 2;
  let out = '';
  for (let i = 0; i < total; i++) {
    out += `<path d="${HEART}" transform="translate(${(x0 + i * gap).toFixed(2)} ${y}) scale(${size})" fill="${i < left ? S.ink : 'none'}" stroke="${S.ink}" stroke-width="${1 / size}" stroke-opacity=".8"/>`;
  }
  return out;
}

// opts.photo: data URL or null. opts.width: CSS width. opts.fontCss: embedded
// @font-face for standalone export (canvas can't see page fonts).
// opts.lives: {left, total} when the deck plays with lives.
export function cardSvg(deck, p, opts = {}) {
  const { id, ovr, S, open, close } = frame(deck, p, opts);
  const name = String(p.name || '').toUpperCase();
  const nameSize = Math.min(34, 230 / Math.max(1, name.length * .5));
  const tag = p.tag || S.tag || '';
  const flag = p.flag || deck.flag || 'none';
  const crest = deck.crest ?? String(deck.year ?? '').slice(-2);

  return `${open}
 <g clip-path="url(#c${id})"><g mask="url(#m${id})">${opts.photo ? photo(opts.photo, p.photoPos) : bust(S)}</g></g>
 ${tag ? `<text x="150" y="44" font-size="11" font-weight="800" text-anchor="middle" fill="${S.ink}" letter-spacing="2.5">${esc(tag.toUpperCase())}</text>` : ''}
 <text x="64" y="104" font-size="66" font-weight="800" text-anchor="middle" fill="${S.ink}" letter-spacing="-1">${ovr}</text>
 <text x="64" y="132" font-size="25" font-weight="600" text-anchor="middle" fill="${S.ink}">${esc(p.role || '')}</text>
 <line x1="44" x2="84" y1="144" y2="144" stroke="${S.edge}" stroke-opacity=".7"/>
 ${flagSvg(flag, 47, 154)}
 <line x1="44" x2="84" y1="186" y2="186" stroke="${S.edge}" stroke-opacity=".7"/>
 ${crest ? `<g transform="translate(49 194)"><path d="M0 0 H30 V14 Q30 28 15 34 Q0 28 0 14 Z" fill="${S.ink}"/><text x="15" y="21" font-size="13" font-weight="800" text-anchor="middle" fill="${S.stars ? S.bg[4] : S.hi}">${esc(crest)}</text></g>` : ''}
 ${hearts(S, opts.lives, 64, 234)}
 <text x="150" y="272" font-size="${nameSize}" font-weight="800" text-anchor="middle" fill="${S.ink}">${esc(name)}</text>
 <line x1="40" x2="260" y1="285" y2="285" stroke="${S.edge}" stroke-opacity=".6"/>
 ${statBlock(deck, p, S)}
${close}`;
}

// Greedy word wrap by character count; Barlow Condensed is narrow enough
// that ~30 characters fit across the card at 17px.
function wrap(text, max) {
  const lines = [];
  for (const para of String(text || '').split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = word.length > max ? word.slice(0, max - 1) + '-' : word;
      if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; }
      else line = line ? line + ' ' + w : w;
    }
    if (line) lines.push(line);
  }
  return lines;
}

// The back: a scouting report. Same skin and frame as the front.
export function cardBackSvg(deck, p, opts = {}) {
  const { ovr, S, open, close } = frame(deck, p, opts);
  const name = String(p.name || '').toUpperCase();
  const nameSize = Math.min(38, 250 / Math.max(1, name.length * .5));
  const role = (deck.roles || []).find(r => r.code === p.role);
  const sub = [ovr + ' OVR', role ? role.name : p.role].filter(Boolean).join('  ·  ').toUpperCase();
  let lines = wrap(p.bio, 30);
  if (lines.length > 9) { lines = lines.slice(0, 9); lines[8] = lines[8].replace(/.{0,2}$/, '...'); }
  const body = lines.length
    ? lines.map((l, i) => `<text x="150" y="${168 + i * 21}" font-size="17" text-anchor="middle" fill="${S.ink}">${esc(l)}</text>`).join('')
    : `<text x="150" y="200" font-size="17" text-anchor="middle" fill="${S.sub}" opacity=".75">No scouting report yet.</text>`;
  const lv = opts.lives && opts.lives.total > 0;
  const prev = Number.isFinite(p.prevOvr) && deck.year ? `${Number(deck.year) - 1}: ${p.prevOvr} OVR` : '';
  return `${open}
 <text x="150" y="44" font-size="11" font-weight="800" text-anchor="middle" fill="${S.ink}" letter-spacing="2.5">SCOUTING REPORT</text>
 <text x="150" y="94" font-size="${nameSize}" font-weight="800" text-anchor="middle" fill="${S.ink}">${esc(name)}</text>
 <text x="150" y="120" font-size="16" font-weight="600" text-anchor="middle" fill="${S.sub}" letter-spacing="1.5">${esc(sub)}</text>
 <line x1="60" x2="240" y1="136" y2="136" stroke="${S.edge}" stroke-opacity=".6"/>
 ${body}
 <line x1="60" x2="240" y1="${lv ? 336 : 352}" y2="${lv ? 336 : 352}" stroke="${S.edge}" stroke-opacity=".6"/>
 ${lv ? `${hearts(S, opts.lives, 150, 346, 1.5)}
 <text x="150" y="376" font-size="13" font-weight="800" text-anchor="middle" fill="${S.ink}" letter-spacing="2">${opts.lives.left} OF ${opts.lives.total} LIVES LEFT</text>` : ''}
 ${prev ? `<text x="150" y="${lv ? 388 : 372}" font-size="12" font-weight="600" text-anchor="middle" fill="${S.sub}" letter-spacing="1">${esc(prev)}</text>` : ''}
${close}`;
}

export function skinGlow(deck, p) {
  return (SKINS[skinFor(p, deck, overall(p, deck))] || SKINS.gold).glow;
}
