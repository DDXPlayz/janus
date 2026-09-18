// A small promise-based IndexedDB wrapper for JANUS.
// Database "janus" version 1. Stores:
//   packs      (key: id)                      installed content packs (metadata)
//   lessons    (key: id, index: subject)      installed lesson content
//   progress   (key: lessonId)                per-lesson progress
//   results    (auto, index: lessonId)        quiz results
//   tutor      (auto)                         local tutor history
//   syncQueue  (auto)                         pending records awaiting sync
//   synced     (auto)                         the LocalMirrorTarget's copy of synced records
//   activity   (key: day 'YYYY-MM-DD')        daily activity counters (for streaks)
//   meta       (key: key)                     misc (lastSyncedAt, …)

const DB_NAME = 'janus';
const DB_VERSION = 1;
let dbPromise = null;

export const STORES = ['packs', 'lessons', 'progress', 'results', 'tutor', 'syncQueue', 'synced', 'activity', 'meta'];

export function idbAvailable() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!idbAvailable()) { reject(new Error('IndexedDB is not available in this browser')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const has = (n) => db.objectStoreNames.contains(n);
      if (!has('packs')) db.createObjectStore('packs', { keyPath: 'id' });
      if (!has('lessons')) db.createObjectStore('lessons', { keyPath: 'id' }).createIndex('subject', 'subject', { unique: false });
      if (!has('progress')) db.createObjectStore('progress', { keyPath: 'lessonId' });
      if (!has('results')) db.createObjectStore('results', { keyPath: 'id', autoIncrement: true }).createIndex('lessonId', 'lessonId', { unique: false });
      if (!has('tutor')) db.createObjectStore('tutor', { keyPath: 'id', autoIncrement: true });
      if (!has('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      if (!has('synced')) db.createObjectStore('synced', { keyPath: 'id', autoIncrement: true });
      if (!has('activity')) db.createObjectStore('activity', { keyPath: 'day' });
      if (!has('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch (e) { /* ignore */ } dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB open was blocked'));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(store, mode); } catch (e) { reject(e); return; }
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && typeof result.then === 'function' ? result : (result && 'result' in result ? result.result : result));
    t.onerror = () => reject(t.error || new Error('Transaction failed'));
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  get(store, key) { return tx(store, 'readonly', (s) => reqToPromise(s.get(key))); },
  getAll(store) { return tx(store, 'readonly', (s) => reqToPromise(s.getAll())); },
  getAllKeys(store) { return tx(store, 'readonly', (s) => reqToPromise(s.getAllKeys())); },
  getAllByIndex(store, index, value) { return tx(store, 'readonly', (s) => reqToPromise(s.index(index).getAll(value))); },
  count(store) { return tx(store, 'readonly', (s) => reqToPromise(s.count())); },
  put(store, value) { return tx(store, 'readwrite', (s) => reqToPromise(s.put(value))); },
  add(store, value) { return tx(store, 'readwrite', (s) => reqToPromise(s.add(value))); },
  putMany(store, values) { return tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); return Promise.resolve(values.length); }); },
  delete(store, key) { return tx(store, 'readwrite', (s) => reqToPromise(s.delete(key))); },
  deleteMany(store, keys) { return tx(store, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); return Promise.resolve(keys.length); }); },
  clear(store) { return tx(store, 'readwrite', (s) => reqToPromise(s.clear())); },
  async getMeta(key, fallback = null) { try { const r = await this.get('meta', key); return r ? r.value : fallback; } catch (e) { return fallback; } },
  async setMeta(key, value) { try { await this.put('meta', { key, value }); } catch (e) { /* ignore */ } },
};

/** Approximate bytes used by each store (serialised JSON length). */
export async function storageBreakdown() {
  const out = {};
  for (const name of STORES) {
    try {
      const all = await db.getAll(name);
      out[name] = { count: all.length, bytes: new Blob([JSON.stringify(all)]).size };
    } catch (e) { out[name] = { count: 0, bytes: 0 }; }
  }
  return out;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0, supported: true };
    }
  } catch (e) { /* ignore */ }
  return { usage: 0, quota: 0, supported: false };
}
