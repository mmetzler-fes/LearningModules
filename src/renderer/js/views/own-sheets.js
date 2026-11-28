// ==================== EIGENE BLÄTTER DER SCHÜLER (nur auf diesem Gerät) ====================
//
// Schritt D (docs/klassennotizbuch.md): Schüler legen im Klassennotizbuch eigene Blätter an –
// Karo, Linien oder leer, mit Titel. Darauf schreiben sie mit dem Stift und fügen über ⊕ eigene
// Textblöcke, Tabellen und Bilder ein (wie auf den Blättern der Lehrkraft, layer.inserts).
// Gespeichert wird NUR im Browser (IndexedDB) – kein Server, keine Sicherung: eigene Verantwortung.
// Zum Sichern: ⬇ als .zlm-Datei (öffnet auch der lm-editor), 📂 holt eine solche Datei zurück.

import { escapeHtml, escapeAttr } from '../utils.js';
import { icon } from '../../lm-editor/src/util/icons.js';

const DB = 'lm-own-sheets';
const STORE = 'sheets';
const PATTERNS = [['karo', 'Karo'], ['linien', 'Linien'], ['leer', 'Leer']];
const FIELD_LINES = 46; // eine A4-Seite unter der Überschrift (0,5 cm je Zeile)

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('Dieser Browser kann keine eigenen Blätter speichern.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Speicher des Browsers nicht verfügbar.'));
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error || new Error('Abgebrochen')); };
  });
}
export const listSheets = async () => {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
};
const getSheet = (id) => tx('readonly', (s) => s.get(id));
const putSheet = (sheet) => tx('readwrite', (s) => s.put(sheet));
const deleteSheet = (id) => tx('readwrite', (s) => s.delete(id));

const newId = () => `own${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Grundblatt: Überschrift und ein Schreibfeld über die Seite – alles andere kommt in die eigene Ebene. */
export function baseSpec(title, pattern = 'karo') {
  return {
    content: [
      { type: 'heading', level: 2, text: title || 'Eigenes Blatt', id: 'own-title' },
      { type: 'karo', lines: FIELD_LINES, ...(pattern !== 'karo' ? { pattern } : {}), id: 'own-field' },
    ],
  };
}

/** Den Browser bitten, die Daten nicht von selbst zu löschen (Safari räumt sonst nach Wochen auf). */
function askPersist() {
  try { void navigator.storage?.persist?.(); } catch (_) { /* egal */ }
}

/** Kleiner Dialog: Titel und Muster. Liefert { title, pattern } oder null. */
function askNew({ title = '', pattern = 'karo', rename = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card own-sheet-dialog" role="dialog" aria-modal="true">
      <h3>${rename ? 'Blatt umbenennen' : 'Neues eigenes Blatt'}</h3>
      <label class="own-sheet-field">Titel <input type="text" class="form-input" maxlength="120" value="${escapeAttr(title)}" placeholder="z. B. Spickzettel Ohmsches Gesetz"></label>
      ${rename ? '' : `<div class="own-sheet-patterns">${PATTERNS.map(([k, l]) => `<label><input type="radio" name="ownPattern" value="${k}"${k === pattern ? ' checked' : ''}> ${l}</label>`).join('')}</div>
      <p class="hint">Nur auf diesem Gerät – nicht gesichert. Wichtiges mit ⬇ als Datei sichern.</p>`}
      <div class="confirm-actions">
        <button type="button" class="btn btn-primary" data-ok>${rename ? 'Umbenennen' : 'Anlegen'}</button>
        <button type="button" class="btn btn-secondary" data-cancel>Abbrechen</button>
      </div></div>`;
    const input = overlay.querySelector('input[type="text"]');
    const done = (v) => { overlay.remove(); resolve(v); };
    const ok = () => done({ title: input.value.trim() || 'Eigenes Blatt', pattern: overlay.querySelector('input[name="ownPattern"]:checked')?.value || pattern });
    overlay.querySelector('[data-ok]').addEventListener('click', ok);
    overlay.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') done(null); });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

