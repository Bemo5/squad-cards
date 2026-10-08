// Routing and every screen. Hash routes:
//   #/                      your decks
//   #/d/ID                  the deck (what friends get sent)
//   #/d/ID/p/PID            one card, with editing/suggesting by role
//   #/d/ID/edit/PID         player editor (commissioner, or the friend linked to that card)
//   #/d/ID/manage/TAB       commissioner settings
//   #/d/ID/reveal           pack opening
//   #/d/ID/vs/A/B           head to head (both cards optional)
import * as S from './store.js';
import { cardSvg, cardBackSvg, SKINS, FLAGS, flagBadge, skinGlow } from './card.js';
import { overall, tierFor, clampStat, deckTemplate, livesTotal, livesLeft, votesNeeded, MAX_LIVES } from './overall.js';
import { shareCard } from './export.js';
import { processPhoto } from './photo.js';
import { esc, $, $$, dialog, confirmDialog, alertDialog, ago } from './ui.js';

const app = $('#app');
let me = null, authReady = false;
let route = {};
let view = null;
let unwatch = null, watchedId, watchedUid;
let drafts = {};
let builtKey = null;
let flipped = false;   // card page and editor preview: showing the back
let demoVoter = null;  // demo mode: which demo friend is casting votes
let vsShown = {};      // compare page: the two cards on screen

const linkTo = id => `${location.origin}${location.pathname}#/d/${id}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const byOvr = (deck, list) => [...list].sort((a, b) => overall(b, deck) - overall(a, deck) || String(a.name).localeCompare(b.name));
const seenKey = id => `squad.seen.${id}`;
const seen = id => { try { return !!localStorage.getItem(seenKey(id)); } catch { return true; } };
const markSeen = id => { try { localStorage.setItem(seenKey(id), '1'); } catch {} };
// Lives on a card face, or null when the deck plays without them.
const livesOf = p => { const total = livesTotal(view.deck); return total ? { left: livesLeft(view.deck, p, view.votes), total } : null; };
const cardOpts = p => ({ photo: view.photos[p.id], lives: livesOf(p) });
// A card that flips to its scouting report when tapped.
const flipCard = (deck, p, opts) => `<div class="flip ${flipped ? 'on' : ''}" data-act="flip" role="button" tabindex="0" aria-label="Flip the card">
  <div class="flip-inner"><div class="flip-face">${cardSvg(deck, p, opts)}</div><div class="flip-face flip-back">${cardBackSvg(deck, p, opts)}</div></div></div>
  <div class="flip-hint">Tap the card to flip it</div>`;
const fail = e => { console.error(e); alertDialog('That did not work', e?.message || String(e)); };

// ---------------------------------------------------------------- routing

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'd' || !parts[1]) return { name: 'home' };
  const [, id, sub, arg, arg2] = parts;
  if (sub === 'vs') return { name: 'vs', id, a: arg, b: arg2 };
  if (sub === 'p' && arg) return { name: 'card', id, pid: arg };
  if (sub === 'edit' && arg) return { name: 'edit', id, pid: arg };
  if (sub === 'manage') return { name: 'manage', id, tab: arg || 'players' };
  if (sub === 'reveal') return { name: 'reveal', id };
  return { name: 'deck', id };
}

function onRoute() {
  if (!authReady) return;
  const prev = route;
  route = parse();
  if (route.id !== watchedId || me?.uid !== watchedUid) subscribe(route.id);
  if (JSON.stringify(prev) !== JSON.stringify(route)) {
    // Swapping a card on the compare page shouldn't jump to the top.
    if (!(prev.name === 'vs' && route.name === 'vs')) window.scrollTo(0, 0);
    drafts = {}; builtKey = null; flipped = false;
  }
  render();
}

function subscribe(id) {
  unwatch?.(); unwatch = null; view = null; watchedId = id; watchedUid = me?.uid;
  if (!id) return;
  let joined = false;
  unwatch = S.watchDeck(id, me, v => {
    view = v;
    if (!joined && v.deck && me) { joined = true; S.ensureMember(id, me, v.deck).catch(console.warn); }
    render();
  });
}

// Pages with typed-in forms are built once per route and afterwards only
// refreshed, so a live update never wipes what you are typing.
function render() {
  renderWho();
  if (route.name === 'home') return homePage();
  if (!view) { app.innerHTML = '<p class="muted loading">Loading</p>'; return; }
  if (!view.deck) { app.innerHTML = `<div class="locked"><h1>No deck here</h1><p class="muted">The link may be wrong, or the deck was deleted.</p></div>`; return; }
  if (route.name === 'deck') return deckPage();
  if (route.name === 'card') return cardPage();
  if (route.name === 'vs') return comparePage();
  const formPage = { edit: editPage, reveal: revealPage, manage: managePage }[route.name];
  const key = JSON.stringify(route);
  if (builtKey === key && formPage.refresh) return formPage.refresh();
  if (builtKey === key && formPage.keep) return;
  builtKey = formPage.keep || formPage.refresh ? key : null;
  formPage();
}

function renderWho() {
  const el = $('#who');
  if (S.isLocal) { el.innerHTML = '<span>Demo mode, saved in this browser</span>'; return; }
  el.innerHTML = me
    ? `<span>${esc(me.name)}</span><button class="linkbtn" data-act="signout">Sign out</button>`
    : `<button class="btn small" data-act="signin">Sign in</button>`;
}

// ---------------------------------------------------------------- home

async function homePage() {
  if (!S.isLocal && !me) {
    app.innerHTML = `<div class="locked"><h1>Squad Cards</h1>
      <p class="muted">FIFA cards for your friends. If someone sent you a link, open that.</p>
      <p class="muted">To make your own deck, sign in.</p>
      <button class="btn primary" data-act="signin">Sign in with Google</button></div>`;
    return;
  }
  let decks = await S.myDecks(me).catch(e => (fail(e), []));
  if (S.isLocal && !decks.length && !localStorage.getItem('squad.seeded')) {
    localStorage.setItem('squad.seeded', '1');
    await seedDemo();
    decks = await S.myDecks(me);
  }
  if (route.name !== 'home') return;
  decks.sort((a, b) => (b.year || 0) - (a.year || 0) || (b.createdAt || 0) - (a.createdAt || 0));
  app.innerHTML = `<div class="deck-head"><div><h1>Your decks</h1>
      <div class="sub">One deck per year. Send friends the deck's link.</div></div>
      <div class="actions"><button class="btn primary" data-act="new-deck">New deck</button></div></div>
    ${S.isLocal ? `<p class="hint">This is demo mode. Everything stays in this browser until Firebase is set up (see FIREBASE-SETUP.md), and links won't work for anyone else yet.</p>` : ''}
    <div class="deck-list">${decks.map(d => `<a class="deck-row" href="#/d/${d.id}">
      <div><b>${esc(d.name)}</b><div class="muted">${d.year} edition${d.revealed ? '' : ', hidden until reveal'}</div></div>
      <span class="muted">Open</span></a>`).join('') || '<div class="empty">No decks yet. Make one for this year.</div>'}</div>`;
}

async function seedDemo() {
  const year = new Date().getFullYear();
  const id = await S.createDeck(me, `Class of ${year}`, year);
  const deck = { id, ...deckTemplate(year) };
  const names = ['Ace', 'Blaze', 'Comet', 'Dash', 'Echo', 'Flash', 'Ghost', 'Hawk', 'Jet', 'Knox'];
  const roles = ['CAP', 'DRV', 'CHF', 'CLN'];
  let n = 7;
  const rnd = (lo, hi) => { n = (n * 9301 + 49297) % 233280; return lo + Math.floor(n / 233280 * (hi - lo)); };
  for (const [i, name] of names.entries()) {
    const pid = await S.addPlayer(deck, name);
    const base = 88 - i * 3;
    const stats = Object.fromEntries(deck.stats.map(s => [s.key, clampStat(s.invert ? 100 - base + rnd(-15, 15) : base + rnd(-14, 10))]));
    await S.updatePlayer(id, pid, { stats, role: roles[i % 4], skin: i === 0 ? 'toty' : '' });
  }
  await S.updateDeck(id, { revealed: true });
}

// ---------------------------------------------------------------- deck

function deltaHtml(deck, p) {
  if (!Number.isFinite(p.prevOvr)) return '';
  const d = overall(p, deck) - p.prevOvr;
  if (!d) return `<span class="muted">Same as ${deck.year - 1}</span>`;
  return `<span class="${d > 0 ? 'delta-up' : 'delta-down'}">${d > 0 ? '+' : ''}${d} from ${deck.year - 1}</span>`;
}

function lockedPage() {
  const d = view.deck;
  const when = d.revealAt ? new Date(d.revealAt).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }) : '';
  app.innerHTML = `<div class="locked"><h1>The ${esc(d.year)} cards drop soon</h1>
    <p class="muted">${when ? `Reveal: ${esc(when)}` : 'The commissioner has not revealed them yet.'}</p>
    ${!S.isLocal && !me ? '<p class="muted">Helping make the cards? Sign in.</p><button class="btn" data-act="signin">Sign in</button>' : ''}</div>`;
}

function deckPage() {
  const { deck, players, photos, myRole, locked, suggestions } = view;
  if (locked) return lockedPage();
  if (deck.revealed && players.length && !S.canSuggest(myRole) && !seen(deck.id)) { location.hash = `#/d/${deck.id}/reveal`; return; }
  const pending = suggestions.filter(s => s.status === 'pending').length;
  app.innerHTML = `<div class="deck-head"><div><h1>${esc(deck.name)}</h1>
      <div class="sub">${deck.year} edition, ${plural(players.length, 'card')}${deck.revealed ? '' : ', hidden until reveal'}</div></div>
    <div class="actions">
      ${players.length ? `<a class="btn" href="#/d/${deck.id}/reveal">Open pack</a>` : ''}
      ${players.length > 1 ? `<a class="btn" href="#/d/${deck.id}/vs">Compare</a>` : ''}
      <button class="btn" data-act="copy-link">Copy link</button>
      ${myRole === 'owner' ? `<a class="btn primary" href="#/d/${deck.id}/manage">Manage${pending ? ` <span class="count">${pending}</span>` : ''}</a>` : ''}
    </div></div>
    ${players.length ? `<div class="grid">${byOvr(deck, players).map(p => `<a href="#/d/${deck.id}/p/${p.id}">
        ${cardSvg(deck, p, cardOpts(p))}<div class="under">${deltaHtml(deck, p)}${view.votes.some(v => v.pid === p.id && v.status === 'open') ? ' <span class="vote-tag">Vote open</span>' : ''}</div></a>`).join('')}</div>`
      : `<div class="empty">No cards yet.${myRole === 'owner' ? ` <a href="#/d/${deck.id}/manage/players">Add your friends</a>.` : ''}</div>`}`;
}

