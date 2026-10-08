// Storage adapters. Both expose the same small API over slash paths
// ("decks/abc/players/xyz"), so store.js is written once.
//   watchDoc(path, cb, onErr) / watchCol(path, q, cb, onErr) -> unsubscribe
//   getCol(path, q) -> [{id, ...}]
//   batch([{op:'set'|'update'|'delete', path, data}])
//   newId(), now(), del() (removes a field in an update), auth: watch(cb) / signIn() / signOut()
// q = {where: [field, '==', value], orderBy: [field, 'asc'|'desc'], limit}
import { firebaseConfig, isConfigured } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.0/';

async function firebaseAdapter() {
  const { initializeApp } = await import(FB + 'firebase-app.js');
  const A = await import(FB + 'firebase-auth.js');
  const F = await import(FB + 'firebase-firestore.js');
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const fs = F.getFirestore(app);

  // Timestamps come back as objects; the app only ever wants milliseconds.
  const plain = snap => {
    const d = { id: snap.id, ...snap.data() };
    for (const k in d) if (d[k] && typeof d[k].toMillis === 'function') d[k] = d[k].toMillis();
    return d;
  };
  const ref = p => F.doc(fs, p);
  const qry = (p, q = {}) => {
    const parts = [];
    if (q.where) parts.push(F.where(...q.where));
    if (q.orderBy) parts.push(F.orderBy(...q.orderBy));
    if (q.limit) parts.push(F.limit(q.limit));
    return F.query(F.collection(fs, p), ...parts);
  };

  return {
    local: false,
    watchDoc: (p, cb, err) => F.onSnapshot(ref(p), s => cb(s.exists() ? plain(s) : null), err),
    watchCol: (p, q, cb, err) => F.onSnapshot(qry(p, q), s => cb(s.docs.map(plain)), err),
    getCol: async (p, q) => (await F.getDocs(qry(p, q))).docs.map(plain),
    getDoc: async p => { const s = await F.getDoc(ref(p)); return s.exists() ? plain(s) : null; },
    batch: async ops => {
      const b = F.writeBatch(fs);
      for (const o of ops) {
        if (o.op === 'set') b.set(ref(o.path), o.data);
        else if (o.op === 'update') b.update(ref(o.path), o.data);
        else b.delete(ref(o.path));
      }
      await b.commit();
    },
    newId: () => F.doc(F.collection(fs, '_')).id,
    now: () => F.serverTimestamp(),
    del: () => F.deleteField(),
    auth: {
      watch: cb => A.onAuthStateChanged(auth, u => cb(u && { uid: u.uid, name: u.displayName || u.email, email: u.email })),
      signIn: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
      signOut: () => A.signOut(auth),
    },
  };
}

// Local demo mode: one JSON blob in localStorage, you are the only user.
function localAdapter() {
  const KEY = 'squad.local.v1';
  let docs = {};
  try { docs = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { docs = {}; }
  const subs = new Set();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(docs)); }
    catch { console.warn('Local storage is full; demo changes will not survive a reload.'); }
  };
  const fire = () => subs.forEach(f => f());
  const parent = p => p.slice(0, p.lastIndexOf('/'));
  const colOf = (p, q = {}) => {
    let rows = Object.entries(docs)
      .filter(([k]) => parent(k) === p)
      .map(([k, v]) => ({ id: k.slice(p.length + 1), ...structuredClone(v) }));
    if (q.where) { const [f, , v] = q.where; rows = rows.filter(r => r[f] === v); }
    if (q.orderBy) {
      const [f, dir] = q.orderBy;
      rows.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    return rows;
  };
  const setPath = (obj, dotted, val) => {
    const keys = dotted.split('.');
    let o = obj;
    while (keys.length > 1) { const k = keys.shift(); o = o[k] ??= {}; }
    if (val === undefined) delete o[keys[0]]; else o[keys[0]] = val;
  };
  const user = { uid: 'local', name: 'You', email: '' };

  return {
    local: true,
    watchDoc: (p, cb) => {
      const f = () => cb(docs[p] ? { id: p.split('/').pop(), ...structuredClone(docs[p]) } : null);
      subs.add(f); queueMicrotask(f); return () => subs.delete(f);
    },
    watchCol: (p, q, cb) => {
      const f = () => cb(colOf(p, q));
      subs.add(f); queueMicrotask(f); return () => subs.delete(f);
    },
    getCol: async (p, q) => colOf(p, q),
    getDoc: async p => docs[p] ? { id: p.split('/').pop(), ...structuredClone(docs[p]) } : null,
    batch: async ops => {
      for (const o of ops) {
        if (o.op === 'set') docs[o.path] = structuredClone(o.data);
        else if (o.op === 'update') {
          if (!docs[o.path]) throw new Error('No document to update: ' + o.path);
          for (const [k, v] of Object.entries(o.data)) setPath(docs[o.path], k, v);
        } else {
          delete docs[o.path];
        }
      }
      save(); fire();
    },
    newId: () => Math.random().toString(36).slice(2, 12),
    now: () => Date.now(),
    del: () => undefined,
    auth: {
      watch: cb => { queueMicrotask(() => cb(user)); return () => {}; },
      signIn: async () => {},
      signOut: async () => {},
    },
  };
}

export const db = isConfigured ? await firebaseAdapter() : localAdapter();