const when = (iso) => {
  try { return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
};

/** HTML des Bereichs (Liste kommt aus IndexedDB, daher erst nach dem Laden: fillOwnSheets). */
export function ownSheetsSection(ico) {
  return `<h3 class="cb-section">${ico('pen')} Eigene Blätter</h3>
    <p class="hint own-sheets-hint">Nur auf diesem Gerät – nicht auf dem Server gesichert. Deine Lehrkraft sieht sie nicht. Wichtiges sicherst du mit ⬇ als Datei.</p>
    <div class="own-sheets" data-own-sheets><p class="hint">…</p></div>
    <div class="own-sheets-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-own-new>${icon('plus')} Neues Blatt</button>
      <button type="button" class="btn btn-secondary btn-sm" data-own-import title="Eine gesicherte .zlm-Datei wieder als eigenes Blatt öffnen">${icon('folder')} Datei öffnen</button>
    </div>`;
}

/** Bereich füllen und bedienbar machen. `toast(text, type)`. */
export async function fillOwnSheets(root, { toast = () => {} } = {}) {
  const box = root.querySelector('[data-own-sheets]');
  if (!box) return;
  const paint = async () => {
    let list = [];
    try { list = await listSheets(); } catch (err) { box.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`; return; }
    box.innerHTML = list.length
      ? `<ul class="cb-list">${list.map((s) => `<li data-own-id="${escapeAttr(s.id)}">
          <button type="button" class="cb-unit" data-own-open>${icon('document')} ${escapeHtml(s.title)}</button>
          <span class="own-sheet-row-actions"><span class="hint">${escapeHtml(when(s.modified))}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-own-rename title="Umbenennen">✏️</button>
          <button type="button" class="btn btn-secondary btn-sm" data-own-export title="Als .zlm-Datei sichern">⬇</button>
          <button type="button" class="btn btn-secondary btn-sm" data-own-delete title="Löschen">🗑</button></span></li>`).join('')}</ul>`
      : '<p class="hint">Noch keine eigenen Blätter.</p>';
  };
  await paint();
  if (root.dataset.ownWired) return;
  root.dataset.ownWired = '1';
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    const id = b.closest('[data-own-id]')?.dataset.ownId;
    try {
      if (b.hasAttribute('data-own-new')) {
        const res = await askNew();
        if (!res) return;
        const now = new Date().toISOString();
        const sheet = { id: newId(), title: res.title, pattern: res.pattern, spec: baseSpec(res.title, res.pattern), state: null, created: now, modified: now };
        await putSheet(sheet);
        askPersist();
        await paint();
        await openOwnSheet(sheet.id, { onClose: paint });
      } else if (b.hasAttribute('data-own-open') && id) {
        await openOwnSheet(id, { onClose: paint });
      } else if (b.hasAttribute('data-own-rename') && id) {
        const sheet = await getSheet(id);
        const res = sheet && await askNew({ title: sheet.title, rename: true });
        if (!res) return;
        const spec = structuredClone(sheet.spec);
        const head = spec.content?.find((x) => x?.id === 'own-title');
        if (head) head.text = res.title;
        await putSheet({ ...sheet, title: res.title, spec, modified: new Date().toISOString() });
        await paint();
      } else if (b.hasAttribute('data-own-delete') && id) {
        const sheet = await getSheet(id);
        const ask = `„${sheet?.title || 'Blatt'}“ endgültig löschen? Es gibt keine Sicherung.`;
        if (!(await (window.appConfirm ? window.appConfirm(ask) : Promise.resolve(confirm(ask))))) return;
        await deleteSheet(id);
        await paint();
      } else if (b.hasAttribute('data-own-export') && id) {
        await exportSheet(await getSheet(id));
      } else if (b.hasAttribute('data-own-import')) {
        const sheet = await importSheet();
        if (!sheet) return;
        askPersist();
        await paint();
        toast(`„${sheet.title}“ ist wieder da.`, 'success');
      }
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
  });
}

/** Blatt im Stift-Editor öffnen – Speichern geht in IndexedDB. */
export async function openOwnSheet(id, { onClose = null } = {}) {
  const sheet = await getSheet(id);
  if (!sheet) throw new Error('Das Blatt gibt es auf diesem Gerät nicht mehr.');
  const [{ openInkEditor }, { H5pRenderer }] = await Promise.all([
    import('../../lm-editor/src/ink/ink-editor.js'),
    import('../../lm-editor/src/modules/h5p-renderer.js'),
  ]);
  const renderer = new H5pRenderer({});
  let current = sheet;
  return openInkEditor({
    title: sheet.title,
    key: `own:${sheet.id}`,
    paper: {
      landscape: false,
      ownBlocks: true,
      mount(el) {
        el.appendChild(renderer.createTypePreview('document', { spec: current.spec }, { blockIds: true, quizMode: true, noSolutionToggle: true }));
      },
    },
    store: {
      label: 'nur auf diesem Gerät',
      load: async () => current.state || null,
      async save(state) {
        current = { ...current, state, modified: new Date().toISOString() };
        await putSheet(current);
        return true;
      },
    },
    onClose: () => { onClose?.(); },
  });
}

/** Als .zlm (lm-editor) herunterladen: Grundblatt + Ebene. */
async function exportSheet(sheet) {
  if (!sheet) throw new Error('Das Blatt gibt es nicht mehr.');
  const { createZlm, writeZlm, layerOf } = await import('../../lm-editor/src/zlm/zlm.js');
  const doc = createZlm({ title: sheet.title });
  doc.spec = { titel: sheet.title, ...structuredClone(sheet.spec) };
  if (sheet.state) doc.layers.teacher = layerOf(sheet.state);
  const bytes = writeZlm(doc, { generator: 'LearningModules (eigenes Blatt)' });
  const name = `${(sheet.title || 'Blatt').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.zlm`;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.lm-editor.zlm+zip' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** .zlm wählen → neues eigenes Blatt (oder null). */
function importSheet() {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.zlm' });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        const { readZlm, editorStateOf } = await import('../../lm-editor/src/zlm/zlm.js');
        const doc = readZlm(new Uint8Array(await file.arrayBuffer()));
        const content = Array.isArray(doc.spec?.content) ? doc.spec.content : [];
        const title = doc.manifest?.title || file.name.replace(/\.zlm$/i, '');
        const now = new Date().toISOString();
        const layer = doc.layers?.teacher || Object.values(doc.layers || {})[0] || null;
        const sheet = { id: newId(), title, pattern: 'karo', spec: { content }, state: editorStateOf(layer), created: now, modified: now };
        await putSheet(sheet);
        resolve(sheet);
      } catch (err) { reject(err); }
    };
    input.click();
  });
}
