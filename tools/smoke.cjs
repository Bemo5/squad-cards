// End-to-end check in demo mode: seeds the demo deck, edits a stat, renames a
// stat, opens the pack, exports a PNG, and checks phone width for overflow.
// Needs `node serve.cjs` running. Screenshots land in tools/shots/.
// Usage: node tools/smoke.cjs
const { openPage } = require('./cdp.cjs');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8125/';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const PRELOAD = `window.__errs=[];addEventListener('error',e=>__errs.push(String(e.message||e)));
addEventListener('unhandledrejection',e=>__errs.push('rejection: '+(e.reason&&e.reason.message||e.reason)));
const _ce=console.error;console.error=(...a)=>{__errs.push(a.map(String).join(' '));_ce(...a)};`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function until(page, expr, what, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await page.evaluate(expr).catch(() => false)) return true;
    await sleep(150);
  }
  check(false, `timed out waiting for ${what}`);
  return false;
}
const click = (page, sel) => page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`);
const go = (page, hash) => page.evaluate(`location.hash=${JSON.stringify(hash)}`);

(async () => {
  const page = await openPage(BASE, { width: 1280, height: 900, dpr: 1, mobile: false, preload: PRELOAD });
  try {
    await until(page, `document.querySelectorAll('.deck-row').length===1`, 'seeded demo deck');
    await page.screenshot(path.join(OUT, '1-home.png'));
    const deckHref = await page.evaluate(`document.querySelector('.deck-row').getAttribute('href')`);
    const id = deckHref.split('/')[2];

    await go(page, deckHref);
    await until(page, `document.querySelectorAll('.grid .card-svg').length===10`, '10 cards in grid');
    await sleep(300);
    await page.screenshot(path.join(OUT, '2-deck.png'));
    const order = await page.evaluate(`[...document.querySelectorAll('.grid a')].map(a=>a.querySelector('text[font-size="66"]').textContent)`);
    check(order.every((v, i) => i === 0 || +order[i - 1] >= +v), `grid sorted by overall: ${order.join(' ')}`);

    // Edit a stat on the first card through the stepper and save.
    const first = await page.evaluate(`document.querySelector('.grid a').getAttribute('href')`);
    await go(page, first);
    await until(page, `!!document.querySelector('.statrow')`, 'card page');
    const before = await page.evaluate(`document.querySelector('.statrow .v').textContent`);
    await click(page, '[data-act="step"][data-d="1"]');
    await click(page, '[data-act="step"][data-d="1"]');
    await until(page, `document.querySelector('.statrow .v').textContent==='${Math.min(99, +before + 2)}'`, 'stepper raised value');
    await click(page, '[data-act="save-stats"]');
    await until(page, `document.querySelectorAll('.log li').length===1`, 'history entry after save');
    await page.screenshot(path.join(OUT, '3-card.png'));

    // Undo it.
    await click(page, '[data-act="undo"]');
    await until(page, `!!document.querySelector('.overlay')`, 'undo confirm');
    await click(page, '.overlay .btn.primary');
    await until(page, `document.querySelector('.statrow .v').textContent==='${before}'`, 'undo restored value');

    // Rename BAN -> BNT and check values carried across.
    await go(page, `#/d/${id}/manage/stats`);
    await until(page, `!!document.querySelector('#tab input.code')`, 'stats tab');
    await page.evaluate(`(()=>{const i=document.querySelector('#tab input.code');i.value='BNT';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await page.screenshot(path.join(OUT, '4-stats-tab.png'));
    await click(page, '[data-act="stats-save"]');
    await sleep(400);
    const migrated = await page.evaluate(`(()=>{const d=JSON.parse(localStorage.getItem('squad.local.v1'));
      const ps=Object.entries(d).filter(([k])=>k.startsWith('decks/${id}/players/')).map(([,v])=>v);
      return ps.length===10 && ps.every(p=>p.stats.BNT>0 && !('BAN' in p.stats))})()`);
    check(migrated, 'renamed stat carried every player value across');

    // Roles and tiers tabs render.
    for (const t of ['roles', 'tiers', 'people', 'inbox', 'history', 'edition', 'players']) {
      await go(page, `#/d/${id}/manage/${t}`);
      await until(page, `document.querySelector('.tabs a.on')?.href.endsWith('/${t}') && document.querySelector('#tab').children.length>0`, `${t} tab`);
      if (t === 'roles' || t === 'edition') await page.screenshot(path.join(OUT, `5-${t}.png`));
    }

    // Player editor + live preview.
    await click(page, '.prow');
    await until(page, `!!document.querySelector('#pv .card-svg')`, 'player editor preview');
    await page.evaluate(`(()=>{const i=document.querySelector('input[name="name"]');i.value='Testname';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await until(page, `document.querySelector('#pv').textContent.includes('TESTNAME')`, 'preview follows typing');
    await page.screenshot(path.join(OUT, '6-editor.png'));

    // Export a PNG.
    const png = await page.evaluate(`(async()=>{const {cardPng}=await import('./js/export.js');const {db}=await import('./js/db.js');
      const d=JSON.parse(localStorage.getItem('squad.local.v1'));const deck={id:'${id}',...d['decks/${id}']};
      const [pid,p]=Object.entries(d).find(([k])=>k.startsWith('decks/${id}/players/'));
      const b=await cardPng(deck,{id:pid.split('/').pop(),...p},null);const buf=new Uint8Array(await b.arrayBuffer());
      let s='';for(let i=0;i<buf.length;i+=32768)s+=String.fromCharCode(...buf.subarray(i,i+32768));return btoa(s)})()`);
    fs.writeFileSync(path.join(OUT, '7-export.png'), Buffer.from(png, 'base64'));
    check(png.length > 20000, `exported PNG (${Math.round(png.length * .75 / 1024)} KB)`);

    // Pack opening: tap through to the walkout.
    await go(page, `#/d/${id}/reveal`);
    await until(page, `!!document.querySelector('.pack')`, 'pack');
    await page.screenshot(path.join(OUT, '8-pack.png'));
    for (let i = 0; i < 10; i++) { await click(page, '#rv'); await sleep(120); }
    await until(page, `document.querySelector('#rvc').textContent==='Best card'`, 'walkout started');
    await sleep(1500);
    await page.screenshot(path.join(OUT, '9-walkout.png'));
    await until(page, `!!document.querySelector('#rvs .card-svg')`, 'best card shown', 6000);
    await sleep(900);
    await page.screenshot(path.join(OUT, '10-best.png'));
    await click(page, '#rv');
    await until(page, `location.hash==='#/d/${id}'`, 'back to squad after pack');

    const errs = await page.evaluate('window.__errs');
    check(!errs.length, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  } finally { page.close(); }

  // Phone width: no sideways scroll on the main screens.
  const phone = await openPage(BASE, { width: 390, height: 844, dpr: 2, mobile: true, preload: PRELOAD });
  try {
    await until(phone, `document.querySelectorAll('.deck-row').length>=1`, 'phone home');
    const href = await phone.evaluate(`document.querySelector('.deck-row').getAttribute('href')`);
    const id = href.split('/')[2];
    for (const [h, name] of [[href, 'p-deck'], [`#/d/${id}/manage/roles`, 'p-roles'], [`#/d/${id}/manage/players`, 'p-players']]) {
      await go(phone, h);
      await sleep(700);
      const w = await phone.evaluate(`document.documentElement.scrollWidth`);
      check(w <= 390, `${name} fits 390px (scrollWidth ${w})`);
      await phone.screenshot(path.join(OUT, `${name}.png`));
    }
    const first = await phone.evaluate(`document.querySelector('.prow')?.getAttribute('href')`);
    await go(phone, first.replace('/edit/', '/p/'));
    await sleep(700);
    check(await phone.evaluate(`document.documentElement.scrollWidth`) <= 390, 'card page fits 390px');
    await phone.screenshot(path.join(OUT, 'p-card.png'));
  } finally { phone.close(); }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
