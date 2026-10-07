// Everything the app reads and writes, written once against db.js.
//
// decks/{d}                 config: name, year, stats, roles, tiers, revealed, ownerUid
//   players/{p}             name, role, stats{}, skin, tag, flag, photoPos, linkedUid, prevOvr
//   photos/{p}              data (webp data URL); separate so the deck list stays light
//   members/{uid}           name, email, role: viewer | suggester | editor
//   suggestions/{s}         pid, key, from, to, note, byUid, byName, status
//   history/{h}             pid, pname, key, from, to, kind, byUid, byName, at
import { db } from './db.js';
import { overall, clampStat, deckTemplate } from './overall.js';

export const isLocal = db.local;
export const auth = db.auth;
const D = id => `decks/${id}`;

export const ROLE_RANK = { none: 0, viewer: 1, suggester: 2, editor: 3, owner: 4 };
export const canEdit = r => ROLE_RANK[r] >= 3;
export const canSuggest = r => ROLE_RANK[r] >= 2;

// One live view of a deck: calls cb({deck, players, photos, history,
// suggestions, members, myRole, locked}) whenever any part changes.
export function watchDeck(id, me, cb) {
  const state = { deck: undefined, players: [], photos: {}, history: [], suggestions: [], members: [], member: null, locked: false };
  const unsubs = [];
  let inner = [];
  const emit = () => {
    if (state.deck === undefined) return;
    const myRole = !state.deck ? 'none'
      : me && state.deck.ownerUid === me.uid ? 'owner'
      : state.member?.role || 'viewer';
    cb({ ...state, myRole });
  };
  const stopInner = () => { inner.forEach(u => u()); inner = []; };

  // Which sub-collections we may read depends on our role and the reveal
  // flag, so (re)subscribe whenever either changes.
  let key = '';
  const resubscribe = () => {
    const d = state.deck;
    if (!d) { stopInner(); return; }
    const role = me && d.ownerUid === me.uid ? 'owner' : state.member?.role || 'viewer';
    const see = d.revealed || canSuggest(role);
    const k = `${role}|${see}`;
    if (k === key) return;
    key = k; stopInner();
    state.locked = !see;
    if (!see) { state.players = []; state.photos = {}; state.history = []; emit(); return; }
    const fail = e => { console.warn(e); state.locked = true; emit(); };
    inner.push(db.watchCol(`${D(id)}/players`, {}, rows => { state.players = rows; emit(); }, fail));
    inner.push(db.watchCol(`${D(id)}/photos`, {}, rows => {
      state.photos = Object.fromEntries(rows.map(r => [r.id, r.data])); emit();
    }, fail));
    inner.push(db.watchCol(`${D(id)}/history`, { orderBy: ['at', 'desc'], limit: 300 }, rows => { state.history = rows; emit(); }, fail));
    if (role === 'owner') {
      inner.push(db.watchCol(`${D(id)}/suggestions`, { orderBy: ['at', 'desc'] }, rows => { state.suggestions = rows; emit(); }, fail));
      inner.push(db.watchCol(`${D(id)}/members`, {}, rows => { state.members = rows; emit(); }, fail));
    } else if (me && canSuggest(role)) {
      inner.push(db.watchCol(`${D(id)}/suggestions`, { where: ['byUid', '==', me.uid] }, rows => {
        state.suggestions = rows.sort((a, b) => (b.at || 0) - (a.at || 0)); emit();
      }, fail));
    }
  };

  unsubs.push(db.watchDoc(D(id), d => { state.deck = d; resubscribe(); emit(); }, e => { console.warn(e); state.deck = null; emit(); }));
  if (me && !db.local) {
    unsubs.push(db.watchDoc(`${D(id)}/members/${me.uid}`, m => { state.member = m; resubscribe(); emit(); }, () => {}));
  }
  return () => { unsubs.forEach(u => u()); stopInner(); };
}

