// Opslag in de browser (IndexedDB). Eén record per dag, sleutel = 'YYYY-MM-DD'.
//
// Record:
// {
//   date, time, source: 'sense' | 'hrv4t',
//   hr, rmssd, avnn, sdnn, pnn50, extrasystolen,
//   measurement: { data:[{t,rr}], segments:[{s,e,bypassed}], swallowMarks:[], limits:{min,max}, duration, device } | null,
//   tags: { ... zie tags.js ... },
//   advice: string | null,   // dagadvies (geïmporteerd uit HRV4Training)
//   createdAt, updatedAt
// }

const DB_NAME = 'sense-hrv';
const DB_VERSION = 2;
const STORE = 'days';
const ACT = 'activities'; // trainingen uit Intervals.icu, sleutel = activiteit-id

let dbPromise;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'date' });
        if (!db.objectStoreNames.contains(ACT)) db.createObjectStore(ACT, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn, storeName = STORE) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const getDay = (date) => tx('readonly', (s) => wrap(s.get(date)));

/** Alle dagen, oplopend op datum. */
export const getAll = () => tx('readonly', (s) => wrap(s.getAll())).then((rows) => rows.sort((a, b) => a.date.localeCompare(b.date)));

export const count = () => tx('readonly', (s) => wrap(s.count()));

export function putDay(rec) {
  const now = new Date().toISOString();
  rec.updatedAt = now;
  if (!rec.createdAt) rec.createdAt = now;
  return tx('readwrite', (s) => wrap(s.put(rec)));
}

/** Veel records in één transactie (import). */
export function putMany(recs) {
  const now = new Date().toISOString();
  return tx('readwrite', (s) => {
    for (const r of recs) {
      r.updatedAt = r.updatedAt || now;
      r.createdAt = r.createdAt || now;
      s.put(r);
    }
    return recs.length;
  });
}

export const deleteDay = (date) => tx('readwrite', (s) => wrap(s.delete(date)));
export const clearAll = () => tx('readwrite', (s) => wrap(s.clear()));

/** Vraag de browser om de opslag niet automatisch op te ruimen. */
export async function requestPersist() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* niet ondersteund */ }
  return false;
}
export async function isPersisted() {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : false; } catch { return false; }
}

// ---- Activiteiten (Intervals.icu) ----
// { id, date: 'YYYY-MM-DD', start, name, type, sport, movingMin, distanceKm, avgHr, maxHr, rpe, load, source: 'intervals' }
export const getActivities = () => tx('readonly', (s) => wrap(s.getAll()), ACT).then((rows) => rows.sort((a, b) => (a.start || a.date).localeCompare(b.start || b.date)));
export function putActivities(rows) {
  return tx('readwrite', (s) => { for (const r of rows) s.put(r); return rows.length; }, ACT);
}
export const clearActivities = () => tx('readwrite', (s) => wrap(s.clear()), ACT);
