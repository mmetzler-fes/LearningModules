import { escapeHtml, generateId } from '../utils.js';
import { htmlToDocSpec } from '../../lm-editor/src/doc/docspec-html.js';

// ==================== ANHANG → DOKUMENT ====================
//
// PDFs eines Moduls „Anhang“ in Dokumente umwandeln – für einzelne oder
// mehrere Module (Notebook-Ansicht) und beim OneNote-Import. Läuft über die
// vorhandenen Wege: PDF aus der Nextcloud holen, „PDF übernehmen“
// (POST /api/worksheets/import-pdf), Dokument speichern. Je PDF ein
// Dokument direkt hinter dem Anhang; Dateien, die keine PDFs sind, bleiben
// im Anhang. Siehe docs/anhang.md.

const failed = (res) => !res || res.success === false || (res.statusCode && res.statusCode >= 400);
const token = () => sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token') || '';

export const isPdfFile = (f) => !!f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));

function contentOf(mod) {
  let c = mod?.content || {};
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch (_) { c = {}; } }
  return c;
}

/** Hat das Modul PDFs zum Umwandeln? */
export function hasConvertiblePdf(mod) {
  return mod?.type === 'attachment' && (contentOf(mod).files || []).some(isPdfFile);
}

/** Welche Wege dieser Server und dieses Konto bieten (GET /api/worksheets/status). */
export async function pdfConvertOptions() {
  const info = await fetch('/api/worksheets/status', { headers: { Authorization: `Bearer ${token()}` } })
    .then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return {
    allowed: !!info.pdfImport,
    choices: [
      { mode: 'text', label: '📝 Text mit Struktur', hint: 'Überschriften, Absätze, Listen, Tabellen, Bilder – zum Weiterbearbeiten.', ok: !!info.configured },
      { mode: 'pages', label: '🖼 Seiten als Bilder', hint: 'Sieht genau aus wie das PDF, lässt sich aber nicht bearbeiten – Stift geht trotzdem.', ok: !!info.configured },
      { mode: 'ai', label: '🤖 KI-Erkennung', hint: 'Besser bei Tabellen, Spalten und Scans, dafür langsamer.', ok: !!info.pdfAi?.ok },
    ],
    ocr: !!info.pdfAi?.ok,
    // Schaubilder als .odg: Renderer (LibreOffice) und eine verbundene Nextcloud.
    figures: !!info.configured && !!window.appNextcloud?.ready,
  };
}

/**
 * Dialog: Art der Umwandlung und ob der Anhang bleibt. Ergebnis
 * `{ mode, ocr, keep }` oder null. `count`: wie viele PDFs es sind.
 */