// ---------------------------------------------------------------- one card

function cardPage() {
  const { deck, players, photos, myRole, history, suggestions } = view;
  if (view.locked) return lockedPage();
  const p = players.find(x => x.id === route.pid);
  if (!p) { app.innerHTML = `<a class="back" href="#/d/${deck.id}">Back to the squad</a><div class="empty">That card is gone.</div>`; return; }
  const d = drafts.stats ??= {};
  const shown = { ...p, stats: { ...p.stats, ...d } };
  const ovr = overall(shown, deck);
  const edit = S.canEdit(myRole), sug = !edit && S.canSuggest(myRole);
  const mine = me && p.linkedUid === me.uid;
  const role = (deck.roles || []).find(r => r.code === p.role);
  const dirty = Object.keys(d).some(k => d[k] !== p.stats?.[k]);
  const rows = (deck.stats || []).map(st => {
    const v = esc(shown.stats?.[st.key] ?? '');
    const changed = d[st.key] !== undefined && d[st.key] !== p.stats?.[st.key];
    const right = edit
      ? `<div class="stepper"><button class="btn" data-act="step" data-k="${st.key}" data-d="-1" aria-label="Lower">&minus;</button>
          <span class="v ${changed ? 'changed' : ''}" data-act="setval" data-k="${st.key}">${v}</span>
          <button class="btn" data-act="step" data-k="${st.key}" data-d="1" aria-label="Raise">+</button></div>`
      : `<div class="stepper"><span class="v">${v}</span>${sug ? `<button class="btn small" data-act="suggest" data-k="${st.key}">Suggest</button>` : ''}</div>`;
    return `<div class="statrow"><span class="k">${esc(st.key)}</span><span class="n">${esc(st.name)}${st.invert ? ', higher is worse' : ''}</span>${right}</div>`;
  }).join('');
  const log = history.filter(h => h.pid === p.id).slice(0, 25);
  const mySugs = suggestions.filter(s => s.pid === p.id && s.byUid === me?.uid);

  app.innerHTML = `<a class="back" href="#/d/${deck.id}">Back to the squad</a>
  <div class="detail"><div class="big">${flipCard(deck, shown, { photo: photos[p.id], lives: livesOf(p) })}</div>
  <div>
    <h1>${esc(p.name)}</h1>
    <div class="ovr-line">Overall <b>${ovr}</b>${role ? `, ${esc(role.name)}` : ''}, ${esc(p.skin ? SKINS[p.skin]?.label : tierFor(ovr, deck).name)} ${deltaHtml(deck, shown)}</div>
    <div class="statlist">${rows}</div>
    <div class="actions">
      ${edit ? `<button class="btn primary" data-act="save-stats" ${dirty ? '' : 'disabled'}>Save changes</button>
                ${dirty ? '<button class="btn" data-act="discard">Discard</button>' : ''}` : ''}
      <button class="btn" data-act="save-image">Save image</button>
      ${players.length > 1 ? `<a class="btn" href="#/d/${deck.id}/vs/${p.id}">Compare</a>` : ''}
      ${myRole === 'owner' || mine ? `<a class="btn" href="#/d/${deck.id}/edit/${p.id}">${myRole === 'owner' ? 'Edit card' : 'Edit my card'}</a>` : ''}
    </div>
    ${!S.isLocal && !me ? '<p class="hint">Want to suggest a change? <button class="linkbtn" data-act="signin">Sign in</button> and ask the commissioner to let you.</p>' : ''}
    ${mySugs.length ? `<div class="section"><h3>Your suggestions</h3><ul class="log">${mySugs.map(s => `<li>
      <span>${esc(s.key)} ${esc(s.from ?? '?')} to ${esc(s.to)}${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</span>
      <span class="when">${s.status === 'pending' ? 'Waiting' : s.status === 'accepted' ? 'Approved' : 'Rejected'}</span></li>`).join('')}</ul></div>` : ''}
    ${livesSection(p)}
    ${log.length ? `<div class="section"><h3>Changes</h3>${historyList(log, myRole === 'owner', false)}</div>` : ''}
  </div></div>`;
}