// First visit by a signed-in friend: register them as a viewer so the
// commissioner can see them in People and promote them.
export async function ensureMember(deckId, me, deck) {
  if (!me || db.local || deck.ownerUid === me.uid) return;
  const path = `${D(deckId)}/members/${me.uid}`;
  if (await db.getDoc(path).catch(() => null)) return;
  await db.batch([{ op: 'set', path, data: { name: me.name, email: me.email || '', role: 'viewer', joinedAt: db.now() } }]);
}

export const myDecks = me => db.getCol('decks', { where: ['ownerUid', '==', me.uid] });

export async function createDeck(me, name, year) {
  const id = db.newId();
  await db.batch([{ op: 'set', path: D(id), data: { ...deckTemplate(year), name, ownerUid: me.uid, ownerName: me.name, createdAt: db.now() } }]);
  return id;
}

export const updateDeck = (id, patch) => db.batch([{ op: 'update', path: D(id), data: patch }]);

async function chunked(ops) {
  for (let i = 0; i < ops.length; i += 450) await db.batch(ops.slice(i, i + 450));
}

// rows: [{orig, key, name, invert}]. `orig` is the key before editing (null
// for a new stat), so a rename carries every player's value and every role's
// weight across instead of resetting them.
export async function saveStatDefs(view, rows) {
  const id = view.deck.id;
  const roles = (view.deck.roles || []).map(r => ({
    ...r, weights: Object.fromEntries(rows.map(s => [s.key, r.weights?.[s.orig] ?? 1])),
  }));
  const ops = [{ op: 'update', path: D(id), data: { stats: rows.map(({ key, name, invert }) => ({ key, name, invert: !!invert })), roles } }];
  for (const p of view.players) {
    const stats = Object.fromEntries(rows.map(s => [s.key, p.stats?.[s.orig] ?? 60]));
    ops.push({ op: 'update', path: `${D(id)}/players/${p.id}`, data: { stats, updatedAt: db.now() } });
  }
  await chunked(ops);
}

// rows: [{orig, code, name, weights}]. Players follow a renamed role and
// lose a deleted one.
export async function saveRoleDefs(view, rows) {
  const id = view.deck.id;
  const ops = [{ op: 'update', path: D(id), data: { roles: rows.map(({ code, name, weights }) => ({ code, name, weights })) } }];
  const map = Object.fromEntries(rows.filter(r => r.orig).map(r => [r.orig, r.code]));
  for (const p of view.players) {
    if (!p.role) continue;
    const next = map[p.role] ?? '';
    if (next !== p.role) ops.push({ op: 'update', path: `${D(id)}/players/${p.id}`, data: { role: next, updatedAt: db.now() } });
  }
  await chunked(ops);
}

export async function deleteDeck(view) {
  const id = view.deck.id;
  const ops = [
    ...view.players.map(p => ({ op: 'delete', path: `${D(id)}/players/${p.id}` })),
    ...Object.keys(view.photos).map(p => ({ op: 'delete', path: `${D(id)}/photos/${p}` })),
    ...view.history.map(h => ({ op: 'delete', path: `${D(id)}/history/${h.id}` })),
    ...view.suggestions.map(s => ({ op: 'delete', path: `${D(id)}/suggestions/${s.id}` })),
    ...view.members.map(m => ({ op: 'delete', path: `${D(id)}/members/${m.id}` })),
  ];
  // Firestore batches cap at 500 writes; a friend deck is far below that.
  for (let i = 0; i < ops.length; i += 450) await db.batch(ops.slice(i, i + 450));
  await db.batch([{ op: 'delete', path: D(id) }]);
}

export async function addPlayer(deck, name) {
  const pid = db.newId();
  const stats = Object.fromEntries((deck.stats || []).map(s => [s.key, 60]));
  await db.batch([{ op: 'set', path: `${D(deck.id)}/players/${pid}`, data: {
    name, role: deck.roles?.[0]?.code || '', stats, skin: '', tag: '', photoPos: { x: 0, y: 0, s: 1 }, createdAt: db.now(),
  } }]);
  return pid;
}

export const updatePlayer = (deckId, pid, patch) =>
  db.batch([{ op: 'update', path: `${D(deckId)}/players/${pid}`, data: { ...patch, updatedAt: db.now() } }]);

