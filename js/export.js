// Save a card as a PNG for WhatsApp. An SVG drawn onto a canvas can't see the
// page's fonts, so the font files are embedded into the SVG first.
import { cardSvg } from './card.js';

let fontCss;
async function embeddedFonts() {
  if (fontCss) return fontCss;
  const faces = await Promise.all([400, 600, 800].map(async w => {
    const buf = await (await fetch(`assets/fonts/barlow-${w}.woff2`)).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `@font-face{font-family:'Barlow Condensed';font-weight:${w};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}`;
  }));
  fontCss = faces.join('') + `text{font-family:'Barlow Condensed',sans-serif}`;
  return fontCss;
}

export async function cardPng(deck, player, photo, extra = {}) {
  const svg = cardSvg(deck, player, { ...extra, photo, fontCss: await embeddedFonts(), width: 900 })
    .replace('viewBox="0 0 300 420"', 'viewBox="0 0 300 420" height="1260"');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 900; c.height = 1260;
    c.getContext('2d').drawImage(img, 0, 0, 900, 1260);
    return await new Promise(r => c.toBlob(r, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Phones get the share sheet; desktops get a download.
export async function shareCard(deck, player, photo, extra) {
  const blob = await cardPng(deck, player, photo, extra);
  const name = `${(player.name || 'card').replace(/[^\w-]+/g, '_')}-${deck.year || ''}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