function historyList(rows, canUndo, showName = true) {
  return `<ul class="log">${rows.map(h => `<li><span>${showName ? `<b>${esc(h.pname)}</b> ` : ''}${esc(h.key)} ${esc(h.from ?? '?')} to ${esc(h.to)}
      <div class="note">${h.kind === 'undo' ? 'Undo' : h.kind === 'suggestion' ? 'Approved suggestion' : 'Edit'} by ${esc(h.byName)}${h.note ? `. ${esc(h.note)}` : ''}</div></span>
      <span class="when">${ago(h.at)}${canUndo && h.from != null && h.kind !== 'undo' ? ` <button class="btn small" data-act="undo" data-h="${esc(h.id)}">Undo</button>` : ''}</span></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- lives

const OUTCOME = { passed: 'Life taken', failed: 'Spared', cancelled: 'Vote called off', overturned: 'Life given back' };

// Who is voting on card p, and how many people can. In demo mode there is
// only one real user, so the presenter votes as each demo friend in turn;
// a card's own friend never votes on it.
function voting(p) {
  if (S.isLocal) {
    const pool = byOvr(view.deck, view.players.filter(x => x.id !== p.id));
    const as = pool.find(x => x.id === demoVoter) || pool[0];
    return { eligible: pool.length, pool, who: as ? { uid: as.id, name: as.name } : null, why: 'Add another player to vote.' };
  }
  const voters = view.deck.voters || [];
  const eligible = voters.filter(u => u !== p.linkedUid).length;
  if (!me) return { eligible, who: null, why: 'signin' };
  if (p.linkedUid === me.uid) return { eligible, who: null, why: "You can't vote on your own card." };
  if (!voters.includes(me.uid)) return { eligible, who: null, why: 'You can vote once the commissioner next opens the deck.' };
  return { eligible, who: { uid: me.uid, name: me.name } };
}

function livesSection(p) {
  const total = livesTotal(view.deck);
  if (!total) return '';
  const left = livesLeft(view.deck, p, view.votes);
  const mine = view.votes.filter(v => v.pid === p.id);
  const open = mine.find(v => v.status === 'open');
  const past = mine.filter(v => v !== open).slice(0, 15);
  const vt = voting(p), owner = view.myRole === 'owner';
  const why = vt.why === 'signin'
    ? '<p class="hint">Sign in to vote. <button class="linkbtn" data-act="signin">Sign in</button></p>'
    : `<p class="hint">${esc(vt.why)}</p>`;
  const demoPick = S.isLocal && vt.pool?.length ? `<label class="field demo-as"><span>Demo mode: voting as</span>
    <select data-act-change="demo-voter">${vt.pool.map(x => `<option value="${esc(x.id)}" ${x.id === vt.who?.uid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '';
  let body;
  if (open) {
    const y = Object.keys(open.yes).length, n = Object.keys(open.no).length;
    const cast = vt.who && (open.yes[vt.who.uid] ? 'yes' : open.no[vt.who.uid] ? 'no' : '');
    body = `<div class="vote">
      <div class="vote-head"><b>Vote: take a life</b><span class="when">${ago(open.at)}</span></div>
      ${open.reason ? `<p class="vote-reason">"${esc(open.reason)}"</p>` : ''}
      <div class="muted">Started by ${esc(open.byName)}. Needs ${votesNeeded(vt.eligible)} of ${vt.eligible} to take it.</div>
      <div class="tally"><span><b>${y}</b> take it</span><span><b>${n}</b> spare</span></div>
      ${demoPick}
      ${vt.who ? `<div class="actions"><button class="btn ${cast === 'yes' ? 'primary' : ''}" data-act="vote-cast" data-v="${esc(open.id)}" data-take="1">Take a life</button>
        <button class="btn ${cast === 'no' ? 'primary' : ''}" data-act="vote-cast" data-v="${esc(open.id)}" data-take="0">Spare them</button></div>` : why}
      ${owner ? `<button class="linkbtn" data-act="vote-close" data-v="${esc(open.id)}" data-s="cancelled">Call off this vote</button>` : ''}</div>`;
  } else if (!left) {
    body = '<p class="muted">Out. No lives left.</p>';
  } else {
    body = vt.who ? `${demoPick}<button class="btn" data-act="vote-start">Start a vote to take a life</button>` : why;
  }
  return `<div class="section"><h3>Lives <span class="hearts">${'&#9829;'.repeat(left)}<span class="lost">${'&#9829;'.repeat(total - left)}</span></span> <span class="muted">${left} of ${total}</span></h3>
    ${body}
    ${past.length ? `<ul class="log">${past.map(v => `<li><span>${OUTCOME[v.status] || esc(v.status)}${v.reason ? `<div class="note">${esc(v.reason)}</div>` : ''}</span>
      <span class="when">${Object.keys(v.yes).length} to ${Object.keys(v.no).length}, ${ago(v.closedAt || v.at)}${owner && v.status === 'passed'
        ? ` <button class="btn small" data-act="vote-close" data-v="${esc(v.id)}" data-s="overturned">Give it back</button>` : ''}</span></li>`).join('')}</ul>` : ''}</div>`;
}

// ---------------------------------------------------------------- head to head

function comparePage() {
  const { deck, players } = view;
  if (view.locked) return lockedPage();
  const back = `<a class="back" href="#/d/${deck.id}">Back to the squad</a>`;
  if (players.length < 2) { app.innerHTML = `${back}<div class="empty">You need two cards to compare.</div>`; return; }
  const sorted = byOvr(deck, players);
  const A = players.find(x => x.id === route.a) || sorted[0];
  const B = players.find(x => x.id === route.b && x.id !== A.id) || sorted.find(x => x.id !== A.id);
  vsShown = { a: A.id, b: B.id };
  const pick = (side, cur) => `<select data-act-change="vs-pick" data-side="${side}" aria-label="Pick a card">${sorted.map(p =>
    `<option value="${esc(p.id)}" ${p.id === cur.id ? 'selected' : ''}>${esc(p.name)} (${overall(p, deck)})</option>`).join('')}</select>`;
  // Higher wins, except "higher is worse" stats where the lower number wins.
  const side = (a, b, invert) => a == null || b == null || a === b ? 0 : (invert ? a < b : a > b) ? 1 : 2;
  let wa = 0, wb = 0;
  const rows = (deck.stats || []).map(st => {
    const a = A.stats?.[st.key] ?? null, b = B.stats?.[st.key] ?? null, w = side(a, b, st.invert);
    if (w === 1) wa++; if (w === 2) wb++;
    return `<div class="vsrow"><span class="v ${w === 1 ? 'win' : ''}">${esc(a ?? '-')}</span>
      <span class="vsk"><b>${esc(st.key)}</b><small>${esc(st.name)}${st.invert ? ', lower wins' : ''}</small></span>
      <span class="v ${w === 2 ? 'win' : ''}">${esc(b ?? '-')}</span></div>`;
  }).join('');
  const oa = overall(A, deck), ob = overall(B, deck), wo = side(oa, ob, false);
  const n = (deck.stats || []).length;
  const verdict = wa === wb ? `Level: ${wa} stats each.` : `${esc(wa > wb ? A.name : B.name)} takes ${Math.max(wa, wb)} of ${n} stats.`;
  app.innerHTML = `${back}<h1>Head to head</h1>
    <div class="vs">
      <div class="vs-side">${pick('a', A)}<a href="#/d/${deck.id}/p/${A.id}">${cardSvg(deck, A, cardOpts(A))}</a></div>
      <div class="vs-mid">VS</div>
      <div class="vs-side">${pick('b', B)}<a href="#/d/${deck.id}/p/${B.id}">${cardSvg(deck, B, cardOpts(B))}</a></div>
    </div>
    <div class="vs-table">
      <div class="vsrow ovr"><span class="v ${wo === 1 ? 'win' : ''}">${oa}</span><span class="vsk"><b>OVR</b><small>Overall</small></span><span class="v ${wo === 2 ? 'win' : ''}">${ob}</span></div>
      ${rows}
    </div>
    <p class="vs-verdict">${verdict}</p>`;
}

// ---------------------------------------------------------------- player editor

function editPage() {
  const { deck, players, myRole, members } = view;
  const p = players.find(x => x.id === route.pid);
  const owner = myRole === 'owner', mine = me && p?.linkedUid === me.uid;
  if (!p || !(owner || mine)) { builtKey = null; app.innerHTML = `<a class="back" href="#/d/${deck.id}">Back</a><div class="empty">You can't edit this card.</div>`; return; }
  const draft = drafts.player = structuredClone(p);
  draft.photoPos ??= { x: 0, y: 0, s: 1 };
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === (cur ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
  const pos = draft.photoPos;

  app.innerHTML = `<a class="back" href="#/d/${deck.id}/${owner ? 'manage/players' : 'p/' + p.id}">Back</a>
  <div class="editor"><div class="preview" id="pv"></div>
  <form id="pf" autocomplete="off">
    <h1 style="margin-bottom:18px">Edit card</h1>
    <label class="field"><span>Name on the card</span><input name="name" value="${esc(p.name)}" maxlength="18"></label>
    ${owner ? `<div class="two">
      <label class="field"><span>Role</span><select name="role">${opt('', 'None', p.role)}${(deck.roles || []).map(r => opt(r.code, `${r.code}  ${r.name}`, p.role)).join('')}</select></label>
      <label class="field"><span>Card skin</span><select name="skin">${opt('', 'By tier (automatic)', p.skin)}${Object.entries(SKINS).map(([k, s]) => opt(k, s.label, p.skin)).join('')}</select></label>
      <label class="field"><span>Flag</span><select name="flag">${opt('', 'Deck default', p.flag)}${Object.entries(FLAGS).map(([k, f]) => opt(k, f ? f.name : 'No flag', p.flag)).join('')}</select></label>
      <label class="field"><span>Top line (optional)</span><input name="tag" value="${esc(p.tag || '')}" maxlength="22" placeholder="e.g. PLAYER OF THE YEAR"></label>
    </div>
    <label class="field"><span>Scouting report (back of the card)</span><textarea name="bio" rows="4" maxlength="240" placeholder="Two lines on why they're rated like this">${esc(p.bio || '')}</textarea></label>
    <fieldset><legend>Stats</legend><div class="stat-inputs">${(deck.stats || []).map(s =>
      `<label title="${esc(s.name)}"><b>${esc(s.key)}</b><input class="num" type="number" min="1" max="99" name="stat.${esc(s.key)}" value="${p.stats?.[s.key] ?? 60}"></label>`).join('')}</div>
      <label class="field" style="margin-top:12px"><span>Overall override (leave empty to calculate it)</span><input class="num" type="number" min="1" max="99" name="ovrOverride" value="${Number.isFinite(p.ovrOverride) ? p.ovrOverride : ''}"></label>
    </fieldset>
    ${!S.isLocal ? `<label class="field"><span>Whose card is this? (they can change its name and photo)</span><select name="linkedUid">${opt('', 'Nobody', p.linkedUid)}${members.map(m => opt(m.id, `${m.name}${m.email ? ` (${m.email})` : ''}`, p.linkedUid)).join('')}</select></label>` : ''}` : ''}
    <fieldset><legend>Photo</legend>
      <p class="hint" style="margin-top:0">Any photo works. A face-on shot from the chest up looks most like a real card.</p>
      <label class="check"><input type="checkbox" id="cutout" checked> Cut out the background</label>
      <div class="actions"><label class="btn">Choose photo<input type="file" id="file" accept="image/*" hidden></label>
        <button type="button" class="btn danger" data-act="photo-remove">Remove photo</button></div>
      <div class="status" id="pstatus"></div>
      <label class="field"><span>Left and right</span><input type="range" name="pos.x" min="-90" max="90" value="${pos.x}"></label>
      <label class="field"><span>Up and down</span><input type="range" name="pos.y" min="-60" max="110" value="${pos.y}"></label>
      <label class="field"><span>Size</span><input type="range" name="pos.s" min="0.5" max="2" step="0.02" value="${pos.s}"></label>
    </fieldset>
    <div class="actions"><button class="btn primary" type="button" data-act="player-save">Save card</button>
      ${owner ? '<button class="btn danger" type="button" data-act="player-delete">Delete player</button>' : ''}</div>
  </form></div>`;

  const form = $('#pf');
  form.addEventListener('input', () => { readPlayerForm(form, draft); paintPreview(); });
  $('#file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $('#pstatus');
    try {
      const url = await processPhoto(file, { removeBg: $('#cutout').checked, onStatus: t => { status.textContent = t; } });
      status.textContent = 'Saving';
      await S.setPhoto(deck.id, p.id, url);
      status.textContent = 'Photo saved. Use the sliders to line it up, then save the card.';
    } catch (err) { status.textContent = ''; fail(err); }
    e.target.value = '';
  });
  paintPreview();
}
editPage.refresh = () => {
  if (!view.players.some(x => x.id === route.pid)) { location.hash = `#/d/${route.id}/manage/players`; return; }
  paintPreview();
};

function readPlayerForm(form, draft) {
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.name.startsWith('stat.')) (draft.stats ??= {})[el.name.slice(5)] = clampStat(el.value);
    else if (el.name.startsWith('pos.')) draft.photoPos[el.name.slice(4)] = Number(el.value);
    else if (el.name === 'ovrOverride') draft.ovrOverride = el.value === '' ? null : clampStat(el.value);
    else draft[el.name] = el.value;
  }
}

