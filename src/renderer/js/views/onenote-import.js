import { escapeHtml, generateId } from '../utils.js';
import { readCab } from '../cab.js';
import { readOneSection, notebookPlan, sectionModules, jpegsToPdf } from '../onenote.js';
import { nextcloudState } from './nextcloud.js';
import { pdfConvertOptions, convertAttachment } from './attachment-convert.js';

// ==================== ONENOTE ÜBERNEHMEN ====================
//
// Ein exportiertes Notizbuch (.onepkg) oder einzelne Abschnitte (.one)
// werden im Browser gelesen – auf den Server gehen nur die Anhänge und die
// neuen Ordner, Lernthemen und Module. Aufbau: Notizbuch → Book,
// Abschnittsgruppe → Bereich bzw. Abschnitt, OneNote-Abschnitt → Lernthema,
// Seite mit Anlagen → Modul „Anhang“. Siehe docs/onenote-import.md.

const MAX_BYTES = 50 * 1024 * 1024;
const PROGRESS_KEY = 'lm_onenote_import:';

function failed(res) {
  return !res || res.success === false || (res.statusCode && res.statusCode >= 400);
}

const mb = (n) => `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;

/** Fortschritt eines Imports – damit es nach einem Abbruch dort weitergeht. */
function loadProgress(key) {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY + key) || 'null'); } catch (_) { return null; }
}
function saveProgress(key, value) {
  try {
    if (value) localStorage.setItem(PROGRESS_KEY + key, JSON.stringify(value));
    else localStorage.removeItem(PROGRESS_KEY + key);
  } catch (_) { /* ohne Speicher eben ohne Fortsetzen */ }
}

/** Datei lesen: Paket oder Abschnitte → Plan mit gelesenen Abschnitten. */
function readSource(files) {
  const sources = new Map(); // Pfad → () => Bytes
  let title = '';
  for (const { name, bytes } of files) {
    if (/\.onepkg$/i.test(name)) {
      const cab = readCab(bytes);
      for (const f of cab.files) sources.set(f.name, () => cab.extract(f));
      title = name.replace(/\.onepkg$/i, '').replace(/[-_ ]*Notizbuch$/i, '').trim();
    } else if (/\.one$/i.test(name)) {
      sources.set(name, () => bytes);
      if (!title) title = 'OneNote';
    }
  }
  const plan = notebookPlan([...sources.keys()]);
  const sections = [];
  const visit = (node, depth) => {
    for (const s of node.sections) {
      let modules = [];
      let empty = 0;
      let error = '';
      try {
        ({ modules, empty } = sectionModules(readOneSection(sources.get(s.path)()).pages));
      } catch (e) { error = e.message; }
      Object.assign(s, { modules, empty, error, depth });
      sections.push(s);
    }
    for (const g of node.groups) { g.depth = depth; visit(g, depth + 1); }
  };
  visit(plan.root, 0);
  return { title: title || 'OneNote', plan, sections };
}

/** Seitenbilder eines Ausdrucks → PDF (über JPEG, im Browser). */
async function printoutPdf(images) {
  const pages = [];
  for (const img of images) {
    const bitmap = await createImageBitmap(new Blob([img.data()]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    pages.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height });
  }
  return jpegsToPdf(pages);
}

export function openOneNoteImport(app, { onDone } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="import-modules-card onenote-card" role="dialog" aria-modal="true" aria-labelledby="oneNoteTitle">
      <h3 id="oneNoteTitle">🟪 OneNote übernehmen</h3>
      <p class="import-modules-hint">In <strong>OneNote für Windows</strong>: Datei → Exportieren → <em>Notizbuch</em> als
        OneNote-Paket (.onepkg) oder <em>Abschnitt</em> (.one). Übernommen werden Seiten mit Anlagen – je Seite ein
        Modul 📎 Anhang mit ihren PDFs und Dateien. Text und Freihand bleiben in OneNote.
        Bei einem Klassennotizbuch nur Inhaltsbibliothek und „Nur für Lehrer“.</p>
      <div class="import-dialog-file">
        <input type="file" accept=".onepkg,.one" multiple hidden>
        <button type="button" class="btn btn-secondary btn-file">📄 Datei wählen …</button>
        <span class="hint">oder hierher ziehen – .onepkg, .one</span>
      </div>
      <div class="onenote-status" aria-live="polite"></div>
      <div class="onenote-tree"></div>
      <div class="onenote-convert" hidden>
        <label><input type="checkbox" class="on-convert" checked> 📄 PDFs gleich in <strong>Dokumente</strong> umwandeln</label>
        <label class="onenote-convert-mode">Art <select class="on-convert-mode"></select></label>
        <label><input type="checkbox" class="on-keep"> PDF zusätzlich als Anhang behalten</label>
        <span class="hint">Dauert je PDF einige Sekunden (KI-Erkennung länger). Andere Dateien bleiben Anhänge.</span>
      </div>
      <div class="onenote-progress" hidden><progress max="1" value="0"></progress><span class="hint"></span></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-primary btn-run" disabled>✅ Übernehmen</button>
        <button type="button" class="btn btn-secondary btn-cancel">Abbrechen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const card = overlay.querySelector('.onenote-card');
  const input = overlay.querySelector('input[type=file]');
  const status = overlay.querySelector('.onenote-status');
  const tree = overlay.querySelector('.onenote-tree');
  const progress = overlay.querySelector('.onenote-progress');
  const bar = progress.querySelector('progress');
  const barText = progress.querySelector('span');
  const btnRun = overlay.querySelector('.btn-run');
  const btnCancel = overlay.querySelector('.btn-cancel');
  let source = null;
  let key = '';
  // Umwandeln in Dokumente – nur, wenn Konto und Server es können.
  const convertBox = overlay.querySelector('.onenote-convert');
  const convertMode = overlay.querySelector('.on-convert-mode');
  pdfConvertOptions().then((opts) => {
    const ok = opts.allowed ? opts.choices.filter((c) => c.ok) : [];
    if (!ok.length) return;
    convertMode.innerHTML = ok.map((c) => `<option value="${c.mode}" title="${escapeHtml(c.hint)}">${c.label}</option>`).join('');
    convertBox.hidden = false;
  });
  let running = false;
  let closed = false;

  const close = () => {
    closed = true;
    overlay.remove();
    if (running) app.showToast('OneNote-Übernahme läuft im Hintergrund weiter – bitte diesen Tab offen lassen.', 'info');
  };
  btnCancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay && !running) close(); });

  const say = (kind, html) => {
    status.className = `onenote-status${kind ? ` is-${kind}` : ''}`;
    status.innerHTML = html;
  };

  const drawTree = () => {
    const rows = [];
    const visit = (node, depth) => {
      if (node.title) rows.push(`<div class="onenote-row onenote-group" style="--depth:${depth}">📁 ${escapeHtml(node.title)}</div>`);
      for (const s of node.sections) {
        const files = s.modules.reduce((n, m) => n + m.files.length + m.printouts.length, 0);
        const bytes = s.modules.reduce((n, m) => n + m.files.reduce((k, f) => k + f.size, 0), 0);
        const usable = s.modules.length > 0;
        const info = s.error ? `nicht lesbar: ${escapeHtml(s.error)}`
          : usable ? `${s.modules.length} Seite${s.modules.length === 1 ? '' : 'n'} mit Anlagen · ${files} Datei${files === 1 ? '' : 'en'} · ${mb(bytes)}`
            + (s.empty ? ` · ${s.empty} ohne Anlage` : '')
            : 'keine Seite mit Anlagen';
        rows.push(`<label class="onenote-row" style="--depth:${depth + (node.title ? 1 : 0)}">
          <input type="checkbox" data-path="${escapeHtml(s.path)}" ${usable ? 'checked' : 'disabled'}>
          📘 ${escapeHtml(s.title)} <span class="hint">${info}</span></label>`);
      }
      for (const g of node.groups) visit(g, depth + (node.title ? 1 : 0));
    };
    visit(source.plan.root, 0);
    tree.innerHTML = `<div class="onenote-row onenote-book">📚 ${escapeHtml(source.title)}</div>${rows.join('')}`;
    updateRun();
  };
  const updateRun = () => { btnRun.disabled = running || !nextcloudState.ready || !tree.querySelector('input:checked'); };
  tree.addEventListener('change', updateRun);

  const load = async (fileList) => {
    const chosen = [...fileList].filter((f) => /\.(onepkg|one)$/i.test(f.name));
    if (!chosen.length) { say('error', '❌ Bitte eine .onepkg- oder .one-Datei wählen.'); return; }
    say('', 'Wird gelesen …');
    tree.innerHTML = '';
    btnRun.disabled = true;
    await new Promise((r) => setTimeout(r, 30)); // Meldung zeichnen, bevor das Entpacken den Tab beschäftigt
    try {
      const files = [];
      for (const f of chosen) files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      source = readSource(files);
      key = chosen.map((f) => `${f.name}:${f.size}`).join('|');
    } catch (e) {
      say('error', `❌ ${escapeHtml(e.message)}`);
      return;
    }
    if (!source.sections.length) { say('error', '❌ Keine Abschnitte gefunden.'); return; }
    const skipped = source.plan.skipped
      ? ` ${source.plan.skipped} Abschnitt${source.plan.skipped === 1 ? '' : 'e'} aus Schülerbereichen, Platz für Zusammenarbeit und Willkommen werden nicht übernommen.` : '';
    const resume = loadProgress(key);
    say(nextcloudState.ready ? 'ok' : 'error', nextcloudState.ready
      ? `✅ ${source.plan.classNotebook ? 'Klassennotizbuch' : 'Notizbuch'} gelesen.${escapeHtml(skipped)}`
        + (resume ? ' <strong>Eine frühere Übernahme dieser Datei wurde unterbrochen – sie wird fortgesetzt.</strong>' : '')
      : '❌ Anhänge brauchen eine verbundene Nextcloud: im Home-Menü unter ☁️ Nextcloud eine Freigabe eintragen.');
    drawTree();
  };

  overlay.querySelector('.btn-file').addEventListener('click', () => input.click());
  input.addEventListener('change', () => load(input.files));
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('is-drop'); });
  card.addEventListener('dragleave', () => card.classList.remove('is-drop'));
  card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('is-drop'); load(e.dataTransfer.files); });

  btnRun.addEventListener('click', async () => {
    const wanted = new Set([...tree.querySelectorAll('input:checked')].map((x) => x.dataset.path));
    running = true;
    btnRun.disabled = true;
    overlay.querySelectorAll('.onenote-tree input, .onenote-convert input, .onenote-convert select').forEach((x) => { x.disabled = true; });
    progress.hidden = false;
    try {
      const convert = !convertBox.hidden && overlay.querySelector('.on-convert').checked
        ? { mode: convertMode.value, keep: overlay.querySelector('.on-keep').checked } : null;
      const report = await run(app, source, wanted, key, convert, (done, total, text) => {
        bar.max = total || 1;
        bar.value = done;
        barText.textContent = text;
      });
      running = false;
      const notes = report.warnings.length ? ` Hinweise: ${report.warnings.join(' · ')}` : '';
      const docs = report.documents ? `, ${report.documents} Dokumente` : '';
      const msg = `„${source.title}“ übernommen – ${report.topics} Lernthem${report.topics === 1 ? 'a' : 'en'}, ${report.modules} Module${docs}, ${report.files} Dateien.${notes}`;
      app.showToast(msg, report.warnings.length ? 'info' : 'success');
      if (onDone) await onDone(report);
      if (!closed) close();
    } catch (e) {
      running = false;
      const msg = `OneNote-Übernahme unterbrochen: ${e.message} Mit derselben Datei geht es an dieser Stelle weiter.`;
      if (closed) app.showToast(msg, 'error');
      else { say('error', `❌ ${escapeHtml(msg)}`); btnCancel.textContent = 'Schließen'; }
    }
  });
}

/**
 * Die Übernahme selbst. Was schon angelegt ist, steht in `localStorage`
 * (Schlüssel: Dateiname und -größe); ein zweiter Lauf überspringt es.
 */
async function run(app, source, wanted, key, convert, onProgress) {
  const api = app.api;
  const state = loadProgress(key) || { bookId: null, nodes: {}, topics: {}, modules: {} };
  const report = { topics: 0, modules: 0, files: 0, documents: 0, warnings: [] };
  const save = () => saveProgress(key, state);
  const check = (res, what) => {
    if (failed(res)) throw new Error(`${what}: ${res?.message || 'Der Server antwortet nicht.'}`);
    return res;
  };
  const sections = source.sections.filter((s) => wanted.has(s.path) && s.modules.length);
  const total = sections.reduce((n, s) => n + s.modules.length, 0);
  let done = 0;

  // Gibt es das Book der früheren Übernahme noch? Sonst von vorn.
  if (state.bookId) {
    const tree = await api.getNotebooks().catch(() => null);
    const nodes = tree?.nodes || [];
    if (!nodes.some((n) => n.id === state.bookId)) Object.assign(state, { bookId: null, nodes: {}, topics: {}, modules: {} });
  }
  if (!state.bookId) {
    state.bookId = check(await api.createNotebookNode('book', source.title, null), 'Book anlegen').id;
    save();
  }

  /** Ordner für eine Abschnittsgruppe: mit Untergruppen ein Bereich, sonst ein Abschnitt. */
  const nodeFor = async (path) => {
    if (!path) return state.bookId;
    if (state.nodes[path]) return state.nodes[path];
    const parentPath = path.split('/').slice(0, -1).join('/');
    const parentId = await nodeFor(parentPath);
    const group = findGroup(source.plan.root, path);
    const kind = group && group.groups.length ? 'area' : 'section';
    state.nodes[path] = check(await api.createNotebookNode(kind, group ? group.title : path, parentId), 'Ordner anlegen').id;
    save();
    return state.nodes[path];
  };

  for (const section of sections) {
    const groupPath = section.path.split('/').slice(0, -1).join('/');
    const nodeId = await nodeFor(groupPath);
    let topicId = state.topics[section.path];
    if (!topicId) {
      onProgress(done, total, `Lernthema „${section.title}“ …`);
      topicId = check(await api.saveTopic({ title: section.title, description: 'Aus OneNote übernommen.' }), 'Lernthema anlegen').id;
      check(await api.moveInNotebook('topic', topicId, nodeId, null), 'Lernthema einordnen');
      state.topics[section.path] = topicId;
      save();
      report.topics++;
    }
    // Die Seiten dieses Abschnitts, die schon Module sind, kommen nicht doppelt.
    const already = state.modules[section.path] || 0;
    for (const [i, mod] of section.modules.entries()) {
      if (i < already) { done++; continue; }
      onProgress(done, total, `${section.title}: ${mod.title}`);
      const files = [];
      const upload = async (name, data, type) => {
        if (data.length > MAX_BYTES) { report.warnings.push(`${name} ist größer als 50 MB`); return; }
        const res = await api.uploadNextcloudAttachment(new File([data], name, { type }), topicId);
        check(res, `${name} hochladen`);
        files.push({ url: res.url, name: res.name, size: res.size, type: res.type });
        report.files++;
      };
      for (const f of mod.files) await upload(f.name, f.data(), f.kind.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? 'application/pdf' : 'application/octet-stream');
      for (const p of mod.printouts) {
        try {
          await upload(p.name, await printoutPdf(p.images), 'application/pdf');
        } catch (e) {
          if (/hochladen/.test(e.message)) throw e;
          report.warnings.push(`Ausdruck ${p.name} ließ sich nicht als PDF zusammensetzen`);
        }
      }
      let moduleId = null;
      if (files.length) {
        const now = new Date().toISOString();
        moduleId = check(await api.saveModule(topicId, {
          id: generateId(), title: mod.title, type: 'attachment', description: '',
          content: { files }, moduleSelected: true, createdAt: now, updatedAt: now,
        }), `Modul „${mod.title}“ speichern`).id;
        report.modules++;
      }
      // Ab hier zählt die Seite als übernommen – ein Abbruch beim Umwandeln legt sie nicht doppelt an.
      state.modules[section.path] = i + 1;
      save();
      if (convert && moduleId && files.some((f) => f.type === 'application/pdf')) {
        onProgress(done, total, `${section.title}: ${mod.title} – wird in ein Dokument umgewandelt …`);
        try {
          const r = await convertAttachment(api, topicId, moduleId, { mode: convert.mode, keep: convert.keep });
          report.documents += r.created.length;
          report.warnings.push(...r.failed.map((f) => `nicht umgewandelt: ${f}`));
        } catch (e) {
          report.warnings.push(`${mod.title}: nicht umgewandelt (${e.message})`);
        }
      }
      done++;
    }
  }
  onProgress(total, total, 'Fertig.');
  saveProgress(key, null);
  return report;
}

function findGroup(node, path) {
  for (const g of node.groups) {
    if (g.path === path) return g;
    const inner = findGroup(g, path);
    if (inner) return inner;
  }
  return null;
}