export const removePlayer = (deckId, pid) => db.batch([
  { op: 'delete', path: `${D(deckId)}/players/${pid}` },
  { op: 'delete', path: `${D(deckId)}/photos/${pid}` },
]);

export const setPhoto = (deckId, pid, data) => db.batch([
  data ? { op: 'set', path: `${D(deckId)}/photos/${pid}`, data: { data } }
       : { op: 'delete', path: `${D(deckId)}/photos/${pid}` },
]);

function historyOp(deckId, p, key, from, to, kind, me, note) {
  return { op: 'set', path: `${D(deckId)}/history/${db.newId()}`, data: {
    pid: p.id, pname: p.name, key, from, to, kind, note: note || '', byUid: me.uid, byName: me.name, at: db.now(),
  } };
}

// Direct edit by an editor or the commissioner. Logged so it can be undone.
export async function setStat(deckId, p, key, value, me, kind = 'edit', note = '') {
  const to = clampStat(value), from = p.stats?.[key] ?? null;
  if (from === to) return;
  await db.batch([
    { op: 'update', path: `${D(deckId)}/players/${p.id}`, data: { [`stats.${key}`]: to, updatedAt: db.now() } },
    historyOp(deckId, p, key, from, to, kind, me, note),
  ]);
}

export const suggest = (deckId, p, key, value, note, me) => db.batch([{
  op: 'set', path: `${D(deckId)}/suggestions/${db.newId()}`, data: {
    pid: p.id, pname: p.name, key, from: p.stats?.[key] ?? null, to: clampStat(value), note: note || '',
    byUid: me.uid, byName: me.name, status: 'pending', at: db.now(),
  },
}]);

export async function resolveSuggestion(view, s, accept, me) {
  const id = view.deck.id;
  const ops = [{ op: 'update', path: `${D(id)}/suggestions/${s.id}`, data: { status: accept ? 'accepted' : 'rejected', resolvedAt: db.now() } }];
  const p = view.players.find(x => x.id === s.pid);
  if (accept && p) {
    ops.push({ op: 'update', path: `${D(id)}/players/${p.id}`, data: { [`stats.${s.key}`]: s.to, updatedAt: db.now() } });
    ops.push(historyOp(id, p, s.key, p.stats?.[s.key] ?? null, s.to, 'suggestion', me, `Suggested by ${s.byName}${s.note ? ': ' + s.note : ''}`));
  }
  await db.batch(ops);
}

export function undo(view, h, me) {
  const p = view.players.find(x => x.id === h.pid);
  if (!p || h.from == null) return;
  return setStat(view.deck.id, p, h.key, h.from, me, 'undo', `Undid ${h.byName}'s change`);
}

export const setMemberRole = (deckId, uid, role) =>
  db.batch([{ op: 'update', path: `${D(deckId)}/members/${uid}`, data: { role } }]);

// Next year's edition: same stats, roles, tiers and friends. Values carry
// over as the starting point and each card remembers last year's overall.
export async function newEdition(view, me) {
  const old = view.deck, year = (old.year || new Date().getFullYear()) + 1;
  const id = db.newId();
  const { id: _, createdAt, revealed, ...cfg } = old;
  // The deck must exist before its players: the rules check ownership with
  // get(), which sees the database as it was before the batch.
  await db.batch([{ op: 'set', path: D(id), data: {
    ...cfg, name: old.name.replace(String(old.year), String(year)), year, crest: String(year).slice(-2),
    revealed: false, prevDeckId: old.id, ownerUid: me.uid, ownerName: me.name, createdAt: db.now(),
  } }]);
  const ops = [];
  for (const p of view.players) {
    const { id: pid, createdAt: c, updatedAt: u, ...rest } = p;
    ops.push({ op: 'set', path: `${D(id)}/players/${pid}`, data: { ...rest, prevOvr: overall(p, old), createdAt: db.now() } });
    if (view.photos[pid]) ops.push({ op: 'set', path: `${D(id)}/photos/${pid}`, data: { data: view.photos[pid] } });
  }
  for (let i = 0; i < ops.length; i += 450) await db.batch(ops.slice(i, i + 450));
  return id;
}
