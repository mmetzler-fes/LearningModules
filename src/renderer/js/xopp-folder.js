// ==================== PDF ZUR .xopp IM SELBEN ORDNER ====================
//
// Eine per „Öffnen mit“ geöffnete .xopp kommt als Datei-Handle (app.js:
// launchQueue). Der Browser verrät den Ordner dazu nicht – lesen darf die App
// ihn erst, wenn die Lehrkraft ihn einmal freigibt. Der Ordner-Dialog öffnet
// sich dafür gleich im Ordner der .xopp (nur „Auswählen“ klicken); die
// Freigabe merkt sich die App (IndexedDB), beim nächsten Mal sucht sie dort
// ohne Dialog – oder mit einer kurzen Rückfrage des Browsers, wenn er die
// Erlaubnis inzwischen vergessen hat. Steht das PDF nicht im Ordner, öffnet
// sich die Dateiauswahl ebenfalls dort.

const handles = new WeakMap();
const DB = 'lm-folders';
const STORE = 'folders';
const KEEP = 12; // so viele freigegebene Ordner merkt sich die App

/** Datei-Handle zur geöffneten Datei merken (app.js). */
export function noteHandle(file, handle) {
  if (file && handle) handles.set(file, handle);
}

const canPick = () => typeof window.showDirectoryPicker === 'function';

/** Kann die App im Ordner von `file` suchen (Handle da, Chrome/Edge)? */
export const canReadFolder = (file) => handles.has(file) && canPick();

let opening = null;
function db() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Kein IndexedDB'));
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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
async function savedFolders() {
  try { return (await run('readonly', (s) => s.get('list'))) || []; } catch (_) { return []; }
}
async function rememberFolder(dir) {
  const list = await savedFolders();
  const rest = [];
  for (const d of list) if (!(await d.isSameEntry(dir).catch(() => false))) rest.push(d);
  try { await run('readwrite', (s) => s.put([dir, ...rest].slice(0, KEEP), 'list')); } catch (_) { /* ohne IndexedDB: nächstes Mal wieder freigeben */ }
}

/** Gemerkter Ordner, in dem `handle` direkt liegt – oder null. */
async function folderOf(handle) {
  for (const dir of await savedFolders()) {
    const path = await dir.resolve(handle).catch(() => null);
    if (path?.length === 1) return dir;
  }
  return null;
}

/** Das PDF im Ordner: Name aus der .xopp, sonst gleicher Name wie sie. */
async function findIn(dir, pdfName, xoppName) {
  const base = (n) => String(n || '').replace(/\.[^.]+$/, '').toLowerCase();
  const want = String(pdfName || '').toLowerCase();
  const found = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && /\.pdf$/i.test(entry.name)) found.push(entry);
  }
  const hit = found.find((e) => e.name.toLowerCase() === want)
    || found.find((e) => want && base(e.name) === base(want))
    || found.find((e) => base(xoppName).startsWith(base(e.name)));
  return hit ? hit.getFile() : null;
}

/**
 * Das PDF zur .xopp `file` (gelesen: `xopp`) ohne Rückfrage aus dem Ordner,
 * wenn der freigegeben ist und die Erlaubnis noch gilt – sonst null.
 */
export async function pdfFromKnownFolder(file, xopp) {
  const handle = handles.get(file);
  if (!handle || !canPick()) return null;
  const dir = await folderOf(handle);
  if (!dir || (await dir.queryPermission({ mode: 'read' }).catch(() => 'denied')) !== 'granted') return null;
  return findIn(dir, xopp.pdfName, file.name).catch(() => null);
}

/**
 * Nach einem Klick (Nutzeraktion): Ordner der .xopp freigeben bzw. die
 * Freigabe erneuern und das PDF dort suchen. Fehlt es, nach `confirm(text)`
 * (frischer Klick – jeder Dialog des Browsers braucht einen) die Dateiauswahl
 * im selben Ordner. `fallback(accept)` wählt ohne Ordner-Zugriff (andere Browser).
 */
export async function pickPdfNear(file, xopp, { confirm, fallback }) {
  const handle = handles.get(file);
  if (!handle || !canPick()) return fallback('.pdf,application/pdf');
  let dir = await folderOf(handle);
  if (dir && (await dir.requestPermission({ mode: 'read' }).catch(() => 'denied')) !== 'granted') dir = null;
  if (!dir) {
    // Chrome sperrt manche Ordner, z. B. ein Laufwerk direkt (N:\ – auch eine verbundene Nextcloud):
    // „enthält Systemdateien“. Dann bleibt die Dateiauswahl – sie darf dort öffnen.
    try { dir = await window.showDirectoryPicker({ startIn: handle, mode: 'read' }); } catch (_) { dir = null; }
    if (dir) await rememberFolder(dir);
    else if (!(await confirm(`Der Ordner wurde nicht freigegeben – direkt auf einem Laufwerk (z. B. N:\\) lässt der Browser das nicht zu.\n\nDas PDF „${xopp.pdfName || '…'}“ selbst auswählen? (Die Auswahl öffnet im Ordner der .xopp.)`))) return null;
  }
  if (dir) {
    const pdf = await findIn(dir, xopp.pdfName, file.name).catch(() => null);
    if (pdf) return pdf;
    if (!(await confirm(`Im Ordner „${dir.name}“ liegt kein PDF „${xopp.pdfName || '…'}“.\n\nDas PDF selbst auswählen?`))) return null;
  }
  try {
    const [h] = await window.showOpenFilePicker({
      startIn: dir || handle,
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    });
    return h ? h.getFile() : null;
  } catch (_) { return null; } // abgebrochen
}
