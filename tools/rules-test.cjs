// Checks firestore.rules against the Firestore emulator. No npm packages:
// it talks to the emulator's REST API with unsigned test tokens.
// Usage (needs Java):
//   npx firebase-tools emulators:exec --only firestore --project demo-squad "node tools/rules-test.cjs"
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const PROJECT = 'demo-squad';
const DB = `projects/${PROJECT}/databases/(default)/documents`;
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

function req(method, route, body, auth) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: HOST[0], port: Number(HOST[1]), method, path: route, headers: {
      'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, res => {
      let b = ''; res.on('data', d => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// The emulator accepts unsigned tokens; 'owner' bypasses rules for seeding.
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = uid => uid === 'admin' ? 'owner' : uid ? `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  sub: uid, user_id: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`,
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, auth_time: Math.floor(Date.now() / 1000),
  firebase: { sign_in_provider: 'google.com', identities: {} },
})}.` : null;

const enc = v => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));

// ops: {set: path, data} | {update: path, data (dotted keys; undefined deletes)} | {delete: path}
function write(o) {
  if (o.delete) return { delete: `${DB}/${o.delete}` };
  if (o.set) return { update: { name: `${DB}/${o.set}`, fields: fields(o.data) } };
  const tree = {};
  for (const [k, v] of Object.entries(o.data)) {
    if (v === undefined) continue;
    const ks = k.split('.'); let t = tree;
    while (ks.length > 1) { const x = ks.shift(); t = t[x] ??= {}; }
    t[ks[0]] = v;
  }
  return { update: { name: `${DB}/${o.update}`, fields: fields(tree) },
    updateMask: { fieldPaths: Object.keys(o.data) }, currentDocument: { exists: true } };
}
const commit = (uid, ...ops) => req('POST', `/v1/${DB}:commit`, { writes: ops.map(write) }, token(uid));
const getDoc = (uid, p) => req('GET', `/v1/${DB}/${p}`, null, token(uid));
const list = (uid, parent, col, where) => req('POST', `/v1/${DB}${parent ? '/' + parent : ''}:runQuery`, { structuredQuery: {
  from: [{ collectionId: col }],
  ...(where ? { where: { fieldFilter: { field: { fieldPath: where[0] }, op: 'EQUAL', value: enc(where[1]) } } } : {}),
} }, token(uid));

async function expect(allowed, what, p) {
  const r = await p;
  const ok = r.status === 200 && !(Array.isArray(r.body) && r.body[0]?.error);
  check(ok === allowed, `${allowed ? 'allows' : 'blocks'} ${what}${ok === allowed ? '' : ` (got ${r.status})`}`);
}

(async () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const put = await req('PUT', `/emulator/v1/projects/${PROJECT}:securityRules`, { rules: { files: [{ name: 'firestore.rules', content: rules }] } });
  if (put.status !== 200) { console.error('Rules did not load:', JSON.stringify(put.body, null, 1)); process.exit(1); }
  await req('DELETE', `/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);

  const D = 'decks/d1';
  // Cast: owner; a, b, c are friends; linked is the friend on card p1;
  // sug is a suggester, ed an editor, out is signed in but never joined.
  await commit('admin',
    { set: D, data: { name: 'Class', year: 2026, ownerUid: 'owner1', revealed: false, lives: 5, voters: ['owner1', 'a', 'b', 'c', 'linked'] } },
    { set: `${D}/players/p1`, data: { name: 'Ace', stats: { BAN: 60 }, linkedUid: 'linked' } },
    { set: `${D}/players/p2`, data: { name: 'Blaze', stats: { BAN: 70 } } },
    { set: `${D}/members/a`, data: { role: 'viewer' } }, { set: `${D}/members/b`, data: { role: 'viewer' } },
    { set: `${D}/members/c`, data: { role: 'viewer' } }, { set: `${D}/members/linked`, data: { role: 'viewer' } },
    { set: `${D}/members/sug`, data: { role: 'suggester' } }, { set: `${D}/members/ed`, data: { role: 'editor' } },
    { set: 'decks/d2', data: { name: 'Other', ownerUid: 'someone', revealed: true } });

  console.log('-- decks');
  await expect(true, 'anyone opening a deck by link', getDoc(null, D));
  await expect(false, 'anonymous listing of all decks', list(null, null, 'decks'));
  await expect(false, 'listing every deck while signed in', list('a', null, 'decks'));
  await expect(true, 'the owner listing their own decks', list('owner1', null, 'decks', ['ownerUid', 'owner1']));
  await expect(false, 'a friend changing the deck', commit('a', { update: D, data: { name: 'Mine' } }));

  console.log('-- hidden until reveal');
  await expect(false, 'a viewer reading hidden cards', list('a', D, 'players'));
  await expect(true, 'a suggester reading hidden cards', list('sug', D, 'players'));
  await commit('admin', { update: D, data: { revealed: true } });
  await expect(true, 'anyone reading revealed cards', list(null, D, 'players'));

  console.log('-- stats');
  await expect(true, 'an editor changing a stat', commit('ed', { update: `${D}/players/p2`, data: { 'stats.BAN': 71, updatedAt: 1 } }));
  await expect(false, 'an editor renaming a card', commit('ed', { update: `${D}/players/p2`, data: { name: 'X' } }));
  await expect(false, 'a viewer changing a stat', commit('a', { update: `${D}/players/p2`, data: { 'stats.BAN': 99 } }));
  await expect(true, 'the friend on a card renaming it', commit('linked', { update: `${D}/players/p1`, data: { name: 'Ace2', updatedAt: 1 } }));
  await expect(false, 'the friend on a card changing its stats', commit('linked', { update: `${D}/players/p1`, data: { 'stats.BAN': 99 } }));
  await expect(true, 'an editor logging history', commit('ed', { set: `${D}/history/h1`, data: { pid: 'p2', key: 'BAN', from: 70, to: 71, byUid: 'ed' } }));
  await expect(false, 'history with a non-number value', commit('ed', { set: `${D}/history/h2`, data: { pid: 'p2', key: 'BAN', from: 70, to: '<img>', byUid: 'ed' } }));
  await expect(true, 'a suggester suggesting 70', commit('sug', { set: `${D}/suggestions/s1`, data: { pid: 'p2', key: 'BAN', to: 70, byUid: 'sug', status: 'pending' } }));
  await expect(false, 'a suggestion of 500', commit('sug', { set: `${D}/suggestions/s2`, data: { pid: 'p2', key: 'BAN', to: 500, byUid: 'sug', status: 'pending' } }));
  await expect(false, 'a viewer suggesting', commit('a', { set: `${D}/suggestions/s3`, data: { pid: 'p2', key: 'BAN', to: 70, byUid: 'a', status: 'pending' } }));

  console.log('-- photos');
  await expect(true, 'the friend on a card uploading a photo', commit('linked', { set: `${D}/photos/p1`, data: { data: 'data:image/webp;base64,UklGRg==' } }));
  await expect(false, 'a photo that is not an image', commit('linked', { set: `${D}/photos/p1`, data: { data: 'x" onload="alert(1)' } }));
  await expect(false, "someone else's photo", commit('a', { set: `${D}/photos/p1`, data: { data: 'data:image/webp;base64,AA==' } }));

  console.log('-- members');
  await expect(true, 'joining as a viewer', commit('newbie', { set: `${D}/members/newbie`, data: { role: 'viewer' } }));
  await expect(false, 'joining as an editor', commit('sneaky', { set: `${D}/members/sneaky`, data: { role: 'editor' } }));
  await expect(true, 'the owner adding an editor (new edition)', commit('owner1', { set: `${D}/members/z`, data: { role: 'editor' } }));
  await expect(false, 'a friend reading the member list', list('a', D, 'members'));

  console.log('-- lives (5 voters, card p1 belongs to "linked", so 4 eligible: 3 needed)');
  const V = `${D}/votes`;
  const vote = (by, extra = {}) => ({ pid: 'p1', pname: 'Ace', reason: 'late', byUid: by, byName: by, yes: { [by]: true }, no: {}, status: 'open', at: 1, ...extra });
  await expect(false, 'the friend on the card starting a vote on it', commit('linked', { set: `${V}/x`, data: vote('linked') }));
  await expect(false, 'a non-voter starting a vote', commit('out', { set: `${V}/x`, data: vote('out') }));
  await expect(false, 'a vote that starts already passed', commit('a', { set: `${V}/x`, data: vote('a', { status: 'passed' }) }));
  await expect(false, 'starting a vote with extra yes votes', commit('a', { set: `${V}/x`, data: vote('a', { yes: { a: true, b: true } }) }));
  await expect(true, 'a voter starting a vote', commit('a', { set: `${V}/v1`, data: vote('a') }));
  await expect(false, "casting someone else's ballot", commit('b', { update: `${V}/v1`, data: { 'yes.c': true, status: 'open' } }));
  await expect(false, 'closing the vote early', commit('b', { update: `${V}/v1`, data: { 'yes.b': true, status: 'passed' } }));
  await expect(true, 'b voting yes (2 of 3)', commit('b', { update: `${V}/v1`, data: { 'yes.b': true, 'no.b': undefined, status: 'open' } }));
  await expect(false, 'voting yes and no at once', commit('c', { update: `${V}/v1`, data: { 'yes.c': true, 'no.c': true, status: 'open' } }));
  await expect(false, 'c voting yes but leaving it open', commit('c', { update: `${V}/v1`, data: { 'yes.c': true, 'no.c': undefined, status: 'open' } }));
  await expect(true, 'c voting yes, which passes it', commit('c', { update: `${V}/v1`, data: { 'yes.c': true, 'no.c': undefined, status: 'passed', closedAt: 1 } }));
  await expect(false, 'voting on a closed vote', commit('owner1', { update: `${V}/v1`, data: { 'no.owner1': true, 'yes.owner1': undefined, status: 'passed' } }));
  await expect(false, 'a friend giving the life back', commit('a', { update: `${V}/v1`, data: { status: 'overturned' } }));
  await expect(true, 'the owner giving the life back', commit('owner1', { update: `${V}/v1`, data: { status: 'overturned', closedAt: 2 } }));
  await expect(true, 'a second vote', commit('b', { set: `${V}/v2`, data: vote('b') }));
  await expect(true, 'a voting no', commit('a', { update: `${V}/v2`, data: { 'no.a': true, 'yes.a': undefined, status: 'open' } }));
  await expect(true, 'c voting no, which spares them (2 of 4 can no longer lose)', commit('c', { update: `${V}/v2`, data: { 'no.c': true, 'yes.c': undefined, status: 'failed', closedAt: 1 } }));
  await expect(true, 'the owner calling off an open vote', (async () => {
    await commit('a', { set: `${V}/v3`, data: vote('a') });
    return commit('owner1', { update: `${V}/v3`, data: { status: 'cancelled', closedAt: 1 } });
  })());
  await commit('admin', { update: D, data: { lives: 0 } });
  await expect(false, 'starting a vote when lives are off', commit('a', { set: `${V}/v4`, data: vote('a') }));
  await commit('admin', { update: D, data: { lives: 5, revealed: false } });
  await expect(false, 'a viewer reading votes while the deck is hidden', list('a', D, 'votes'));

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
