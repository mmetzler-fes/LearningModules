import { classifyResponse, backoffMs, replaceEntry, sendOrder, nextSeq } from './sync-rules.js';

// ==================== NACHSENDEN: SENDE-WARTESCHLANGE ====================
//
// Wackliges WLAN im Klassenzimmer (docs/offline-sync.md): Was Schüler
// schreiben, landet zuerst in der IndexedDB dieses Geräts und geht von hier
// aus zum Server – einzeln nacheinander, in der Reihenfolge des Entstehens,
// mit Wiederholung, bis es angekommen ist. Je Schlüssel zählt nur der
// neueste Stand. Die Einträge überstehen Neuladen und Schließen der App.
//
// Daneben ein Spiegel (`mirror`): der zuletzt bekannte Stand je Blatt, damit
// ein schon einmal geöffnetes Blatt auch ohne Netz wieder aufgeht.

const DB = 'lm-sync';
const OUTBOX = 'outbox';
const MIRROR = 'mirror';
const TIMEOUT_MS = 20000;

let opening = null;
function db() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Kein IndexedDB'));
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(OUTBOX, { keyPath: 'key' });
      req.result.createObjectStore(MIRROR, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

async function run(store, mode, fn) {
  const tx = (await db()).transaction(store, mode);
  return new Promise((resolve, reject) => {
    const req = fn(tx.objectStore(store));
    let result;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || req.error);
    tx.onabort = () => reject(tx.error || new Error('abgebrochen'));
  });
}

// ---- Gerät ----

const DEVICE_KEY = 'lm_device';
const SEQ_KEY = 'lm_device_seq';
let device = null;
let lastSeq = 0;
/** Zufallskennung dieses Browsers – unterscheidet zwei iPads desselben Schülers. */
export function deviceId() {
  if (device) return device;
  try { device = localStorage.getItem(DEVICE_KEY); } catch (_) { /* privat */ }
  if (!device) {
    device = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try { localStorage.setItem(DEVICE_KEY, device); } catch (_) { /* dann nur für diese Sitzung */ }
  }
  return device;
}
/** Laufende Nummer dieses Geräts (wächst immer). */
export function deviceSeq() {
  try { lastSeq = Math.max(lastSeq, Number(localStorage.getItem(SEQ_KEY)) || 0); } catch (_) { /* egal */ }
  lastSeq = nextSeq(lastSeq, Date.now());
  try { localStorage.setItem(SEQ_KEY, String(lastSeq)); } catch (_) { /* egal */ }
  return lastSeq;
}

// ---- Spiegel ----

export const mirror = {
  async get(key) {
    try { return (await run(MIRROR, 'readonly', (s) => s.get(key))) || null; } catch (_) { return null; }
  },
  async put(key, value) {
    try { await run(MIRROR, 'readwrite', (s) => s.put({ ...value, key, savedAt: Date.now() })); return true; } catch (_) { return false; }
  },
  async patch(key, changes) {
    const old = await mirror.get(key);
    if (old) await mirror.put(key, { ...old, ...changes });
  },
};

// ---- Warteschlange ----

/**
 * Nach dem Senden: `handlers[kind](entry, body)` – z. B. die neue Revision
 * merken oder die PIN zeigen. `prepare[kind](entry)` → Body kurz vor dem
 * Senden (z. B. mit der zuletzt bekannten Revision).
 */
const handlers = {};
const preparers = {};
export function onSent(kind, fn) { handlers[kind] = fn; }
export function beforeSend(kind, fn) { preparers[kind] = fn; }

/**
 * Eintrag in die Warteschlange: `key` (je Blatt/Ergebnis eindeutig),
 * `kind`, `url`, `body`, `label` (für Meldungen). Ersetzt einen wartenden
 * Eintrag mit demselben Schlüssel. Ergebnis: true, wenn er auf dem Gerät liegt.
 */
export async function enqueue({ key, kind, url, body, label = '' }) {
  const now = Date.now();
  let saved = false;
  try {
    const old = await run(OUTBOX, 'readonly', (s) => s.get(key));
    await run(OUTBOX, 'readwrite', (s) => s.put(replaceEntry(old, { key, kind, url, body, label }, now)));
    saved = true;
  } catch (_) {
    // Ohne IndexedDB (privates Fenster): nur im Speicher, solange die Seite offen ist.
    memory.set(key, replaceEntry(memory.get(key), { key, kind, url, body, label }, now));
    saved = true;
  }
  wakeSoon(0);
  return saved;
}
const memory = new Map();

