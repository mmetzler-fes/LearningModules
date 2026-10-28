// ==================== ENTWÜRFE AUCH IM BROWSER ====================
//
// Zweite Sicherung neben /api/drafts: Jeder Stand des Modul-Editors liegt
// zusätzlich in der IndexedDB dieses Browsers. Fällt die Verbindung oder die
// Anmeldung weg (Sitzung abgelaufen, Server neu gestartet), bleibt die Arbeit
// hier und wird beim nächsten Öffnen angeboten (views/modules.js).
// IndexedDB statt localStorage: Bilder als data:-Adresse sprengen dessen 5 MB.

const DB = 'lm-drafts';
const STORE = 'drafts';
/** Lokale Entwürfe, die so lange nicht angefasst wurden, fallen weg. */
const KEEP_MS = 30 * 24 * 3600 * 1000;

let opening = null;
function db() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Kein IndexedDB'));
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

async function run(mode, fn) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Je Benutzer getrennt – auf einem geteilten Rechner sieht niemand die Entwürfe anderer. */
const id = (user, key) => `${user || '-'}|${key}`;

export const localDrafts = {
  /** { data, topicId, moduleId, title } für `key` sichern (mit Zeitstempel). */
  async put(user, key, entry) {
    try { await run('readwrite', (s) => s.put({ ...entry, key: id(user, key), draftKey: key, user, updatedAt: Date.now() })); } catch (_) { /* ohne IndexedDB: nur die Sicherung auf dem Server */ }
  },
  async get(user, key) {
    try {
      const e = await run('readonly', (s) => s.get(id(user, key)));
      return e && Date.now() - e.updatedAt < KEEP_MS ? e : null;
    } catch (_) { return null; }
  },
  async remove(user, key) {
    try { await run('readwrite', (s) => s.delete(id(user, key))); } catch (_) { /* egal */ }
  },
  /** Alle lokalen Entwürfe des Benutzers (ohne zu alte). */
  async list(user) {
    try {
      const all = await run('readonly', (s) => s.getAll());
      return (all || []).filter((e) => e.user === user && Date.now() - e.updatedAt < KEEP_MS);
    } catch (_) { return []; }
  },
};