export async function askConvertOptions({ count = 1, keepDefault = false, keepOption = true, heading = '📄 In Dokument umwandeln', intro = null } = {}) {
  const opts = await pdfConvertOptions();
  if (!opts.allowed) throw new Error('PDFs übernehmen ist für dein Konto nicht freigeschaltet (Administration → Benutzer: „PDF-Import“).');
  if (!opts.choices.some((c) => c.ok)) throw new Error('Für PDFs ist auf diesem Server kein Dienst eingerichtet (Renderer bzw. pdf-ai).');
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<div class="import-modules-card ds-pdf-dialog">
        <h3>${escapeHtml(heading)}</h3>
        <p class="hint">${escapeHtml(intro || `${count === 1 ? 'Das PDF wird' : `${count} PDFs werden`} zu Dokumenten – je PDF eins, direkt hinter dem Anhang.`)}</p>
        <div class="ds-pdf-choices">${opts.choices.map((c) => `
          <button type="button" class="btn btn-secondary ds-pdf-choice" data-mode="${c.mode}" ${c.ok ? '' : 'disabled'}>
            <strong>${c.label}</strong><small>${escapeHtml(c.ok ? c.hint : 'Auf diesem Server nicht eingerichtet.')}</small>
          </button>`).join('')}</div>
        ${opts.ocr ? '<label class="ds-pdf-ocr"><input type="checkbox" class="cv-ocr"> Gescannte PDFs – Text erkennen (OCR, nur KI-Erkennung)</label>' : ''}
        ${opts.figures ? `<label class="ds-pdf-ocr" title="Jedes Schaubild (Pfeile, Kästen, Beschriftungen) zusätzlich als gruppierte Zeichnung in die Nextcloud – mit „🖍 In Draw bearbeiten“ einzeln änderbar. Dauert je Folie mit Schaubild ein, zwei Sekunden.">
            <input type="checkbox" class="cv-figures"> 🖍 Schaubilder als bearbeitbare Zeichnung (.odg, gruppiert) – langsamer, nur bei „Text mit Struktur“</label>` : ''}
        ${keepOption ? `<label class="ds-pdf-ocr"><input type="checkbox" class="cv-keep" ${keepDefault ? 'checked' : ''}> PDF-Anhang zusätzlich behalten</label>` : ''}
        <p class="hint">Danach die Dokumente prüfen: Formeln, Karos und Lösungsfelder erkennt die Umwandlung nur ungefähr.</p>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary cv-cancel">Abbrechen</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('.cv-cancel').addEventListener('click', () => done(null));
    overlay.querySelectorAll('.ds-pdf-choice').forEach((b) => b.addEventListener('click', () => done({
      mode: b.dataset.mode,
      ocr: !!overlay.querySelector('.cv-ocr')?.checked,
      keep: !!overlay.querySelector('.cv-keep')?.checked,
      figures: b.dataset.mode === 'text' && !!overlay.querySelector('.cv-figures')?.checked,
    })));
  });
}

/**
 * Fortschritt eines PDF-Imports als Fenster – damit ein langer Import nicht
 * wie ein Absturz aussieht: Schritt, Balken (bei Schaubildern je Folie),
 * laufende Zeit.
 */