async function all() {
  let rows = [];
  try { rows = (await run(OUTBOX, 'readonly', (s) => s.getAll())) || []; } catch (_) { /* nur Speicher */ }
  return [...rows, ...memory.values()];
}
async function removeIfSame(entry) {
  if (memory.get(entry.key)?.stamp === entry.stamp) { memory.delete(entry.key); return; }
  try {
    const db_ = await db();
    await new Promise((resolve, reject) => {
      const tx = db_.transaction(OUTBOX, 'readwrite');
      const s = tx.objectStore(OUTBOX);
      const req = s.get(entry.key);
      // Inzwischen ersetzt (neuerer Stand)? Dann bleibt der neue liegen.
      req.onsuccess = () => { if (req.result?.stamp === entry.stamp) s.delete(entry.key); };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* bleibt liegen, kommt doppelt – der Server verwirft Älteres */ }
}
async function update(entry, changes) {
  if (memory.has(entry.key)) { const m = memory.get(entry.key); if (m.stamp === entry.stamp) Object.assign(m, changes); return; }
  try {
    const db_ = await db();
    await new Promise((resolve, reject) => {
      const tx = db_.transaction(OUTBOX, 'readwrite');
      const s = tx.objectStore(OUTBOX);
      const req = s.get(entry.key);
      req.onsuccess = () => { if (req.result?.stamp === entry.stamp) s.put({ ...req.result, ...changes }); };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* egal */ }
}

/** Wartende Einträge – alle oder die, deren Schlüssel mit `prefix` beginnt. */
export async function pending(prefix = '') {
  return (await all()).filter((e) => e.key.startsWith(prefix));
}

/** Gesperrte Einträge (PIN) wieder freigeben – z. B. nachdem der Schüler seine PIN eingegeben hat. */
export async function retryBlocked(fixBody = null) {
  for (const e of await all()) {
    if (e.state !== 'pin') continue;
    await update(e, { state: 'wait', tries: 0, ...(fixBody ? { body: fixBody(e.body) } : {}) });
  }
  wakeSoon(0);
}

// ---- Senden ----

let running = null;
let timer = null;
let tries = 0;
let online = typeof navigator === 'undefined' || navigator.onLine !== false;

function wakeSoon(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, ms);
}

async function send(entry) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const body = preparers[entry.kind] ? await preparers[entry.kind](entry) : entry.body;
    const res = await fetch(entry.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl?.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (_) {
    return { status: 0, data: null };
  } finally {
    if (t) clearTimeout(t);
  }
}

/** Alles Wartende senden, einzeln nacheinander. Läuft höchstens einmal gleichzeitig. */
export function flush() {
  running ||= (async () => {
    try {
      for (;;) {
        const next = sendOrder(await all())[0];
        if (!next) { tries = 0; break; }
        const { status, data } = await send(next);
        const verdict = classifyResponse(status, data);
        if (verdict === 'retry') {
          online = false;
          tries++;
          await update(next, { tries: (next.tries || 0) + 1 });
          wakeSoon(backoffMs(tries));
          break;
        }
        online = true;
        tries = 0;
        if (verdict === 'ok') {
          await removeIfSame(next);
          try { await handlers[next.kind]?.(next, data); } catch (_) { /* Nacharbeit darf das Senden nicht aufhalten */ }
        } else {
          await update(next, { state: verdict, error: data?.message || `HTTP ${status}` });
          try { await handlers[`${next.kind}:${verdict}`]?.(next, data); } catch (_) { /* egal */ }
        }
        emit();
      }
    } finally {
      running = null;
      emit();
    }
  })();
  return running;
}

// ---- Zustand für die Anzeige ----

let last = null;
async function emit() {
  const rows = await all();
  const detail = {
    online,
    waiting: rows.filter((e) => e.state === 'wait').length,
    blocked: rows.filter((e) => e.state === 'pin').length,
    failed: rows.filter((e) => e.state === 'failed').length,
    keys: rows.map((e) => e.key),
    /** Zustand je Schlüssel: 'wait' | 'pin' | 'failed'. */
    states: Object.fromEntries(rows.map((e) => [e.key, e.state])),
  };
  const sig = JSON.stringify(detail);
  if (sig === last) return;
  last = sig;
  window.dispatchEvent(new CustomEvent('lm-sync', { detail }));
}
/** Aktueller Zustand (wie im Ereignis „lm-sync“). */
export async function syncState() {
  last = null;
  await emit();
  return JSON.parse(last);
}

// Netz wieder da, App wieder im Vordergrund, und sonst alle 30 s: nachsenden.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { tries = 0; wakeSoon(0); });
  window.addEventListener('offline', () => { online = false; void emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeSoon(500); });
  setInterval(() => { if (!running) void flush(); }, 30000);
  wakeSoon(1500); // beim Start: Liegengebliebenes vom letzten Mal
}