function paintPreview() {
  const pv = $('#pv');
  if (pv) pv.innerHTML = flipCard(view.deck, drafts.player, { photo: view.photos[route.pid], lives: livesOf(drafts.player) });
}

// ---------------------------------------------------------------- manage

const TABS = [['players', 'Players'], ['stats', 'Stats'], ['roles', 'Roles'], ['tiers', 'Tiers'], ['people', 'People'], ['inbox', 'Inbox'], ['history', 'History'], ['edition', 'Edition']];
const FORM_TABS = new Set(['stats', 'roles', 'tiers', 'edition']);

function managePage() {
  const { deck, myRole, suggestions } = view;
  if (myRole !== 'owner') { builtKey = null; app.innerHTML = `<div class="empty">Only the commissioner can manage this deck.</div>`; return; }
  const pending = suggestions.filter(s => s.status === 'pending').length;
  app.innerHTML = `<a class="back" href="#/d/${deck.id}">Back to the squad</a><h1>${esc(deck.name)}</h1>
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/d/${deck.id}/manage/${k}" class="${route.tab === k ? 'on' : ''}">${l}${k === 'inbox' && pending ? ` <span class="count">${pending}</span>` : ''}</a>`).join('')}</nav>
    <div id="tab"></div>`;
  TAB_RENDER[route.tab]?.($('#tab'));
}
// Form tabs keep their DOM between live updates; list tabs redraw.
managePage.refresh = () => {
  if (view.myRole !== 'owner') return managePage();
  if (FORM_TABS.has(route.tab)) {
    const n = view.suggestions.filter(s => s.status === 'pending').length;
    const inbox = $(`.tabs a[href$="/inbox"]`);
    if (inbox) inbox.innerHTML = `Inbox${n ? ` <span class="count">${n}</span>` : ''}`;
    return;
  }
  managePage();
};

const TAB_RENDER = {
  players(el) {
    const { deck, players } = view;
    el.innerHTML = `<div class="actions" style="margin-bottom:12px"><button class="btn primary" data-act="add-player">Add player</button></div>
      ${players.length ? byOvr(deck, players).map(p => `<a class="prow" href="#/d/${deck.id}/edit/${p.id}">
        <div class="mini">${cardSvg(deck, p, cardOpts(p))}</div>
        <div><b>${esc(p.name)}</b><div class="muted">${overall(p, deck)} overall${p.role ? `, ${esc(p.role)}` : ''}${view.photos[p.id] ? '' : ', no photo yet'}</div></div>
        <span class="muted">Edit</span></a>`).join('') : '<div class="empty">No players yet.</div>'}`;
  },

  stats(el) {
    const rows = drafts.stats ??= (view.deck.stats || []).map(s => ({ orig: s.key, key: s.key, name: s.name, invert: !!s.invert }));
    el.innerHTML = `<p class="hint">These are the numbers on every card. Six fits the card best, up to eight works. "Higher is worse" stats still show their real number but pull the overall down (like lateness).</p>
      <div class="scroll-x"><table class="table"><tr><th>Code</th><th>Name</th><th>Higher is worse</th><th></th></tr>
      ${rows.map((r, i) => `<tr data-i="${i}"><td><input class="code" data-f="key" maxlength="4" value="${esc(r.key)}"></td>
        <td><input data-f="name" value="${esc(r.name)}"></td>
        <td><input type="checkbox" data-f="invert" ${r.invert ? 'checked' : ''}></td>
        <td class="actions"><button class="btn small" data-act="row-up" data-i="${i}" ${i ? '' : 'disabled'}>Up</button>
          <button class="btn small danger" data-act="row-del" data-i="${i}">Remove</button></td></tr>`).join('')}</table></div>
      <div class="actions" style="margin-top:14px"><button class="btn" data-act="row-add" ${rows.length >= 8 ? 'disabled' : ''}>Add stat</button>
        <button class="btn primary" data-act="stats-save">Save stats</button><button class="btn" data-act="tab-reset">Reset</button></div>`;
    bindRows(el, rows, { key: v => v.toUpperCase().replace(/[^A-Z0-9]/g, '') });
  },

  roles(el) {
    const stats = view.deck.stats || [];
    const rows = drafts.roles ??= structuredClone(view.deck.roles || []).map(r => ({ ...r, orig: r.code }));
    el.innerHTML = `<p class="hint">A role sits under the rating, like a position. Its weights decide how much each stat counts towards that player's overall: 0 ignores a stat, 3 makes it count three times.</p>
      <div class="scroll-x"><table class="table"><tr><th>Code</th><th>Name</th>${stats.map(s => `<th>${esc(s.key)}</th>`).join('')}<th></th></tr>
      ${rows.map((r, i) => `<tr data-i="${i}"><td><input class="code" data-f="code" maxlength="4" value="${esc(r.code)}"></td>
        <td><input data-f="name" value="${esc(r.name)}" style="min-width:120px"></td>
        ${stats.map(s => `<td><input class="num" type="number" min="0" max="5" data-f="w.${esc(s.key)}" value="${r.weights?.[s.key] ?? 1}"></td>`).join('')}
        <td><button class="btn small danger" data-act="row-del" data-i="${i}">Remove</button></td></tr>`).join('')}</table></div>
      <div class="actions" style="margin-top:14px"><button class="btn" data-act="row-add">Add role</button>
        <button class="btn primary" data-act="roles-save">Save roles</button><button class="btn" data-act="tab-reset">Reset</button></div>`;
    bindRows(el, rows, { code: v => v.toUpperCase().replace(/[^A-Z0-9]/g, '') });
  },

  tiers(el) {
    const rows = drafts.tiers ??= structuredClone(view.deck.tiers || []);
    el.innerHTML = `<p class="hint">Each card gets the highest tier its overall reaches. A skin picked by hand on a player (like Team of the Year) beats this.</p>
      <div class="scroll-x"><table class="table"><tr><th>Name</th><th>From overall</th><th>Skin</th><th></th></tr>
      ${rows.map((r, i) => `<tr data-i="${i}"><td><input data-f="name" value="${esc(r.name)}"></td>
        <td><input class="num" type="number" min="0" max="99" data-f="min" value="${r.min}"></td>
        <td><select data-f="skin">${Object.entries(SKINS).map(([k, s]) => `<option value="${k}" ${k === r.skin ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></td>
        <td><button class="btn small danger" data-act="row-del" data-i="${i}">Remove</button></td></tr>`).join('')}</table></div>
      <div class="actions" style="margin-top:14px"><button class="btn" data-act="row-add">Add tier</button>
        <button class="btn primary" data-act="tiers-save">Save tiers</button><button class="btn" data-act="tab-reset">Reset</button></div>`;
    bindRows(el, rows, { min: v => Math.max(0, Math.min(99, Number(v) || 0)) });
  },

  people(el) {
    if (S.isLocal) { el.innerHTML = `<div class="empty">Once Firebase is set up, friends who open your link and sign in show up here, and you choose who can suggest or edit.</div>`; return; }
    const { members, players } = view;
    el.innerHTML = `<p class="hint">Friends appear here after they open your link and sign in. Viewers only look. Suggesters send changes to your inbox. Editors change stats directly, and you can undo anything in History.</p>
      ${members.length ? `<div class="scroll-x"><table class="table"><tr><th>Name</th><th>Can</th><th>Their card</th></tr>
      ${members.map(m => `<tr><td>${esc(m.name)}<div class="muted">${esc(m.email || '')}</div></td>
        <td><select data-act-change="member-role" data-uid="${m.id}">${['viewer', 'suggester', 'editor'].map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r === 'viewer' ? 'View' : r === 'suggester' ? 'Suggest' : 'Edit'}</option>`).join('')}</select></td>
        <td>${esc(players.find(p => p.linkedUid === m.id)?.name || '')}</td></tr>`).join('')}</table></div>`
      : '<div class="empty">Nobody has signed in yet. Send them the link.</div>'}`;
  },

  inbox(el) {
    const sug = view.suggestions;
    const pending = sug.filter(s => s.status === 'pending'), done = sug.filter(s => s.status !== 'pending').slice(0, 30);
    const line = s => `<span><b>${esc(s.pname)}</b> ${esc(s.key)} ${esc(s.from ?? '?')} to ${esc(s.to)}<div class="note">From ${esc(s.byName)}${s.note ? `: ${esc(s.note)}` : ''}</div></span>`;
    el.innerHTML = `${pending.length ? `<ul class="log">${pending.map(s => `<li>${line(s)}<span class="actions">
        <button class="btn small primary" data-act="sug-yes" data-s="${esc(s.id)}">Approve</button>
        <button class="btn small" data-act="sug-no" data-s="${esc(s.id)}">Reject</button></span></li>`).join('')}</ul>`
      : '<div class="empty">No suggestions waiting.</div>'}
      ${done.length ? `<div class="section"><h3>Already handled</h3><ul class="log">${done.map(s => `<li>${line(s)}<span class="when">${s.status === 'accepted' ? 'Approved' : 'Rejected'}</span></li>`).join('')}</ul></div>` : ''}`;
  },

  history(el) {
    el.innerHTML = view.history.length ? historyList(view.history, true) : '<div class="empty">No changes yet.</div>';
  },

  edition(el) {
    const d = view.deck;
    const local = d.revealAt ? new Date(d.revealAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    el.innerHTML = `<form id="ef" autocomplete="off" style="max-width:560px">
      <div class="two"><label class="field"><span>Deck name</span><input name="name" value="${esc(d.name)}"></label>
        <label class="field"><span>Year</span><input name="year" type="number" value="${d.year}"></label>
        <label class="field"><span>Badge text</span><input name="crest" value="${esc(d.crest ?? '')}" maxlength="3"></label>
        <label class="field"><span>Lives per card (0 turns votes off)</span><input name="lives" type="number" min="0" max="${MAX_LIVES}" value="${livesTotal(d)}"></label>
        <label class="field"><span>Default flag</span><select name="flag">${Object.entries(FLAGS).map(([k, f]) => `<option value="${k}" ${k === (d.flag || 'none') ? 'selected' : ''}>${esc(f ? f.name : 'No flag')}</option>`).join('')}</select></label></div>
      <label class="field"><span>Reveal date (shown to friends while the cards are hidden)</span><input name="revealAt" type="datetime-local" value="${local}"></label>
      <button class="btn primary" type="button" data-act="edition-save">Save</button></form>
      <div class="section"><h3>Reveal</h3>
        <p class="hint">${d.revealed ? 'The cards are out. Anyone with the link sees them, and gets the pack opening on their first visit.' : 'The cards are hidden. Viewers see a countdown; only you and your suggesters and editors can see the cards.'}</p>
        <button class="btn ${d.revealed ? '' : 'primary'}" data-act="toggle-reveal">${d.revealed ? 'Hide them again' : 'Reveal the cards'}</button></div>
      <div class="section"><h3>Link</h3><p class="hint" style="word-break:break-all">${esc(linkTo(d.id))}</p>
        <button class="btn" data-act="copy-link">Copy link</button></div>
      <div class="section"><h3>Next year</h3><p class="hint">Starts a new deck with the same stats, roles, tiers and friends. Values carry over as a starting point, and each card shows how much it moved since this year.</p>
        <button class="btn" data-act="new-edition">Start ${d.year + 1} edition</button></div>
      <div class="section"><h3>Delete</h3><button class="btn danger" data-act="delete-deck">Delete this deck</button></div>`;
  },
};

// Wire inputs inside a draft table to the draft rows (no redraw while typing).
function bindRows(el, rows, clean = {}) {
  el.addEventListener('input', e => {
    const tr = e.target.closest('tr[data-i]'), f = e.target.dataset.f;
    if (!tr || !f) return;
    const r = rows[+tr.dataset.i];
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (clean[f]) v = clean[f](v);
    if (f.startsWith('w.')) (r.weights ??= {})[f.slice(2)] = Math.max(0, Math.min(5, Number(v) || 0));
    else r[f] = v;
  });
}

// Swap in a fresh container so listeners from the last draw don't pile up.
function redrawTab() {
  const old = $('#tab'), el = old.cloneNode(false);
  old.replaceWith(el);
  TAB_RENDER[route.tab](el);
}

// ---------------------------------------------------------------- reveal

function revealPage() {
  const { deck, players, photos } = view;
  if (view.locked) { builtKey = null; return lockedPage(); }
  if (!players.length) { builtKey = null; app.innerHTML = `<div class="empty">No cards to open yet.</div>`; return; }
  const order = [...players].sort((a, b) => overall(a, deck) - overall(b, deck));
  app.innerHTML = `<div class="reveal" id="rv"><div class="beam"></div>
    <button class="btn small skip" data-act="reveal-done">Skip</button>
    <div class="count-top" id="rvc"></div><div class="stage" id="rvs"></div><div class="tap" id="rvt"></div></div>`;
  const rv = $('#rv'), stage = $('#rvs'), tap = $('#rvt'), count = $('#rvc');
  let i = -1, walking = false, timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };

  stage.innerHTML = `<div class="pack"><div><span>${esc(deck.year)}</span><b>${esc(deck.name)}</b><span>${plural(order.length, 'card')}</span></div></div>`;
  tap.textContent = 'Tap to open';

  const showCard = () => {
    walking = false; clear();
    const p = order[i];
    rv.style.setProperty('--glow', skinGlow(deck, p));
    rv.classList.add('lit');
    count.textContent = `${i + 1} / ${order.length}`;
    stage.innerHTML = `<div class="flyin">${cardSvg(deck, p, cardOpts(p))}</div>`;
    tap.textContent = i === order.length - 1 ? 'Tap to see the squad' : 'Tap for the next card';
  };
  // The best card gets a walkout, like a FUT board: nation, role, then the card.
  const walkout = () => {
    walking = true; rv.classList.remove('lit');
    const p = order[i];
    const role = (deck.roles || []).find(r => r.code === p.role);
    const flag = p.flag || deck.flag;
    const steps = [
      flag && FLAGS[flag] ? `<div class="walk flag">${flagBadge(flag)}</div>` : '',
      `<div class="walk big">${esc(p.role || '?')}</div>${role ? `<div class="walk mid">${esc(role.name)}</div>` : ''}`,
      `<div class="walk big">${overall(p, deck)}</div>`,
    ].filter(Boolean);
    count.textContent = 'Best card';
    tap.textContent = '';
    steps.forEach((html, k) => timers.push(setTimeout(() => { stage.innerHTML = html; }, k * 1300)));
    timers.push(setTimeout(showCard, steps.length * 1300 + 200));
  };
  const finish = () => { clear(); markSeen(deck.id); location.hash = `#/d/${deck.id}`; };

  rv.addEventListener('click', e => {
    if (e.target.closest('.skip')) return;
    if (walking) return showCard();
    i++;
    if (i >= order.length) return finish();
    if (i === order.length - 1 && order.length > 2) walkout(); else showCard();
  });
  revealPage.finish = finish;
}
revealPage.keep = true;

// ---------------------------------------------------------------- actions

const ACTIONS = {
  signin: () => S.auth.signIn().catch(fail),
  signout: () => S.auth.signOut(),
  'copy-link': async b => {
    try { await navigator.clipboard.writeText(linkTo(view.deck.id)); b.textContent = 'Copied'; }
    catch { await dialog('Link', `<input value="${esc(linkTo(view.deck.id))}" readonly onclick="this.select()">`); }
  },
  'new-deck': async () => {
    const y = new Date().getFullYear();
    const v = await dialog('New deck', `<label class="field"><span>Name</span><input id="nd-name" value="Class of ${y}"></label>
      <label class="field"><span>Year</span><input id="nd-year" type="number" value="${y}"></label>`,
      [{ label: 'Cancel', value: null }, { label: 'Create', value: true, primary: true }],
      box => ({ name: $('#nd-name', box).value.trim() || `Class of ${y}`, year: Number($('#nd-year', box).value) || y }));
    if (!v) return;
    const id = await S.createDeck(me, v.name, v.year).catch(fail);
    if (id) location.hash = `#/d/${id}/manage/players`;
  },

  step: b => {
    const p = view.players.find(x => x.id === route.pid), k = b.dataset.k;
    const cur = drafts.stats[k] ?? p.stats?.[k] ?? 60;
    drafts.stats[k] = clampStat(cur + Number(b.dataset.d));
    render();
  },
  setval: async b => {
    const p = view.players.find(x => x.id === route.pid), k = b.dataset.k;
    const v = await dialog(`Set ${k}`, `<input id="sv" type="number" min="1" max="99" value="${drafts.stats[k] ?? p.stats?.[k] ?? 60}">`,
      [{ label: 'Cancel', value: null }, { label: 'Set', value: true, primary: true }], box => clampStat($('#sv', box).value));
    if (v == null) return;
    drafts.stats[k] = v; render();
  },
  discard: () => { drafts.stats = {}; render(); },
  'save-stats': async b => {
    b.disabled = true;
    const p = view.players.find(x => x.id === route.pid);
    try {
      for (const [k, v] of Object.entries(drafts.stats)) await S.setStat(view.deck.id, p, k, v, me);
      drafts.stats = {};
      render();
    } catch (e) { b.disabled = false; fail(e); }
  },
  suggest: async b => {
    const p = view.players.find(x => x.id === route.pid), k = b.dataset.k;
    const v = await dialog(`Suggest ${k} for ${p.name}`, `<label class="field"><span>New value</span><input id="sg-v" type="number" min="1" max="99" value="${p.stats?.[k] ?? 60}"></label>
      <label class="field"><span>Why (optional)</span><input id="sg-n" maxlength="140"></label>`,
      [{ label: 'Cancel', value: null }, { label: 'Send to commissioner', value: true, primary: true }],
      box => ({ to: $('#sg-v', box).value, note: $('#sg-n', box).value.trim() }));
    if (!v) return;
    S.suggest(view.deck.id, p, k, v.to, v.note, me).catch(fail);
  },
  'save-image': async b => {
    const p = view.players.find(x => x.id === route.pid);
    const t = b.textContent; b.textContent = 'Saving'; b.disabled = true;
    try { await shareCard(view.deck, p, view.photos[p.id], { lives: livesOf(p) }); } catch (e) { fail(e); }
    b.textContent = t; b.disabled = false;
  },
  undo: async b => {
    const h = view.history.find(x => x.id === b.dataset.h);
    if (h && await confirmDialog('Undo this change?', `${h.pname}'s ${h.key} goes back from ${h.to} to ${h.from}.`, 'Undo')) S.undo(view, h, me)?.catch(fail);
  },

  'player-save': async b => {
    const form = $('#pf'), draft = drafts.player;
    readPlayerForm(form, draft);
    const owner = view.myRole === 'owner';
    const patch = owner
      ? { name: draft.name.trim() || 'Player', role: draft.role || '', skin: draft.skin || '', flag: draft.flag || '', tag: draft.tag || '', bio: (draft.bio || '').trim(),
          stats: draft.stats, ovrOverride: draft.ovrOverride ?? null, photoPos: draft.photoPos, ...(S.isLocal ? {} : { linkedUid: draft.linkedUid || '' }) }
      : { name: draft.name.trim() || 'Player', photoPos: draft.photoPos };
    b.disabled = true;
    const before = view.players.find(x => x.id === route.pid);
    try {
      // Stat changes made here go through the history like any other edit.
      if (owner) for (const s of view.deck.stats || []) {
        if (draft.stats?.[s.key] !== before.stats?.[s.key]) await S.setStat(view.deck.id, before, s.key, draft.stats[s.key], me);
      }
      const { stats, ...rest } = patch;
      await S.updatePlayer(view.deck.id, route.pid, rest);
      location.hash = owner ? `#/d/${view.deck.id}/manage/players` : `#/d/${view.deck.id}/p/${route.pid}`;
    } catch (e) { b.disabled = false; fail(e); }
  },
  'player-delete': async () => {
    const p = view.players.find(x => x.id === route.pid);
    if (await confirmDialog(`Delete ${p.name}?`, 'Their card, photo and stats go. History entries stay.', 'Delete', true))
      S.removePlayer(view.deck.id, p.id).then(() => { location.hash = `#/d/${view.deck.id}/manage/players`; }).catch(fail);
  },
  'photo-remove': () => S.setPhoto(view.deck.id, route.pid, null).catch(fail),
  'add-player': async () => {
    const name = await dialog('Add player', '<label class="field"><span>Name</span><input id="ap" maxlength="18"></label>',
      [{ label: 'Cancel', value: null }, { label: 'Add', value: true, primary: true }], box => $('#ap', box).value.trim() || null);
    if (!name || name === true) return;
    const pid = await S.addPlayer(view.deck, name).catch(fail);
    if (pid) location.hash = `#/d/${view.deck.id}/edit/${pid}`;
  },

  'row-up': b => { const r = drafts[route.tab], i = +b.dataset.i; [r[i - 1], r[i]] = [r[i], r[i - 1]]; redrawTab(); },
  'row-del': b => { drafts[route.tab].splice(+b.dataset.i, 1); redrawTab(); },
  'row-add': () => {
    const r = drafts[route.tab];
    if (route.tab === 'stats') r.push({ orig: null, key: '', name: '', invert: false });
    if (route.tab === 'roles') r.push({ orig: null, code: '', name: '', weights: Object.fromEntries((view.deck.stats || []).map(s => [s.key, 1])) });
    if (route.tab === 'tiers') r.push({ name: '', min: 0, skin: 'gold' });
    redrawTab();
    $$('#tab tr[data-i]').pop()?.querySelector('input')?.focus();
  },
  'tab-reset': () => { delete drafts[route.tab]; redrawTab(); },
  'stats-save': async b => {
    const rows = drafts.stats;
    const keys = rows.map(r => r.key);
    if (!rows.length) return alertDialog('Need at least one stat', 'A card with no stats has nothing to show.');
    if (keys.some(k => k.length < 2)) return alertDialog('Codes need 2 to 4 letters', 'Like BAN or LAT.');
    if (new Set(keys).size !== keys.length) return alertDialog('Two stats share a code', 'Each code has to be different.');
    rows.forEach(r => { r.name = r.name.trim() || r.key; });
    b.disabled = true;
    try { await S.saveStatDefs(view, rows); delete drafts.stats; redrawTab(); } catch (e) { fail(e); b.disabled = false; }
  },
  'roles-save': async b => {
    const rows = drafts.roles, codes = rows.map(r => r.code);
    if (codes.some(c => !c)) return alertDialog('Every role needs a code', 'Like CAP or DRV.');
    if (new Set(codes).size !== codes.length) return alertDialog('Two roles share a code', 'Each code has to be different.');
    rows.forEach(r => { r.name = r.name.trim() || r.code; });
    b.disabled = true;
    try { await S.saveRoleDefs(view, rows); delete drafts.roles; redrawTab(); } catch (e) { fail(e); b.disabled = false; }
  },
  'tiers-save': async b => {
    const rows = drafts.tiers.map(t => ({ name: t.name.trim() || 'Tier', min: Number(t.min) || 0, skin: t.skin }));
    if (!rows.length) return alertDialog('Need at least one tier', 'Every card needs a skin.');
    if (!rows.some(t => t.min === 0)) rows[rows.length - 1].min = 0;
    b.disabled = true;
    try { await S.updateDeck(view.deck.id, { tiers: rows }); delete drafts.tiers; redrawTab(); } catch (e) { fail(e); b.disabled = false; }
  },
  'edition-save': async b => {
    const f = $('#ef');
    const year = Number(f.year.value) || view.deck.year;
    b.disabled = true;
    try {
      await S.updateDeck(view.deck.id, { name: f.name.value.trim() || view.deck.name, year, crest: f.crest.value.trim(), flag: f.flag.value,
        revealAt: f.revealAt.value ? new Date(f.revealAt.value).getTime() : null,
        lives: Math.max(0, Math.min(MAX_LIVES, Math.round(Number(f.lives.value) || 0))) });
      b.textContent = 'Saved';
    } catch (e) { fail(e); }
    b.disabled = false;
  },
  'toggle-reveal': async () => {
    const d = view.deck;
    if (!d.revealed && !await confirmDialog('Reveal the cards?', 'Everyone with the link can see them straight away.', 'Reveal')) return;
    await S.updateDeck(d.id, { revealed: !d.revealed }).catch(fail);
    redrawTab();
  },
  'new-edition': async () => {
    if (!await confirmDialog(`Start the ${view.deck.year + 1} edition?`, 'This deck stays as it is. The new one starts hidden.', 'Start it')) return;
    const id = await S.newEdition(view, me).catch(fail);
    if (id) location.hash = `#/d/${id}/manage/players`;
  },
  'delete-deck': async () => {
    const v = await dialog('Delete this deck?', `<p>Every card, photo and change in ${esc(view.deck.name)} goes for good. Type DELETE to confirm.</p><input id="dd">`,
      [{ label: 'Cancel', value: null }, { label: 'Delete', value: true, danger: true }], box => $('#dd', box).value.trim() === 'DELETE');
    if (v !== true) return;
    try { await S.deleteDeck(view); location.hash = '#/'; } catch (e) { fail(e); }
  },
  'sug-yes': b => S.resolveSuggestion(view, view.suggestions.find(s => s.id === b.dataset.s), true, me).catch(fail),
  'sug-no': b => S.resolveSuggestion(view, view.suggestions.find(s => s.id === b.dataset.s), false, me).catch(fail),
  'reveal-done': () => revealPage.finish?.(),

  flip: b => { flipped = !flipped; b.classList.toggle('on', flipped); },
  'vote-start': async () => {
    const p = view.players.find(x => x.id === route.pid), vt = voting(p);
    if (!vt.who) return;
    const rule = vt.eligible <= 1 ? 'With one voter, your vote decides it.'
      : `It takes ${votesNeeded(vt.eligible)} of ${vt.eligible} people saying yes. Your vote counts as the first yes.`;
    const reason = await dialog(`Take a life from ${p.name}?`, `<p class="muted">${esc(rule)}</p>
      <label class="field"><span>Why (optional)</span><input id="vr" maxlength="140"></label>`,
      [{ label: 'Cancel', value: null }, { label: 'Start the vote', value: true, primary: true }], box => $('#vr', box).value.trim());
    if (reason == null) return;
    S.startVote(view.deck.id, p, reason, vt.who, vt.eligible).catch(fail);
  },
  'vote-cast': b => {
    const p = view.players.find(x => x.id === route.pid), v = view.votes.find(x => x.id === b.dataset.v), vt = voting(p);
    if (!v || !vt.who || v.status !== 'open') return;
    b.disabled = true;
    S.castVote(view.deck.id, v, vt.who, b.dataset.take === '1', vt.eligible).catch(e => { b.disabled = false; fail(e); });
  },
  'vote-close': async b => {
    const v = view.votes.find(x => x.id === b.dataset.v), to = b.dataset.s;
    if (!v) return;
    const ok = to === 'overturned'
      ? await confirmDialog('Give the life back?', `${v.pname} gets this life back. The vote stays in the list.`, 'Give it back')
      : await confirmDialog('Call off this vote?', 'Nobody loses a life from it.', 'Call it off');
    if (ok) S.closeVote(view.deck.id, v, to).catch(fail);
  },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const fn = ACTIONS[b.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(b, e);
});
document.addEventListener('change', e => {
  const s = e.target.closest('[data-act-change]');
  if (!s) return;
  const act = s.dataset.actChange;
  if (act === 'member-role') S.setMemberRole(view.deck.id, s.dataset.uid, s.value).catch(fail);
  if (act === 'demo-voter') { demoVoter = s.value; render(); }
  if (act === 'vs-pick') {
    const other = $(`[data-act-change="vs-pick"]:not([data-side="${s.dataset.side}"])`)?.value;
    // Picking the card that's already on the other side swaps them.
    const mine = s.value, theirs = other === mine ? vsShown[s.dataset.side] : other;
    const [a, b] = s.dataset.side === 'a' ? [mine, theirs] : [theirs, mine];
    location.hash = `#/d/${view.deck.id}/vs/${encodeURIComponent(a)}/${encodeURIComponent(b)}`;
  }
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.flip[data-act]')) { e.preventDefault(); e.target.click(); }
});

window.addEventListener('hashchange', onRoute);
S.auth.watch(u => { me = u; authReady = true; route = {}; onRoute(); });
