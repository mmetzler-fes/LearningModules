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
    })));
  });
}

/** PDF (Bytes oder Link) über den Renderer bzw. pdf-ai in ein Dokument (spec). */
export async function pdfToSpec(pdf, name, { mode, ocr }) {
  const blob = pdf instanceof Blob ? pdf : new Blob([pdf], { type: 'application/pdf' });
  const form = new FormData();
  form.append('file', blob, name || 'blatt.pdf');
  form.append('mode', mode);
  if (ocr) form.append('ocr', 'true');
  const res = await fetch('/api/worksheets/import-pdf', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.spec) throw new Error(data.message || `HTTP ${res.status}`);
  return { spec: data.spec, warnings: data.warnings || [] };
}

const rootOrder = (modules, skip = new Set()) => (Array.isArray(modules) ? modules : [])
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
    const r = await pdfToSpec(file, file.name, pdf);
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
export async function convertAttachment(api, topicId, moduleId, { mode, ocr = false, keep = false }) {
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
      const { spec, warnings: w } = await pdfToSpec(await res.blob(), f.name, { mode, ocr });
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
