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

    // Scouting report: write a bio in the editor, then flip the card to read it.
    await page.evaluate(`(()=>{const t=document.querySelector('textarea[name="bio"]');t.value='Never on time, always worth the wait. Cooks for twelve.';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await click(page, '[data-act="player-save"]');
    await until(page, `location.hash.endsWith('/manage/players')`, 'editor saved');
    const pid = await page.evaluate(`document.querySelector('.prow').getAttribute('href').split('/').pop()`);
    await go(page, `#/d/${id}/p/${pid}`);
    await until(page, `!!document.querySelector('.flip')`, 'flip card');
    await click(page, '.flip');
    await sleep(800);
    check(await page.evaluate(`document.querySelector('.flip').classList.contains('on') && document.querySelector('.flip-back').textContent.includes('Cooks')`), 'card flips to its scouting report');
    await page.screenshot(path.join(OUT, '11-card-back.png'));
    await click(page, '.flip');

    // Lives: in demo mode you vote as each demo friend. 9 eligible, 5 needed.
    const hearts = `document.querySelectorAll('.flip-face:first-child .card-svg path[d^="M4 7.4"][fill="none"]').length`;
    check(await page.evaluate(hearts) === 0, 'card starts with every life');
    await click(page, '[data-act="vote-start"]');
    await until(page, `!!document.querySelector('#vr')`, 'vote dialog');
    await page.evaluate(`document.querySelector('#vr').value='Left the group chat on read'`);
    await click(page, '.overlay .btn.primary');
    await until(page, `!!document.querySelector('.vote')`, 'open vote');
    check(await page.evaluate(`document.querySelector('.tally b').textContent==='1'`), 'starter counts as the first yes');
    const voters = await page.evaluate(`[...document.querySelectorAll('[data-act-change="demo-voter"] option')].map(o=>o.value)`);
    check(voters.length === 9 && !voters.includes('${pid}'), `the card's own friend can't vote (${voters.length} voters)`);
    for (const v of voters.slice(1, 5)) {
      await page.evaluate(`(()=>{const s=document.querySelector('[data-act-change="demo-voter"]');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await sleep(100);
      if (v !== voters[4]) await page.screenshot(path.join(OUT, '12-vote.png'));
      await click(page, '[data-act="vote-cast"][data-take="1"]');
      await sleep(250);
    }
    await until(page, `!document.querySelector('.vote') && document.querySelector('.log li')?.textContent.includes('Life taken')`, 'majority took a life');
    check(await page.evaluate(hearts) === 1, 'card shows one lost life');
    await go(page, `#/d/${id}`);
    await until(page, `!!document.querySelector('.grid')`, 'grid');
    await go(page, `#/d/${id}/p/${pid}`);
    await until(page, `!!document.querySelector('[data-act="vote-start"]')`, 'card page again');

    // A vote the majority spares.
    await click(page, '[data-act="vote-start"]');
    await until(page, `!!document.querySelector('#vr')`, 'vote dialog 2');
    await click(page, '.overlay .btn.primary');
    await until(page, `!!document.querySelector('.vote')`, 'second vote');
    for (const v of voters.slice(1, 6)) {
      await page.evaluate(`(()=>{const s=document.querySelector('[data-act-change="demo-voter"]');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await sleep(100);
      await click(page, '[data-act="vote-cast"][data-take="0"]');
      await sleep(250);
    }
    await until(page, `!document.querySelector('.vote') && document.querySelector('.log li')?.textContent.includes('Spared')`, 'majority spared them');
    check(await page.evaluate(hearts) === 1, 'spared vote costs nothing');

    // Commissioner gives the life back.
    await click(page, '[data-act="vote-close"][data-s="overturned"]');
    await until(page, `!!document.querySelector('.overlay')`, 'give back confirm');
    await click(page, '.overlay .btn.primary');
    await until(page, `${hearts}===0`, 'life given back');

    // Out at zero lives: drop lives to 1 and take it.
    await go(page, `#/d/${id}/manage/edition`);
    await until(page, `!!document.querySelector('input[name="lives"]')`, 'edition tab');
    await page.evaluate(`document.querySelector('input[name="lives"]').value='1'`);
    await click(page, '[data-act="edition-save"]');
    await sleep(300);
    await go(page, `#/d/${id}/p/${pid}`);
    await until(page, `!!document.querySelector('[data-act="vote-start"]')`, 'card page, one life');
    await click(page, '[data-act="vote-start"]');
    await until(page, `!!document.querySelector('#vr')`, 'vote dialog 3');
    await click(page, '.overlay .btn.primary');
    for (const v of voters.slice(1, 5)) {
      await page.evaluate(`(()=>{const s=document.querySelector('[data-act-change="demo-voter"]');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await sleep(100);
      await click(page, '[data-act="vote-cast"][data-take="1"]');
      await sleep(250);
    }
    await until(page, `document.querySelector('.flip-face .card-svg').textContent.includes('OUT')`, 'card stamped OUT');
    await page.screenshot(path.join(OUT, '13-out.png'));
    await go(page, `#/d/${id}/manage/edition`);
    await until(page, `!!document.querySelector('input[name="lives"]')`, 'edition tab again');
    await page.evaluate(`document.querySelector('input[name="lives"]').value='5'`);
    await click(page, '[data-act="edition-save"]');
    await sleep(300);

    // Head to head.
    await go(page, `#/d/${id}/vs`);
    await until(page, `document.querySelectorAll('.vs .card-svg').length===2 && document.querySelectorAll('.vsrow').length===7`, 'compare page');
    const wins = await page.evaluate(`document.querySelectorAll('.vsrow .v.win').length`);
    check(wins >= 1, `compare marks winners (${wins})`);
    const picked = await page.evaluate(`[...document.querySelectorAll('[data-act-change="vs-pick"]')].map(s=>s.value)`);
    await page.evaluate(`(()=>{const s=document.querySelector('[data-side="a"]');s.value=${JSON.stringify(picked[1])};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(page, `(()=>{const v=[...document.querySelectorAll('[data-act-change="vs-pick"]')].map(s=>s.value);return v[0]===${JSON.stringify(picked[1])}&&v[1]===${JSON.stringify(picked[0])}})()`, 'picking the other card swaps sides');
    await page.screenshot(path.join(OUT, '14-compare.png'));

    // XSS: a hostile stat value from another user must render as text.
    await page.evaluate(`(async()=>{const {db}=await import('./js/db.js');
      await db.batch([{op:'update',path:'decks/${id}/players/${pid}',data:{'stats.LAT':'<img src=x onerror="window.__pwned=1">'}},
        {op:'set',path:'decks/${id}/history/evil',data:{pid:'${pid}',pname:'x',key:'LAT',from:'<img src=x onerror="window.__pwned=1">',to:5,kind:'edit',byUid:'x',byName:'<b>x</b>',at:Date.now()}}])})()`);
    await go(page, `#/d/${id}/p/${pid}`);
    await sleep(600);
    await go(page, `#/d/${id}/manage/history`);
    await sleep(600);
    check(!(await page.evaluate('window.__pwned')), 'hostile values render as text');

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
    for (const [h, name] of [[href, 'p-deck'], [`#/d/${id}/vs`, 'p-compare'], [`#/d/${id}/manage/roles`, 'p-roles'], [`#/d/${id}/manage/players`, 'p-players']]) {
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