function progressWindow(name) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `<div class="import-modules-card pdf-progress" role="status" aria-live="polite">
      <h3>📄 ${escapeHtml(name || 'PDF')}</h3>
      <div class="pdf-progress-bar indeterminate"><div class="pdf-progress-fill"></div></div>
      <p class="pdf-progress-msg">Wird hochgeladen …</p>
      <p class="hint pdf-progress-time"></p>
    </div>`;
  document.body.appendChild(overlay);
  const started = Date.now();
  const time = overlay.querySelector('.pdf-progress-time');
  const tick = () => {
    const s = Math.round((Date.now() - started) / 1000);
    time.textContent = `läuft seit ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  return {
    update(job) {
      const bar = overlay.querySelector('.pdf-progress-bar');
      bar.classList.toggle('indeterminate', !(job.total > 0));
      if (job.total > 0) overlay.querySelector('.pdf-progress-fill').style.width = `${Math.round((job.done / job.total) * 100)}%`;
      overlay.querySelector('.pdf-progress-msg').textContent = job.message || '';
    },
    close() { clearInterval(timer); overlay.remove(); },
  };
}

/**
 * PDF (Bytes oder Link) über den Renderer bzw. pdf-ai in ein Dokument (spec) –
 * als Auftrag mit Fortschrittsfenster. `figures` + `topicId`: Schaubilder als
 * gruppierte .odg in die Nextcloud (docs/dokumente.md).
 */
export async function pdfToSpec(pdf, name, { mode, ocr, positions = false, figures = false, topicId = null }) {
  const blob = pdf instanceof Blob ? pdf : new Blob([pdf], { type: 'application/pdf' });
  if (!positions) return pdfJob(blob, name, { mode, ocr, figures, topicId });
  const form = new FormData();
  form.append('file', blob, name || 'blatt.pdf');
  form.append('mode', mode);
  if (ocr) form.append('ocr', 'true');
  // Lage je Baustein im PDF (`_pos`) – nur für den .xopp-Import (xopp-import.js).
  if (positions) form.append('positions', 'true');
  const res = await fetch('/api/worksheets/import-pdf', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.spec) throw new Error(data.message || `HTTP ${res.status}`);
  return { spec: data.spec, warnings: data.warnings || [], title: data.title || '' };
}

async function pdfJob(blob, name, { mode, ocr, figures, topicId }) {
  const win = progressWindow(name);
  try {
    const form = new FormData();
    form.append('file', blob, name || 'blatt.pdf');
    form.append('mode', mode);
    if (ocr) form.append('ocr', 'true');
    if (figures) form.append('figures', 'true');
    if (topicId) form.append('topicId', topicId);
    const headers = { Authorization: `Bearer ${token()}` };
    const res = await fetch('/api/worksheets/import-pdf-job', { method: 'POST', headers, body: form });
    const started = await res.json().catch(() => ({}));
    if (!res.ok || !started.id) throw new Error(started.message || `HTTP ${res.status}`);
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const job = await fetch(`/api/worksheets/import-pdf-job/${encodeURIComponent(started.id)}`, { headers })
        .then((r) => r.json()).catch(() => null);
      if (!job || job.statusCode >= 400) throw new Error(job?.message || 'Der Import ist nicht mehr zu finden.');
      win.update(job);
      if (job.state === 'failed') throw new Error(job.error || 'Der Import ist gescheitert.');
      if (job.state === 'done') {
        const r = job.result || {};
        if (!r.spec) throw new Error('Der Import lieferte kein Dokument.');
        return { spec: r.spec, warnings: r.warnings || [], title: r.title || '' };
      }
    }
  } finally {
    win.close();
  }
}

/** Datei wählen; null bei Abbruch. Muss im Klick starten (iPad), daher ohne await davor. */
function chooseFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * „PDF einfügen“ (Dokument-Editor, ⊕ im Stift-Editor): PDF wählen, Art der
 * Umwandlung fragen, umwandeln. Ergebnis: `{ blocks, warnings, name }` oder
 * null bei Abbruch. `onBusy(text)`: Hinweis, solange umgewandelt wird.
 */
export async function pickPdfBlocks({ onBusy = null, topicId = null } = {}) {
  const file = await chooseFile('.pdf,application/pdf');
  if (!file) return null;
  if (!isPdfFile(file)) throw new Error('Das ist kein PDF.');
  const choice = await askConvertOptions({
    keepOption: false, heading: '📄 PDF einfügen',
    intro: `„${file.name}“ wird umgewandelt und an dieser Stelle ins Dokument eingefügt.`,
  });
  if (!choice) return null;
  onBusy?.(choice.mode === 'ai' ? 'KI-Erkennung läuft – das kann je Seite einige Sekunden dauern …' : 'PDF wird umgewandelt …');
  const { spec, warnings } = await pdfToSpec(file, file.name, { ...choice, topicId });
  const blocks = Array.isArray(spec?.content) ? spec.content : [];
  if (!blocks.length) throw new Error('Im PDF wurde nichts gefunden.');
  return { blocks, warnings, name: file.name };
}

const rootOrder =(modules, skip = new Set()) => (Array.isArray(modules) ? modules : [])
  .filter((m) => !m.parentId && !skip.has(m.id))
  .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0))
  .map((m) => m.id);

/** Writer, Word und PDF – was der Import als Dokument annimmt. */
export const DOCUMENT_EXTS = ['odt', 'docx', 'doc', 'rtf'];
export const isDocumentFile = (f, pdf = true) => {
  const ext = (/\.([a-z0-9]+)$/i.exec(f?.name || '')?.[1] || '').toLowerCase();
  return DOCUMENT_EXTS.includes(ext) || (pdf && ext === 'pdf');
};

/**
 * Datei → Dokument (spec): .odt direkt, .docx/.doc/.rtf über LibreOffice
 * (POST /api/interchange/odt-to-html), .pdf über den Renderer bzw. pdf-ai
 * (`pdf`: { mode, ocr }). Ergebnis: `{ spec, title, warnings }`.
 */
export async function fileToSpec(file, { pdf = null, topicId = null } = {}) {
  const base = file.name.replace(/\.[^.]+$/, '');
  if (/\.pdf$/i.test(file.name)) {
    if (!pdf) throw new Error('Für PDFs fehlt die Art der Umwandlung.');
    const r = await pdfToSpec(file, file.name, { ...pdf, topicId });
    return { spec: r.spec, title: base, warnings: r.warnings };
  }
  const form = new FormData();
  form.append('file', file);
  // Mit Lernthema: Zeichnungen landen als .odg + .svg in seinem Nextcloud-Ordner.
  if (topicId) form.append('topicId', topicId);
  const res = await fetch('/api/interchange/odt-to-html', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
  const { spec, warnings } = htmlToDocSpec(data.html);
  return { spec, title: data.title || base, warnings: [...(data.warnings || []), ...warnings] };
}

/**
 * Ein Anhang-Modul umwandeln (Inhalt und Reihenfolge holt es frisch vom
 * Server). Ergebnis: `{ created, warnings, failed, removed }`.
 */
export async function convertAttachment(api, topicId, moduleId, { mode, ocr = false, keep = false, figures = false }) {
  const modules = await api.getTopicModules(topicId);
  const mod = Array.isArray(modules) ? modules.find((m) => m.id === moduleId) : null;
  if (!mod || mod.type !== 'attachment') throw new Error('Anhang nicht gefunden.');
  const content = contentOf(mod);
  const files = content.files || [];
  const pdfs = files.filter(isPdfFile);
  const created = [];
  const warnings = [];
  const failures = [];
  const converted = new Set();
  for (const f of pdfs) {
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`PDF nicht abrufbar (HTTP ${res.status})`);
      const { spec, warnings: w } = await pdfToSpec(await res.blob(), f.name, { mode, ocr, figures, topicId });
      const title = pdfs.length > 1 ? `${mod.title} – ${f.name.replace(/\.pdf$/i, '')}` : mod.title;
      const now = new Date().toISOString();
      const saved = await api.saveModule(topicId, {
        id: generateId(), type: 'document', title, description: mod.description || '',
        content: { kind: 'arbeitsblatt', spec },
        tagIds: mod.tagIds || [], moduleSelected: mod.moduleSelected !== false, createdAt: now, updatedAt: now,
      });
      if (failed(saved)) throw new Error(saved?.message || 'Speichern fehlgeschlagen');
      created.push(saved.id);
      converted.add(f.url);
      warnings.push(...w.map((x) => `${f.name}: ${x}`));
    } catch (err) {
      failures.push(`${f.name}: ${err.message}`);
    }
  }
  // Anhang: ganz weg, nur noch die übrigen Dateien – oder unverändert.
  let removed = false;
  const rest = files.filter((f) => !converted.has(f.url));
  if (!keep && converted.size) {
    if (rest.length) {
      await api.saveModule(topicId, { ...mod, content: { ...content, files: rest }, updatedAt: new Date().toISOString() });
    } else {
      const res = await api.deleteModule(topicId, mod.id);
      removed = !failed(res);
    }
  }
  // Die Dokumente stehen dort, wo der Anhang stand.
  if (created.length) {
    const before = rootOrder(modules);
    const at = before.indexOf(mod.id);
    const ids = rootOrder(await api.getTopicModules(topicId), new Set(created));
    const pos = at < 0 ? ids.length : removed ? at : at + 1;
    ids.splice(Math.min(pos, ids.length), 0, ...created);
    await api.reorderModules(topicId, ids);
  }
  return { created, warnings, failed: failures, removed };
}
