/**
 * Editor für den Modultyp „Dokument“ (Feld `docspec` in content-editors.js).
 *
 * Links die Spec als YAML, rechts die Web-Ansicht, darüber der Druck über den
 * Renderer (.odt/.pdf, auch Lösungsblatt). Gespeichert wird JSON: Der
 * versteckte Input hält immer den letzten lesbaren Stand – ein Tippfehler im
 * YAML macht das Modul also nicht leer.
 *
 * content-editors.js ist ein klassisches Skript; dieses Modul hängt sich
 * deshalb an window.DocSpecEditor.
 */
import { load as yamlLoad, dump as yamlDump } from './vendor/js-yaml.js';
import { validateDocSpec, renderDocSpecHtml, docRefSlugs, KARO_MAX_WIDTH_CM } from '../lm-editor/src/doc/docspec.js';
import { downloadBlob } from './api.js';
import { escapeHtml } from './utils.js';
import { htmlToDocSpec, specToEditorHtml, widgetHtml } from '../lm-editor/src/doc/docspec-html.js';
import { ensureBlockIds, stampBlockIds } from '../lm-editor/src/doc/ids.js';
import { newlineIndent, shiftLines, reindentPaste, insertAfterItem } from './yaml-edit.js';
import { pickQuiz as pickQuizFrom } from './quiz-picker.js';
import { pickPdfBlocks } from './views/attachment-convert.js';
import { showContextMenu } from '../lm-editor/src/util/dom.js';
import { attachTableTools } from './table-tools.js';
import { attachFormatTools } from './format-tools.js';
import { openParagraphDialog } from './paragraph-dialog.js';
import { objectEntries, objectName, copyText } from './object-actions.js';

/** Startinhalt eines neuen Dokuments – zeigt das Format an einem Beispiel. */
const STARTER = `content:
  - type: section
    text: Worum es geht
  - type: text
    text: Kurze Einführung in das Thema.
  - type: task
    title: Erste Aufgabe
    text: Aufgabenstellung
    blocks:
      - type: karo
        lines: 4
      - type: solution
        blocks:
          - type: text
            text: Musterlösung
`;

const OUTPUTS = [
  { output: 'pdf', label: '🖨 PDF', title: 'Arbeitsblatt als PDF öffnen' },
  { output: 'odt', label: '⬇ .odt', title: 'Arbeitsblatt für LibreOffice Writer' },
  { output: 'loesung_pdf', label: '🖨 Lösung', title: 'Lösungsblatt als PDF öffnen' },
  { output: 'loesung', label: '⬇ Lösung .odt', title: 'Lösungsblatt für LibreOffice Writer' },
];

/** Welches Modul gerade bearbeitet wird – setzt app.js (useModuleSource). */
let moduleSource = () => null;
export function useModuleSource(fn) {
  moduleSource = fn;
}

/** Lernthema, in dem das Dokument liegt – Zeichnungen aus .odt landen in seinem Nextcloud-Ordner (app.js). */
let topicSource = () => null;
export function useTopicSource(fn) {
  topicSource = fn;
}

/** ID des Dokuments – auch eines neuen, noch nicht gespeicherten (app.js); für die Beschriftung aus .xopp. */
let documentId = () => null;
export function useDocumentId(fn) {
  documentId = fn;
}

/** Module des Lernthemas, in dem das Dokument liegt – für „Quiz einfügen“ (app.js). */
let topicModules = () => [];
export function useTopicModules(fn) {
  topicModules = fn;
}

function token() {
  return sessionStorage.getItem('lm_token') || localStorage.getItem('lm_token');
}

function toYaml(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.content)) return STARTER;
  return yamlDump(value, { lineWidth: -1, noRefs: true });
}

export function mountDocSpecEditor(parent, { name, label, value }) {
  const root = document.createElement('div');
  root.className = 'form-group ds-editor';
  root.innerHTML = `
    <label>${escapeHtml(label || 'Inhalt')} <span class="hint">– Format: Blöcke wie im Arbeitsblatt-Generator</span></label>
    <div class="ds-editor-bar">
      <button type="button" class="btn btn-secondary btn-sm ds-print-menu" title="Arbeitsblatt oder Lösungsblatt als PDF oder .odt">🖨 Drucken ▾</button>
      <label class="ds-editor-toggle"><input type="checkbox" class="ds-show-solutions"> Lösungen zeigen</label>
      <button type="button" class="btn btn-secondary btn-sm ds-import-odt" title="Writer- oder Word-Dokument (.odt, .docx) übernehmen: Überschriften, Absätze, Listen, Tabellen, Bilder">📄 Übernehmen…</button>
      <span class="ds-editor-status hint"></span>
    </div>
    <div class="ds-editor-header hint" hidden></div>
    <div class="ds-editor-panes">
      <div class="ds-editor-left">
        <div class="ds-mode admin-tabs">
          <button type="button" class="admin-tab" data-mode="visual">✏️ Bearbeiten</button>
          <button type="button" class="admin-tab" data-mode="yaml">⌨ YAML</button>
        </div>
        <div class="ds-visual" hidden>
          <div class="ds-vtoolbar rich-text-toolbar">
            <button type="button" class="rt-btn ds-vplus" title="Einfügen: Quiz, Schreibfeld, Lösung, Formel, Bild … (auch Rechtsklick in den Text)">➕</button>
            <select class="ds-vblock" title="Absatzart">
              <option value="p">Text</option>
              <optgroup label="Mit Nummer"><option value="section">§ Abschnitt (1.)</option><option value="task">Aufgabe (1.1)</option><option value="subtask">Teilaufgabe (1.1.1)</option></optgroup>
              <optgroup label="Ohne Nummer"><option value="heading">Überschrift 1</option><option value="heading2">Überschrift 2</option><option value="heading3">Überschrift 3</option></optgroup>
              <optgroup label="Liste"><option value="ul">• Aufzählung</option><option value="ol">1. Nummerierung</option></optgroup>
              <option value="note">Hinweis</option>
            </select>
            ${[['bold', '<b>F</b>', 'Fett'], ['italic', '<i>K</i>', 'Kursiv'], ['underline', '<u>U</u>', 'Unterstrichen'], ['strikeThrough', '<s>D</s>', 'Durchgestrichen'],
              ['superscript', 'x²', 'Hochgestellt'], ['subscript', 'x₂', 'Tiefgestellt']]
              .map(([cmd, label, title]) => `<button type="button" class="rt-btn" data-cmd="${cmd}" title="${title}">${label}</button>`).join('')}
            <span class="ds-tb-sep"></span>
            ${[['color', '<span class="ds-dd-a">A</span>', 'Textfarbe'], ['hl', '🖍', 'Hervorheben'], ['align', '≡', 'Ausrichtung (auch Blocksatz)'],
              ['lh', '↕≡', 'Zeilenabstand'], ['ul', '•≡', 'Aufzählung: Punkt, Strich, Pfeil, Quadrat, Checkliste'], ['ol', '1≡', 'Nummerierung: 1. / a) / i.']]
              .map(([dd, label, title]) => `<button type="button" class="rt-btn ds-dd" data-dd="${dd}" title="${title}">${label}<span class="ds-dd-caret">▾</span></button>`).join('')}
            <button type="button" class="rt-btn" data-fmt="outdent" title="Einzug verkleinern">⇤|</button>
            <button type="button" class="rt-btn" data-fmt="indent" title="Einzug vergrößern">|⇥</button>
            <span class="ds-tb-sep"></span>
            <button type="button" class="rt-btn" data-cmd="createLink" title="Link">🔗</button>
            <button type="button" class="rt-btn" data-fmt="clear" title="Formatierung löschen (fett, Farbe … der Auswahl)">T̸</button>
            <span class="ds-tb-sep"></span>
            <button type="button" class="rt-btn ds-para-btn" title="Absatz: Abstand vor/nach, Einzug, Zeilenabstand, Ausrichtung">¶ Absatz …</button>
            <button type="button" class="rt-btn ds-table-btn" title="Zeile, Spalte, Zelle, Tabelle" hidden>▤ Tabelle<span class="ds-dd-caret">▾</span></button>
            <div class="ds-tablebar-slot"></div>
          </div>
          <div class="ds-surface worksheet-content" contenteditable="true" spellcheck="true" aria-label="Inhalt bearbeiten"></div>
          <p class="hint">➕ oder Rechtsklick fügt ein (Umschalt+Rechtsklick: Menü des Browsers). Bausteine (grau) per Doppelklick bearbeiten. Lösungen folgen auf ein Karo und erscheinen im Lösungsblatt darüber.</p>
        </div>
        <div class="ds-ybar" hidden>
          <select class="ds-yinsert" title="Baustein hinter dem Block einfügen, in dem die Schreibmarke steht">
            <option value="">➕ Einfügen …</option><option value="karo">Schreibfeld (Karo, Linien)</option><option value="quiz">🧩 Quiz aus dem Lernthema</option><option value="solution">Lösung</option>
            <option value="formula">Formel</option><option value="code">Code</option><option value="table">Tabelle</option>
            <option value="box">Kasten</option><option value="spacer">Platz (unsichtbar)</option><option value="pagebreak">Seitenumbruch</option>
          </select>
          <span class="hint">Enter rückt passend ein, Tab / Umschalt+Tab rücken markierte Zeilen, eingefügter Text passt sich der Einrückung an.</span>
        </div>
        <textarea class="ds-yaml" spellcheck="false" aria-label="Inhalt als YAML"></textarea>
      </div>
      <div class="ds-preview module-description-content"></div>
    </div>
    <div class="ds-editor-errors" role="status"></div>
    <input type="hidden" name="${escapeHtml(name)}">`;
  parent.appendChild(root);

  const textarea = root.querySelector('.ds-yaml');
  const preview = root.querySelector('.ds-preview');
  const errorsEl = root.querySelector('.ds-editor-errors');
  const hidden = root.querySelector('input[type="hidden"]');
  const status = root.querySelector('.ds-editor-status');
  const showSolutions = root.querySelector('.ds-show-solutions');
  const headerEl = root.querySelector('.ds-editor-header');
  const titleInput = document.getElementById('moduleTitle');
  const moduleId = moduleSource();

  // Platz im Notebook: Nummer, Kopfzeile, Verweisziele (nur für gespeicherte Module).
  let ctx = null;
  const loadContext = async () => {
    if (!moduleId) return;
    try {
      const res = await fetch('/api/worksheets/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: JSON.stringify({ moduleId, title: titleInput?.value.trim() || '' }),
      });
      if (!res.ok) return;
      ctx = await res.json();
      headerEl.hidden = false;
      headerEl.textContent = `Kopfzeile im Druck: ${ctx.header}`;
      update();
    } catch (_) { /* ohne Kontext bleibt die Vorschau ohne Nummern */ }
  };
  let titleTimer = null;
  titleInput?.addEventListener('input', () => { clearTimeout(titleTimer); titleTimer = setTimeout(loadContext, 600); });

  let spec = null;
  // Beispielinhalt eines neuen Dokuments, wie er im Feld steht (mit IDs) – noch unberührt?
  let starterYaml = STARTER;
  const update = () => {
    let parsed;
    try {
      parsed = yamlLoad(textarea.value) ?? { content: [] };
    } catch (err) {
      const where = err.mark ? `Zeile ${err.mark.line + 1}: ` : '';
      errorsEl.innerHTML = `<p class="ds-error">⚠️ YAML ${escapeHtml(where + (err.reason || err.message))}</p>`;
      return; // Vorschau und gespeicherter Stand bleiben beim letzten lesbaren.
    }
    spec = parsed;
    // Feste Block-IDs – an ihnen hängen die Striche der Schüler. Neue Blöcke
    // bekommen ihre ID ins YAML, sobald dort niemand tippt (sonst beim Verlassen).
    if (document.activeElement !== textarea && ensureBlockIds(spec)) textarea.value = toYaml(spec);
    hidden.value = JSON.stringify(spec);
    const errors = validateDocSpec(spec);
    const missing = ctx?.refs ? docRefSlugs(spec).filter((s) => !ctx.refs[s]) : [];
    errorsEl.innerHTML = errors.map((e) => `<p class="ds-error">⚠️ ${escapeHtml(e)}</p>`).join('')
      + (missing.length ? `<p class="ds-error">⚠️ Verweis auf fehlende Blätter: ${escapeHtml(missing.join(', '))}</p>` : '');
    preview.innerHTML = renderDocSpecHtml(spec, { showSolutions: showSolutions.checked, showPageBreaks: true, refs: ctx?.refs || undefined });
  };

  let timer = null;
  textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 250); });
  textarea.addEventListener('blur', () => { clearTimeout(timer); update(); });
  // YAML lebt von Einrückung (yaml-edit.js): Tab rückt ein statt das Feld
  // zu verlassen, Enter übernimmt die Einrückung, Eingefügtes passt sich an.
  const replaceYaml = (text, start, end = start) => {
    textarea.value = text;
    textarea.setSelectionRange(start, end);
    textarea.dispatchEvent(new Event('input'));
  };
  textarea.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const { selectionStart: a, selectionEnd: b, value } = textarea;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (a === b && !e.shiftKey) {
        textarea.setRangeText('  ', a, b, 'end');
        textarea.dispatchEvent(new Event('input'));
        return;
      }
      const res = shiftLines(value, a, b, e.shiftKey ? -1 : 1);
      replaceYaml(res.text, a === b ? Math.max(res.start, a - 2) : res.start, a === b ? Math.max(res.start, a - 2) : res.end);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const line = value.slice(value.lastIndexOf('\n', a - 1) + 1, a);
      textarea.setRangeText(`\n${newlineIndent(line)}`, a, b, 'end');
      textarea.dispatchEvent(new Event('input'));
    }
  });
  textarea.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    const a = textarea.selectionStart;
    const before = textarea.value.slice(textarea.value.lastIndexOf('\n', a - 1) + 1, a);
    if (!text.includes('\n') || before.trim()) return;
    e.preventDefault();
    textarea.setRangeText(reindentPaste(text, before.length), a, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input'));
  });
  root.querySelector('.ds-yinsert').addEventListener('change', async (e) => {
    const what = e.target.value;
    e.target.value = '';
    if (!what) return;
    const pos = textarea.selectionStart;
    const blocks = what === 'pdf' ? await insertPdfBlocks() : [what === 'quiz' ? await pickQuiz() : STARTERS[what]];
    if (!blocks?.[0]) return;
    const item = yamlDump(blocks, { lineWidth: -1, noRefs: true });
    const res = insertAfterItem(textarea.value, pos, item);
    if (res) { replaceYaml(res.text, res.pos); textarea.focus(); return; }
    let current;
    try { current = yamlLoad(textarea.value) ?? {}; } catch (_) { status.textContent = 'Erst den YAML-Fehler beheben, dann einfügen.'; return; }
    if (!Array.isArray(current.content)) current.content = [];
    current.content.push(...blocks);
    replaceYaml(toYaml(current), 0);
  });
  showSolutions.addEventListener('change', update);

  /** Übernommenes Dokument einsetzen – in beiden Reitern sichtbar. */
  const applyImported = (imported, title, warnings) => {
    textarea.value = toYaml(imported);
    if (titleInput && !titleInput.value.trim()) titleInput.value = title || '';
    update();
    if (mode === 'visual') setSurface(specToEditorHtml(spec || { content: [] }));
    status.innerHTML = `✅ Übernommen: ${imported.content.length} Blöcke.` + (warnings.length ? ` ${warnings.map((w) => `⚠️ ${escapeHtml(w)}`).join(' ')}` : '');
  };

  /** Darf dieses Konto PDFs übernehmen (Freischaltung 'pdfImport')? Bestimmt Knopf und Dateiauswahl. */
  const workerStatus = () => fetch('/api/worksheets/status', { headers: token() ? { Authorization: `Bearer ${token()}` } : {} }).then((r) => r.json()).catch(() => ({}));
  const importButton = root.querySelector('.ds-import-odt');
  let pdfAllowed = false;
  workerStatus().then((info) => {
    pdfAllowed = !!info.pdfImport;
    if (pdfAllowed) {
      // „PDF einfügen“ nur mit Freischaltung (hidden an <option> kennt Safari nicht).
      root.querySelectorAll('.ds-vinsert option[value="quiz"], .ds-yinsert option[value="quiz"]')
        .forEach((o) => o.after(new Option('📄 PDF an dieser Stelle', 'pdf')));
      importButton.textContent = '📄 Übernehmen…';
      importButton.title = 'Writer- oder Word-Dokument (.odt, .docx) oder PDF übernehmen: Überschriften, Absätze, Listen, Tabellen, Bilder';
    }
  });

  /** Wie ein PDF übernommen wird – je nach eingerichteten Diensten (GET /api/worksheets/status). */
  const askPdfMode = async () => {
    const info = await workerStatus();
    const choices = [
      { mode: 'text', label: '📝 Text mit Struktur', hint: 'Überschriften, Absätze, Listen, Tabellen, Code, Bilder – zum Weiterbearbeiten. Gut für Blätter aus Writer oder Word.', ok: !!info.configured },
      { mode: 'pages', label: '🖼 Seiten als Bilder', hint: 'Sieht genau aus wie das PDF, lässt sich aber nicht bearbeiten.', ok: !!info.configured },
      { mode: 'ai', label: '🤖 KI-Erkennung', hint: 'Trainierte Modelle auf dem Server (docling): besser bei Tabellen, Spalten und Scans, dafür langsamer.', ok: !!info.pdfAi?.ok,
        missing: info.pdfAi ? 'Der KI-Dienst (pdf-ai) antwortet gerade nicht.' : 'Auf diesem Server nicht eingerichtet (Dienst pdf-ai, siehe pdf-ai/README.md).' },
    ];
    if (!choices.some((c) => c.ok)) { status.textContent = '❌ Für PDFs ist auf diesem Server kein Dienst eingerichtet (Renderer bzw. pdf-ai).'; return null; }
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `<div class="import-modules-card ds-pdf-dialog">
          <h3>📄 PDF übernehmen</h3>
          <div class="ds-pdf-choices">${choices.map((c) => `
            <button type="button" class="btn btn-secondary ds-pdf-choice" data-mode="${c.mode}" ${c.ok ? '' : 'disabled'}>
              <strong>${c.label}</strong><small>${escapeHtml(c.ok ? c.hint : c.missing || 'Auf diesem Server nicht eingerichtet.')}</small>
            </button>`).join('')}</div>
          ${info.pdfAi?.ok ? '<label class="ds-pdf-ocr"><input type="checkbox"> Gescanntes PDF – Text erkennen (OCR, nur KI-Erkennung)</label>' : ''}
          <p class="hint">Danach im Editor prüfen: Formeln, Karos und Lösungsfelder lassen sich aus einem PDF nur ungefähr erkennen.</p>
          <div class="confirm-actions"><button type="button" class="btn btn-secondary ds-pdf-cancel">Abbrechen</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.ds-pdf-cancel').addEventListener('click', () => done(null));
      overlay.querySelectorAll('.ds-pdf-choice').forEach((b) => b.addEventListener('click', () => done({
        mode: b.dataset.mode, ocr: !!overlay.querySelector('.ds-pdf-ocr input')?.checked,
      })));
    });
  };

  /** Eine Datei wählen lassen (z. B. das PDF zur .xopp). */
  const pickFile = (accept) => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });

  /**
   * Xournal++ (.xopp): Das PDF dahinter läuft durch den gewohnten Import
   * (bearbeitbar), die Striche werden die Beschriftung der Lehrkraft im
   * Stift-Editor – je Seite eine Gruppe, ungefähr an der Stelle im PDF
   * (`_pos` der Bausteine), zunächst nur für sie sichtbar.
   */
  const importXopp = async (xoppFile, pdfFile) => {
    const { readXoppFile, xoppToDocument, saveTeacherInk } = await import('./xopp-import.js');
    let xopp;
    try { xopp = await readXoppFile(xoppFile); } catch (err) { status.textContent = `❌ ${err.message}`; return; }
    const docId = documentId();
    if (!docId) { status.textContent = '❌ Die Beschriftung braucht ein Dokument – bitte das Modul neu öffnen.'; return; }
    const ask = window.appConfirm || ((m) => Promise.resolve(window.confirm(m)));
    if (xopp.needsPdf && !pdfAllowed) { status.textContent = '❌ Die .xopp beschriftet ein PDF – PDF-Import ist für dein Konto nicht freigeschaltet.'; return; }
    if (xopp.needsPdf && !pdfFile) {
      if (!(await ask(`Die .xopp beschriftet das PDF „${xopp.pdfName || '…'}“ – es steckt nicht in der .xopp-Datei.\n\nJetzt das PDF auswählen?`))) return;
      pdfFile = await pickFile('.pdf,application/pdf');
      if (!pdfFile) return;
    }
    const empty = !spec || !Array.isArray(spec.content) || !spec.content.length || textarea.value === starterYaml;
    const choice = xopp.needsPdf ? await askPdfMode() : null;
    if (xopp.needsPdf && !choice) return;
    if (!empty && !(await ask('Den bisherigen Inhalt durch das Dokument ersetzen?'))) return;
    status.textContent = choice?.mode === 'ai' ? 'KI-Erkennung läuft – das kann je Seite einige Sekunden dauern …' : 'Wird übernommen …';
    let result;
    try {
      result = await xoppToDocument(xopp, { name: xoppFile.name, pdfFile, pdf: choice });
    } catch (err) {
      status.textContent = `❌ Übernahme fehlgeschlagen: ${err.message}`;
      return;
    }
    const saved = result.stand ? await saveTeacherInk(docId, result.stand) : true;
    applyImported(result.spec, result.title, result.warnings);
    status.innerHTML += result.count
      ? (saved ? ` ✍️ ${result.count} Striche und Textfelder sind deine Beschriftung (nur für dich, je Seite eine Gruppe) – nach dem Speichern unter „✍️ Mit Stift bearbeiten“.`
        : ' ⚠️ Die Beschriftung ließ sich nicht speichern.')
      : ' (Die .xopp enthält keine Beschriftung.)';
  };

  importButton.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true; // .xopp zusammen mit ihrem PDF
    input.accept = '.odt,.ott,.fodt,.docx,.doc,.rtf,application/vnd.oasis.opendocument.text,'
      + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,.xopp'
      + (pdfAllowed ? ',.pdf,application/pdf' : '');
    input.onchange = async () => {
      const files = [...input.files];
      const xoppFile = files.find((f) => /\.xopp$/i.test(f.name));
      if (xoppFile) { await importXopp(xoppFile, files.find((f) => /\.pdf$/i.test(f.name)) || null); return; }
      const file = files[0];
      if (!file) return;
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      if (isPdf && !pdfAllowed) { status.textContent = '❌ PDF-Import ist für dein Konto nicht freigeschaltet.'; return; }
      const ask = window.appConfirm || ((m) => Promise.resolve(window.confirm(m)));
      const empty = !spec || !Array.isArray(spec.content) || !spec.content.length || textarea.value === starterYaml;
      const choice = isPdf ? await askPdfMode() : null;
      if (isPdf && !choice) return;
      if (!empty && !(await ask('Den bisherigen Inhalt durch das Dokument ersetzen?'))) return;
      status.textContent = isPdf && choice.mode === 'ai' ? 'KI-Erkennung läuft – das kann je Seite einige Sekunden dauern …'
        : /\.(docx|doc|rtf)$/i.test(file.name) ? 'Word-Datei wird mit LibreOffice umgewandelt und übernommen – das dauert einige Sekunden …'
          : 'Wird übernommen …';
      try {
        const form = new FormData();
        form.append('file', file);
        if (!isPdf && topicSource()) form.append('topicId', topicSource());
        if (isPdf) {
          form.append('mode', choice.mode);
          if (choice.ocr) form.append('ocr', 'true');
        }
        const res = await fetch(isPdf ? '/api/worksheets/import-pdf' : '/api/interchange/odt-to-html', { method: 'POST', headers: token() ? { Authorization: `Bearer ${token()}` } : {}, body: form });
        const data = await res.json();
        if (isPdf) {
          if (!res.ok || !data.spec) throw new Error(data.message || `HTTP ${res.status}`);
          applyImported(data.spec, data.title || file.name.replace(/\.pdf$/i, ''), data.warnings || []);
          return;
        }
        if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
        const { spec: imported, warnings } = htmlToDocSpec(data.html);
        applyImported(imported, data.title, [...(data.warnings || []), ...warnings]);
      } catch (err) {
        status.textContent = `❌ Übernahme fehlgeschlagen: ${err.message}`;
      }
    };
    input.click();
  });

  root.querySelector('.ds-print-menu').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const r = btn.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, OUTPUTS.map((o) => ({ label: `${o.label} – ${o.title}`, onClick: () => print(o.output, btn) })));
  });

  async function print(output, btn) {
    update();
    if (!spec) return;
    const errors = validateDocSpec(spec);
    if (errors.length) { status.textContent = 'Erst die markierten Fehler beheben.'; return; }
    const isPdf = output.endsWith('pdf');
    // Fenster sofort öffnen – nach dem await ließe der Popup-Blocker es nicht mehr zu.
    const win = isPdf ? window.open('', '_blank') : null;
    btn.disabled = true;
    status.textContent = 'Wird erzeugt …';
    try {
      const title = document.getElementById('moduleTitle')?.value.trim() || 'Dokument';
      const res = await fetch('/api/worksheets/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: JSON.stringify({ spec, title, output, kind: document.querySelector('select[name="content_kind"]')?.value,
          // Vorlage aus dem Formular – auch vor dem Speichern ('' = wie im Ordner).
          templateId: document.querySelector('select[name="content_templateId"]')?.value ?? undefined,
          ...(moduleId ? { moduleId } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = Array.isArray(body.errors) ? ` ${body.errors.join(' · ')}` : '';
        throw new Error((body.message || `HTTP ${res.status}`) + detail);
      }
      let warnings = [];
      try { warnings = JSON.parse(decodeURIComponent(res.headers.get('X-Worksheet-Warnings') || '[]')); } catch (_) { /* ohne Hinweise */ }
      const blob = await res.blob();
      if (win) {
        win.location.href = URL.createObjectURL(blob);
      } else {
        const disposition = res.headers.get('Content-Disposition') || '';
        const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        downloadBlob(blob, star ? decodeURIComponent(star[1]) : `${title}.odt`);
      }
      status.innerHTML = warnings.length
        ? `✅ Erzeugt – ${warnings.map((w) => `⚠️ ${escapeHtml(w)}`).join(' ')}`
        : '✅ Erzeugt';
    } catch (err) {
      win?.close();
      status.textContent = `❌ ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Visueller Editor ----------
  const visual = root.querySelector('.ds-visual');
  // Die Leiste haftet beim Scrollen unter der Kopfzeile des Modul-Editors (die selbst stehen bleibt).
  const header = root.closest('.view')?.querySelector('.editor-header') || document.querySelector('#view-create-module .editor-header');
  if (header) {
    const place = () => root.style.setProperty('--ds-sticky-top', `${Math.max(0, header.offsetHeight + (parseFloat(getComputedStyle(header).top) || 0))}px`);
    place();
    new ResizeObserver(place).observe(header);
  }
  const surface = root.querySelector('.ds-surface');
  const blockSelect = root.querySelector('.ds-vblock');
  let mode = 'yaml';
  let syncing = false;
  // Inhalt der Ansicht setzen, ohne dass er als Bearbeitung zurück ins YAML
  // fließt. Der MutationObserver meldet erst nach dem Setzen (asynchron) –
  // die anstehenden Meldungen deshalb verwerfen. Sonst schriebe er den
  // Inhalt beim Öffnen einmal um, und das Modul gälte als geändert.
  const setSurface = (html) => {
    syncing = true;
    surface.innerHTML = html;
    surfaceObserver.takeRecords();
    syncing = false;
  };
  let vTimer = null;

  const fromVisual = () => {
    const { spec: next } = htmlToDocSpec(surface.innerHTML);
    textarea.value = toYaml(next);
    update();
  };
  const surfaceObserver = new MutationObserver(() => {
    if (syncing || mode !== 'visual') return;
    clearTimeout(vTimer);
    vTimer = setTimeout(fromVisual, 300);
  });
  surfaceObserver.observe(surface, { childList: true, subtree: true, characterData: true, attributes: true });
  const tableTools = attachTableTools(surface, root.querySelector('.ds-tablebar-slot'), { copyObject: (t) => copyObject(t) });
  // Leiste wie in Google Docs: Farben, Ausrichtung, Zeilenabstand, Listenarten, Einzug.
  const formatTools = attachFormatTools(root.querySelector('.ds-vtoolbar'), surface, { tableTools, currentBlock: () => currentBlock() });
  const paraBtn = root.querySelector('.ds-para-btn');
  const tableBtn = root.querySelector('.ds-table-btn');
  [paraBtn, tableBtn].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  paraBtn.addEventListener('click', () => {
    const node = window.getSelection()?.anchorNode;
    const el = node && surface.contains(node) ? (node.nodeType === 3 ? node.parentNode : node) : null;
    const target = el?.closest?.('ul, ol') || el?.closest?.('p') || currentBlock();
    if (!openParagraphDialog(target)) status.textContent = 'Absatz: Schreibmarke in einen Textabsatz oder eine Liste setzen.';
  });
  tableBtn.addEventListener('click', () => {
    const entries = tableTools.menuHere();
    if (!entries) return;
    const r = tableBtn.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4, entries);
  });
  document.addEventListener('selectionchange', () => {
    if (mode !== 'visual') return;
    const node = document.getSelection()?.anchorNode;
    if (node && surface.contains(node)) tableBtn.hidden = !tableTools.inTable();
  });
  if (typeof window.WorksheetImageTools !== 'undefined') {
    new window.WorksheetImageTools(surface, document.createElement('input'), root.querySelector('.ds-vtoolbar'));
    // Selten gebraucht: Bild und Zusammenstellen stehen im Menü (➕, Rechtsklick), nicht in der Leiste.
    // Die Knöpfe bleiben unsichtbar da – das Menü löst sie aus.
    root.querySelectorAll('.ds-vtoolbar .rt-btn-image, .ds-vtoolbar .rt-btn-compose').forEach((b) => { b.style.display = 'none'; });
  }

  const setMode = (next) => {
    if (next === 'visual') {
      update();
      try { yamlLoad(textarea.value); } catch (_) { status.textContent = 'Erst den YAML-Fehler beheben, dann umschalten.'; return; }
      setSurface(specToEditorHtml(spec || { content: [] }));
    } else if (mode === 'visual') {
      clearTimeout(vTimer);
      fromVisual();
    }
    mode = next;
    visual.hidden = mode !== 'visual';
    textarea.hidden = mode !== 'yaml';
    root.querySelector('.ds-ybar').hidden = mode !== 'yaml';
    selectWidget(null);
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    try { localStorage.setItem('lm_ds_mode', mode); } catch (_) { /* egal */ }
  };
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /** Block-Element der Schreibmarke (direktes Kind der Fläche bzw. eines Kastens) – oder der gewählte Baustein. */
  /** Block zu einem Knoten in der Fläche (direktes Kind der Fläche bzw. eines Kastens) – oder null. */
  const blockOfNode = (node) => {
    let n = node && node.nodeType === 3 ? node.parentNode : node;
    if (!n || !surface.contains(n)) return null;
    // Blöcke stehen direkt in der Fläche, in einem Kasten oder in einer Spalte (table.ws-columns).
    const holder = (p) => p === surface || p?.classList?.contains('ws-box') || (p?.tagName === 'TD' && p.closest('table')?.classList.contains('ws-columns'));
    while (n && n !== surface && !holder(n.parentNode)) n = n.parentNode;
    return n && n !== surface ? n : null;
  };
  // Letzter Block der Schreibmarke – das ➕ oder ein Menü nimmt ihn, wenn die Auswahl inzwischen woanders steht.
  let lastBlock = null;
  const currentBlock = () => {
    if (selectedWidget && surface.contains(selectedWidget)) return selectedWidget;
    const sel = window.getSelection();
    const here = blockOfNode(sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null);
    return here || (lastBlock && surface.contains(lastBlock) ? lastBlock : null);
  };
  /**
   * Absatz in einer Tabellenzelle (direktes Kind der Zelle) – oder null.
   * `wrap`: losen Text der Zelle um die Schreibmarke erst in einen Absatz fassen.
   */
  const cellParagraph = (node, wrap = false) => {
    const el = node && node.nodeType === 3 ? node.parentNode : node;
    const td = el?.closest?.('td, th');
    if (!td || !surface.contains(td) || td.closest('table')?.classList.contains('ws-columns')) return null;
    let n = node;
    while (n !== td && n.parentNode !== td) n = n.parentNode;
    if (n !== td && n.nodeType === 1 && /^(P|H[1-6])$/.test(n.tagName)) return n;
    if (!wrap) return null;
    const isBlock = (c) => c.nodeType === 1 && /^(P|H[1-6]|UL|OL|DIV|TABLE|PRE)$/.test(c.tagName);
    if (n !== td && isBlock(n)) return null;
    // Zusammenhängender loser Text (bis zum nächsten Absatz davor und danach).
    const kids = [...td.childNodes];
    let a = n === td ? 0 : kids.indexOf(n);
    let b = n === td ? kids.length - 1 : a;
    if (n === td && kids.some(isBlock)) return null;
    while (a > 0 && !isBlock(kids[a - 1])) a--;
    while (b < kids.length - 1 && !isBlock(kids[b + 1])) b++;
    const p = document.createElement('p');
    kids[a] ? td.insertBefore(p, kids[a]) : td.append(p);
    p.append(...kids.slice(a, b + 1));
    return p;
  };
  // Letzte Auswahl in der Fläche – die Absatzart (Auswahlliste) nimmt sie, auch wenn die Liste den Fokus hat.
  let lastRange = null;
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (mode !== 'visual' || !surface.contains(sel?.anchorNode)) return;
    lastBlock = blockOfNode(sel.anchorNode) || lastBlock;
    if (sel.rangeCount) lastRange = sel.getRangeAt(0).cloneRange();
    const anchorEl = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode;
    const list = anchorEl.closest?.('ul, ol');
    if (list && surface.contains(list)) { blockSelect.value = list.tagName === 'OL' ? 'ol' : 'ul'; return; }
    const b = cellParagraph(sel.anchorNode) || currentBlock();
    const ds = b?.dataset?.ds;
    // Überschrift ohne data-ds (z. B. eingefügt aus Word) zählt wie „ohne Nummer“.
    blockSelect.value = ds === 'heading' || (!ds && /^H[1-6]$/.test(b?.tagName)) ? { H3: 'heading2', H4: 'heading3', H5: 'heading3', H6: 'heading3' }[b.tagName] || 'heading'
      : ['section', 'task', 'subtask', 'note'].includes(ds) ? ds : 'p';
  });
  /** Absätze, für die die Absatzart gilt: alle markierten – auch in Tabellenzellen – sonst der der Schreibmarke. */
  const blocksForKind = () => {
    const range = lastRange && surface.contains(lastRange.commonAncestorContainer) ? lastRange : null;
    if (range && !range.collapsed) {
      const marked = [...surface.querySelectorAll('p, h1, h2, h3, h4, h5, h6')]
        .filter((el) => range.intersectsNode(el) && (blockOfNode(el) === el || cellParagraph(el) === el));
      if (marked.length) return marked;
    }
    const b = (range && cellParagraph(range.startContainer, true)) || currentBlock();
    return b ? [b] : [];
  };
  /** Absätze `blocks` in die Absatzart `kind` umwandeln – gibt die neuen Elemente zurück. */
  const convertBlocks = (blocks, kind) => {
    // Überschrift 1–3 ohne Nummer: h2–h4 (im YAML heading mit level 1–3).
    const tag = { p: 'p', note: 'p', section: 'h2', task: 'h3', subtask: 'h4', heading: 'h2', heading2: 'h3', heading3: 'h4' }[kind];
    const out = [];
    for (const b of blocks) {
      if (!/^(P|H[1-6]|DIV)$/.test(b.tagName) || b.classList.contains('ds-widget') || b.classList.contains('ws-box')) continue;
      const el = document.createElement(tag);
      if (kind !== 'p') el.dataset.ds = kind.replace(/^heading\d$/, 'heading');
      if (b.dataset.id) el.dataset.id = b.dataset.id;
      const inner = b.dataset.ds === 'note' && b.firstElementChild?.tagName === 'EM' ? b.firstElementChild.innerHTML : b.innerHTML;
      el.innerHTML = kind === 'note' ? `<em>${inner}</em>` : inner;
      b.replaceWith(el);
      out.push(el);
    }
    return out;
  };
  /** Auswahl wiederherstellen – über die Elemente `els` oder die zuletzt gemerkte. */
  const reselect = (els) => {
    const sel = window.getSelection();
    surface.focus();
    if (els.length === 1) sel.collapse(els[0], els[0].childNodes.length); // Schreibmarke ans Ende des Absatzes
    else if (els.length) {
      const r = document.createRange();
      r.setStart(els[0], 0);
      r.setEnd(els[els.length - 1], els[els.length - 1].childNodes.length);
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (lastRange && surface.contains(lastRange.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(lastRange);
    }
    if (sel.rangeCount) lastRange = sel.getRangeAt(0).cloneRange();
    if (els.length) lastBlock = blockOfNode(els[0]) || lastBlock;
  };
  blockSelect.addEventListener('change', () => {
    const kind = blockSelect.value;
    reselect([]);
    const list = formatTools.listOfSelection();
    if (kind === 'ul' || kind === 'ol') {
      // Überschriften und Hinweise erst zu Text, dann die Liste (in Zellen auch aus losen Zeilen).
      if (!list) {
        const range = lastRange;
        const marked = range ? [...surface.querySelectorAll('p, h1, h2, h3, h4, h5, h6')]
          .filter((el) => range.intersectsNode(el) && (blockOfNode(el) === el || cellParagraph(el) === el)) : [];
        const plain = convertBlocks(marked.filter((el) => el.tagName !== 'P' || el.dataset.ds), 'p');
        if (plain.length) reselect(marked.map((el) => (el.isConnected ? el : plain.shift())));
      }
      formatTools.setList(kind === 'ol');
      blockSelect.value = kind;
      return;
    }
    // Aus einer Liste: die gewählten Listenpunkte werden Absätze, dann die Absatzart.
    if (list) {
      const paras = formatTools.unlist();
      reselect(kind === 'p' ? paras : convertBlocks(paras, kind));
    } else {
      // Die Schreibmarke bleibt im umgewandelten Absatz – sonst spränge sie
      // weg, die Liste zeigte wieder „Text“ und die nächste Wahl träfe einen anderen.
      reselect(convertBlocks(blocksForKind(), kind));
    }
    blockSelect.value = kind;
  });
  root.querySelectorAll('[data-cmd]').forEach((btn) => btn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Auswahl in der Fläche behalten
    const cmd = btn.dataset.cmd;
    // In einer Tabellenzelle richtet ⇤ ↔ ⇥ die Zelle aus (bleibt so erhalten, anders als ein Absatz darin).
    const dir = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right' }[cmd];
    if (dir && tableTools.align(dir)) return;
    if (cmd === 'createLink') {
      const url = window.prompt('Adresse des Links (https://…):', 'https://');
      if (url && /^(https?:\/\/|mailto:)/i.test(url)) document.execCommand('createLink', false, url);
      return;
    }
    document.execCommand(cmd, false, null);
  }));
  surface.addEventListener('focus', () => { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* älterer Browser */ } });

  const STARTERS = {
    karo: { type: 'karo', lines: 4 },
    solution: { type: 'solution', blocks: [{ type: 'text', text: 'Musterlösung' }] },
    formula: { type: 'formula', math: 'U = R cdot I' },
    code: { type: 'code', code: '// Quelltext' },
    // „Platz“ ist ein unsichtbares Schreibfeld – Höhe, Breite und Muster lassen sich später ändern.
    spacer: { type: 'karo', lines: 2, pattern: 'frei' },
    pagebreak: { type: 'pagebreak' },
    // nur fürs YAML-Einfügen – im Bearbeiten-Reiter sind Tabelle und Kasten Text
    table: { type: 'table', header: ['Spalte 1', 'Spalte 2'], rows: [['…', '…']] },
    box: { type: 'box', title: 'Merke', blocks: [{ type: 'text', text: '…' }] },
  };
  /** Baustein `what` hinter `after` (Block der Schreibmarke, als das Menü aufging) einfügen. */
  const insertWhat = async (what, after) => {
    if (what === 'quiz') { insertQuiz(after); return; }
    if (what === 'text') {
      // Leerer Absatz – z. B. hinter einer Tabelle oder einem Baustein, wo sonst keine Schreibmarke hinkommt.
      const [p] = placeHtml('<p><br></p>', after);
      selectWidget(null);
      surface.focus();
      window.getSelection().collapse(p, 0);
      p.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (what === 'pdf') {
      const blocks = await insertPdfBlocks();
      if (blocks) placeHtml(specToEditorHtml({ content: blocks }), after);
      return;
    }
    const html = what === 'table' ? '<table><thead><tr><th>Spalte 1</th><th>Spalte 2</th></tr></thead><tbody><tr><td>…</td><td>…</td></tr></tbody></table>'
      : what === 'box' ? '<div class="ws-box" data-title="Merke"><p>…</p></div>'
        : what === 'columns' ? '<table class="ws-columns"><tbody><tr><td><p>links …</p></td><td><p>rechts …</p></td></tr></tbody></table>'
          : widgetHtml(STARTERS[what]);
    const nodes = placeHtml(html, after);
    if (nodes[0].classList?.contains('ds-widget')) selectWidget(nodes[0]);
    if (!['table', 'box', 'columns', 'pagebreak'].includes(what)) editWidget(nodes[0]);
  };

  /** Menü zum Einfügen – am ➕ oder per Rechtsklick in den Text. Quizze des Lernthemas stehen direkt darin. */
  const QUIZ_MENU_MAX = 12;
  const insertMenu = (x, y, at = null) => showContextMenu(x, y, insertEntries(at));
  /** Einträge zum Einfügen hinter `at` (bzw. dem Block der Schreibmarke). */
  const insertEntries = (at = null) => {
    const after = at || currentBlock();
    const quizzes = (topicModules() || []).filter((m) => m && m.id && m.id !== moduleSource() && !m.parentId && m.type !== 'document');
    const quizEntries = quizzes.slice(0, QUIZ_MENU_MAX).map((m) => ({
      label: `${window.H5P_TYPES?.[m.type]?.icon || '🧩'} ${m.title || m.type}`,
      onClick: () => {
        const nodes = placeHtml(widgetHtml({ type: 'quiz', module: m.id, title: m.title || 'Quiz' }), after);
        selectWidget(nodes[0]);
      },
    }));
    const entries = [
      ['text', '¶ Textabsatz'],
      ['karo', '▦ Schreibfeld (Karo, Linien)'],
      // Mehr als ins Menü passen – oder keins: die Auswahl (sie erklärt, wie ein Quiz entsteht).
      ...(quizzes.length > QUIZ_MENU_MAX ? [['quiz', `🧩 Weitere Quizze (${quizzes.length})…`]] : !quizzes.length ? [['quiz', '🧩 Quiz aus dem Lernthema…']] : []),
      ...(pdfAllowed ? [['pdf', '📄 PDF an dieser Stelle']] : []),
      ['solution', '💡 Lösung'], ['formula', '∑ Formel'], ['code', '⌨ Code'], ['table', '▤ Tabelle'],
      ['box', '▢ Kasten'], ['columns', '▥ Spalten (nebeneinander)'], ['spacer', '◌ Platz (unsichtbar)'], ['pagebreak', '⤓ Seitenumbruch'],
      ['image', '🖼 Bild…'], ['compose', '🧩 Bilder zusammenstellen…'],
    ];
    return [...quizEntries, ...entries.map(([what, label]) => ({
      label,
      onClick: () => {
        if (what === 'image' || what === 'compose') {
          // Die Bildwerkzeuge setzen an die Schreibmarke.
          root.querySelector(what === 'image' ? '.ds-vtoolbar .rt-btn-image' : '.ds-vtoolbar .rt-btn-compose')?.click();
          return;
        }
        void insertWhat(what, after);
      },
    }))];
  };
  root.querySelector('.ds-vplus').addEventListener('mousedown', (e) => e.preventDefault()); // Schreibmarke behalten
  root.querySelector('.ds-vplus').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    insertMenu(r.left, r.bottom + 4);
  });
  // ---------- Element als Objekt: ↑ ↓ ⧉ ✂ 📋 ✕ für jedes Element (Rechtsklick ▸) ----------
  /** Element als YAML (`- type: …`) – Strg+V fügt es als Baustein wieder ein. */
  const yamlOf = (el) => {
    const blocks = el.classList.contains('ds-widget') ? [blockOf(el)].filter(Boolean) : htmlToDocSpec(el.outerHTML).spec.content;
    return blocks.length ? yamlDump(blocks, { lineWidth: -1, noRefs: true }) : '';
  };
  const copyObject = async (el, cut = false) => {
    const text = yamlOf(el);
    if (!text || !(await copyText(text))) { status.textContent = '❌ Zwischenablage nicht erreichbar.'; return; }
    if (cut) { if (el === selectedWidget) selectWidget(null); el.remove(); }
    status.textContent = `${cut ? '✂ Ausgeschnitten' : '📋 Kopiert'} – Schreibmarke setzen, Strg+V fügt es dahinter ein.`;
  };
  /** Aktionen eines Elements: Tabelle wie am Griff, Baustein wie an seiner Leiste, sonst allgemein. */
  const objectHandlersOf = (el) => {
    if (el.tagName === 'TABLE') return tableTools.objectHandlers(el);
    const widget = el.classList.contains('ds-widget');
    const move = (act) => () => {
      if (widget) widgetAction(act, el);
      else if (act === 'up') el.previousElementSibling.before(el);
      else el.nextElementSibling.after(el);
    };
    return {
      up: el.previousElementSibling ? move('up') : null,
      down: el.nextElementSibling ? move('down') : null,
      dup: () => {
        if (widget) { widgetAction('dup', el); return; }
        const copy = el.cloneNode(true);
        copy.removeAttribute('data-id');
        copy.querySelectorAll('[data-id]').forEach((n) => n.removeAttribute('data-id'));
        el.after(copy);
      },
      cut: () => copyObject(el, true),
      copy: () => copyObject(el),
      del: () => (widget ? widgetAction('del', el) : el.remove()),
    };
  };

  // Alt+↑ / Alt+↓ mit der Schreibmarke im Text: den Absatz (bzw. die Liste …) verschieben.
  surface.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.shiftKey || !['ArrowUp', 'ArrowDown'].includes(e.key) || selectedWidget) return;
    const b = blockOfNode(window.getSelection()?.anchorNode);
    if (!b || b.tagName === 'TABLE') return;
    const sib = e.key === 'ArrowUp' ? b.previousElementSibling : b.nextElementSibling;
    e.preventDefault();
    if (!sib) return;
    // Die Schreibmarke bleibt, wo sie im Absatz stand.
    const sel = window.getSelection();
    const { anchorNode, anchorOffset } = sel;
    if (e.key === 'ArrowUp') sib.before(b); else sib.after(b);
    if (anchorNode?.isConnected) sel.collapse(anchorNode, anchorOffset);
    b.scrollIntoView?.({ block: 'nearest' });
  });

  surface.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return; // Menü des Browsers (z. B. Rechtschreibung)
    e.preventDefault();
    // Die angeklickte Stelle zählt – nicht, wo die Schreibmarke vorher stand.
    const widget = e.target.closest?.('.ds-widget');
    const after = (widget && surface.contains(widget) ? widget : null) || blockOfNode(e.target);
    const entries = [];
    // Markierter Text: Ausschneiden, Kopieren (Einfügen mit Strg+V – der Browser lässt es nur so zu).
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && surface.contains(sel.anchorNode)) {
      entries.push({ label: '✂ Ausschneiden', hint: 'Strg+X', onClick: () => document.execCommand('cut') },
        { label: '⧉ Kopieren', hint: 'Strg+C', onClick: () => document.execCommand('copy') }, '-');
    }
    // In einer Tabellenzelle: Zeile ▸ Spalte ▸ Zelle ▸ Tabelle ▸ – Einfügen als Untermenü.
    const table = widget ? null : tableTools.menuFor(e.target);
    // Das Element unter der Maus als Ganzes – eine Tabelle hat es schon unter „Tabelle ▸“.
    const handlers = after && !(after.tagName === 'TABLE' && table) ? objectHandlersOf(after) : null;
    // Rechtsklick auf ein Bild: es weitergeben (LibreOffice Draw, Word …) – als Bild, nicht als YAML.
    const img = e.target.tagName === 'IMG' && surface.contains(e.target) ? e.target : null;
    if (img && window.appImageClipboard) {
      const { copy, save, tell } = window.appImageClipboard;
      entries.push({ label: '🖼 Bild kopieren', hint: 'PNG', onClick: async () => tell(await copy(img)) },
        { label: '⬇ Bild speichern', onClick: async () => tell(await save(img)) }, '-');
    }
    if (handlers) {
      const edit = widget ? [{ label: '✏️ Bearbeiten', hint: 'Enter', onClick: () => editWidget(widget) }, '-'] : [];
      entries.push({ label: objectName(after), submenu: objectEntries(handlers, edit, { selectable: !!widget }) });
      // Im Kasten: auch der Kasten als Ganzes.
      const box = after.parentElement?.closest('.ws-box');
      if (box && surface.contains(box)) entries.push({ label: objectName(box), submenu: objectEntries(objectHandlersOf(box), [], { selectable: false }) });
      entries.push('-');
    }
    const para = e.target.closest?.('ul, ol') || (e.target.closest?.('p:not([data-ds])'));
    const paraEntry = para && surface.contains(para) ? [{ label: '¶ Absatz …', onClick: () => openParagraphDialog(para.closest('ul, ol') || para) }] : [];
    if (table) entries.push(...table, '-', ...paraEntry, { label: '➕ Einfügen', submenu: insertEntries(after) });
    else entries.push(...insertEntries(after), ...(paraEntry.length ? ['-', ...paraEntry] : []));
    showContextMenu(e.clientX, e.clientY, entries);
  });

  const pickQuiz = () => pickQuizFrom(topicModules(), moduleSource());

  /**
   * HTML hinter `after` (bzw. ans Ende) setzen. Eine leere Zeile zum
   * Weiterschreiben nur am Ende – mitten im Blatt würde sie zu „Platz“.
   */
  const placeHtml = (html, after) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const nodes = [...tmp.childNodes];
    if (after?.isConnected) after.after(...nodes); else surface.append(...nodes);
    const last = nodes[nodes.length - 1];
    if (last && !last.nextSibling) last.after(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
    return nodes;
  };

  /** PDF wählen und in Bausteine umwandeln – zum Einfügen an der Schreibmarke. */
  const insertPdfBlocks = async () => {
    try {
      const res = await pickPdfBlocks({ onBusy: (text) => { status.textContent = text; }, topicId: topicSource() });
      if (!res) return null;
      status.innerHTML = `✅ „${escapeHtml(res.name)}“ eingefügt: ${res.blocks.length} Blöcke.` + res.warnings.map((w) => ` ⚠️ ${escapeHtml(w)}`).join('');
      return res.blocks;
    } catch (err) {
      status.textContent = `❌ PDF einfügen: ${err.message}`;
      return null;
    }
  };

  /** Quiz an der Schreibmarke einfügen. */
  const insertQuiz = async (after = currentBlock()) => {
    const block = await pickQuiz();
    if (!block) return;
    selectWidget(placeHtml(widgetHtml(block), after)[0]);
  };

  /**
   * Lösung bearbeiten: Reiter „Text“ (Texteditor wie das Blatt) und „YAML“.
   * Bildet der Texteditor die Lösung nicht genau ab (gleiche Anzeige nach
   * Hin- und Rückweg), öffnet der Dialog im YAML-Reiter.
   */
  const editSolution = (w, block) => {
    const view = (blocks) => renderDocSpecHtml({ content: blocks || [] }, { showSolutions: true });
    const toText = (blocks) => specToEditorHtml({ content: blocks || [] });
    const fromText = (html) => htmlToDocSpec(html).spec.content;
    const fits = view(fromText(toText(block.blocks))) === view(block.blocks);
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<form class="import-modules-card ds-widget-dialog ds-solution-dialog">
        <h3>Lösung bearbeiten</h3>
        <div class="admin-tabs">
          <button type="button" class="admin-tab" data-tab="text">✏️ Text</button>
          <button type="button" class="admin-tab" data-tab="yaml">⌨ YAML</button>
        </div>
        <div class="ds-sol-text">
          <div class="rich-text-toolbar">
            ${[['bold', '<b>F</b>', 'Fett'], ['italic', '<i>K</i>', 'Kursiv'], ['underline', '<u>U</u>', 'Unterstrichen'],
              ['superscript', 'x²', 'Hochgestellt'], ['subscript', 'x₂', 'Tiefgestellt'], ['insertUnorderedList', '•', 'Aufzählung'], ['insertOrderedList', '1.', 'Nummerierung']]
              .map(([cmd, label, title]) => `<button type="button" class="rt-btn" data-cmd="${cmd}" title="${title}">${label}</button>`).join('')}
          </div>
          <div class="ds-surface ds-sol-surface worksheet-content" contenteditable="true" spellcheck="true" aria-label="Lösung"></div>
        </div>
        <div class="ds-sol-yaml" hidden>
          ${fits ? '' : '<p class="hint">Diese Lösung enthält Teile, die der Texteditor nicht genau abbildet – deshalb hier als YAML.</p>'}
          <textarea class="ds-yaml" rows="12" spellcheck="false"></textarea>
        </div>
        <p class="ds-error"></p>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Übernehmen</button>
          <button type="button" class="btn btn-danger ds-w-del">Entfernen</button>
          <button type="button" class="btn btn-secondary ds-w-cancel">Abbrechen</button>
        </div></form>`;
    document.body.appendChild(overlay);
    const surfaceEl = overlay.querySelector('.ds-sol-surface');
    const ta = overlay.querySelector('textarea');
    const err = overlay.querySelector('.ds-error');
    surfaceEl.innerHTML = toText(block.blocks) || '<p><br></p>';
    ta.value = yamlDump(block, { lineWidth: -1, noRefs: true });
    let tab = null;
    const current = () => (tab === 'text' ? { ...block, blocks: fromText(surfaceEl.innerHTML) } : yamlLoad(ta.value));
    const show = (next) => {
      // Beim Wechsel den Stand mitnehmen.
      if (tab && next !== tab) {
        try {
          const cur = current();
          if (next === 'yaml') ta.value = yamlDump(cur, { lineWidth: -1, noRefs: true });
          else surfaceEl.innerHTML = toText(cur?.blocks) || '<p><br></p>';
          err.textContent = '';
        } catch (e) { err.textContent = `YAML: ${e.reason || e.message}`; return; }
      }
      tab = next;
      overlay.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      overlay.querySelector('.ds-sol-text').hidden = tab !== 'text';
      overlay.querySelector('.ds-sol-yaml').hidden = tab !== 'yaml';
      (tab === 'text' ? surfaceEl : ta).focus();
    };
    overlay.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    overlay.querySelectorAll('.rt-btn').forEach((b) => b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.execCommand(b.dataset.cmd);
    }));
    show(fits ? 'text' : 'yaml');
    const close = () => overlay.remove();
    overlay.querySelector('.ds-w-cancel').addEventListener('click', close);
    overlay.querySelector('.ds-w-del').addEventListener('click', () => { if (w === selectedWidget) selectWidget(null); w.remove(); close(); });
    overlay.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      let next;
      try { next = current(); } catch (e) { err.textContent = `YAML: ${e.reason || e.message}`; return; }
      if (block.id && next && typeof next === 'object' && next.id === undefined) next.id = block.id;
      const errs = validateDocSpec({ content: [next] });
      if (errs.length) { err.textContent = errs.join(' · '); return; }
      const tmp = document.createElement('div');
      tmp.innerHTML = widgetHtml(next);
      const fresh = tmp.firstElementChild;
      w.replaceWith(fresh);
      selectWidget(fresh);
      close();
    });
  };

  /** Baustein als YAML bearbeiten (Lösung: editSolution). */
  const editWidget = (w) => {
    let block;
    try { block = JSON.parse(decodeURIComponent(w.dataset.block)); } catch (_) { return; }
    if (block.type === 'solution') { editSolution(w, block); return; }
    // Alter „Platz“: wird zum unsichtbaren Schreibfeld (gleiche Höhe ungefähr: eine Zeile ≈ 0,5 cm).
    if (block.type === 'spacer') block = { ...(block.id ? { id: block.id } : {}), type: 'karo', lines: Number.isInteger(block.lines) ? block.lines : 3, pattern: 'frei' };
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    // Schreibfeld: Höhe, Breite und Muster als Felder – sie schreiben ins YAML darunter.
    // Quiz: Größe im Blatt (A− / A+ beim Ansehen stellt jeder für sich nach).
    const quizSize = block.type === 'quiz' ? `<div class="ds-field-form">
        <label>Größe im Blatt <select class="ds-q-scale">${[0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5].map((v) => `<option value="${v}">${Math.round(v * 100)} %</option>`).join('')}</select></label>
        <span class="hint">Vorgabe für alle; mit A− / A+ am Quiz stellt jeder selbst nach.</span>
      </div>` : '';
    const field = block.type === 'karo' ? `<div class="ds-field-form">
        <label>Höhe <input type="number" class="ds-f-h" min="0.5" max="30" step="0.5"> cm</label>
        <label>Breite <input type="number" class="ds-f-w" min="1" max="${KARO_MAX_WIDTH_CM}" step="0.5" placeholder="ganz"> cm</label>
        <label>Muster <select class="ds-f-p"><option value="karo">▦ Karo</option><option value="linien">☰ Linien</option><option value="leer">▢ Leer (Rahmen)</option><option value="frei">◌ Unsichtbar (nur Platz)</option></select></label>
      </div>` : '';
    overlay.innerHTML = `<form class="import-modules-card ds-widget-dialog">
        <h3>${block.type === 'karo' ? 'Schreibfeld' : block.type === 'quiz' ? 'Quiz' : 'Baustein'} bearbeiten</h3>
        ${field}${quizSize}
        ${field || quizSize ? '<details class="ds-field-yaml"><summary>Als YAML</summary><textarea class="ds-yaml" rows="6" spellcheck="false"></textarea></details>'
          : '<textarea class="ds-yaml" rows="12" spellcheck="false"></textarea>'}
        <p class="ds-error"></p>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Übernehmen</button>
          <button type="button" class="btn btn-danger ds-w-del">Entfernen</button>
          <button type="button" class="btn btn-secondary ds-w-cancel">Abbrechen</button>
        </div></form>`;
    document.body.appendChild(overlay);
    const ta = overlay.querySelector('textarea');
    ta.value = yamlDump(block, { lineWidth: -1, noRefs: true });
    if (block.type === 'karo') {
      const [h, wd, pat] = ['.ds-f-h', '.ds-f-w', '.ds-f-p'].map((sel) => overlay.querySelector(sel));
      h.value = (Number.isInteger(block.lines) ? block.lines : 4) / 2;
      wd.value = parseFloat(block.width) || '';
      pat.value = block.pattern || 'karo';
      const sync = () => {
        let cur;
        try { cur = yamlLoad(ta.value) || {}; } catch (_) { cur = { ...block }; }
        cur.lines = Math.max(1, Math.min(60, Math.round(Number(h.value) * 2) || 1));
        const cm = Math.round(Number(wd.value) * 2) / 2;
        if (cm > 0) cur.width = `${Math.min(KARO_MAX_WIDTH_CM, cm)}cm`; else delete cur.width;
        if (pat.value !== 'karo') cur.pattern = pat.value; else delete cur.pattern;
        ta.value = yamlDump(cur, { lineWidth: -1, noRefs: true });
      };
      [h, wd, pat].forEach((el) => el.addEventListener('input', sync));
      h.focus();
    } else if (block.type === 'quiz') {
      const sel = overlay.querySelector('.ds-q-scale');
      sel.value = String(typeof block.scale === 'number' ? block.scale : 1);
      sel.addEventListener('change', () => {
        let cur;
        try { cur = yamlLoad(ta.value) || {}; } catch (_) { cur = { ...block }; }
        if (Number(sel.value) === 1) delete cur.scale; else cur.scale = Number(sel.value);
        ta.value = yamlDump(cur, { lineWidth: -1, noRefs: true });
      });
      sel.focus();
    } else ta.focus();
    const close = () => overlay.remove();
    overlay.querySelector('.ds-w-cancel').addEventListener('click', close);
    overlay.querySelector('.ds-w-del').addEventListener('click', () => { if (w === selectedWidget) selectWidget(null); w.remove(); close(); });
    overlay.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      let next;
      try { next = yamlLoad(ta.value); } catch (err) { overlay.querySelector('.ds-error').textContent = `YAML: ${err.reason || err.message}`; return; }
      // Die feste ID bleibt, auch wenn sie im YAML gelöscht wurde.
      if (block.id && next && typeof next === 'object' && next.id === undefined) next.id = block.id;
      const errs = validateDocSpec({ content: [next] });
      if (errs.length) { overlay.querySelector('.ds-error').textContent = errs.join(' · '); return; }
      const tmp = document.createElement('div');
      tmp.innerHTML = widgetHtml(next);
      const fresh = tmp.firstElementChild;
      w.replaceWith(fresh);
      selectWidget(fresh);
      close();
    });
  };
  // ---- Bausteine wählen, verschieben, kopieren ----
  // Bausteine (Karo, Lösung, Quiz …) sind nicht editierbar – eine Schreibmarke
  // davor oder dahinter gibt es nicht. Ein Klick wählt sie; „Einfügen“ setzt
  // dann dahinter, die Leiste am Baustein verschiebt, verdoppelt, löscht.
  let selectedWidget = null;
  const WBAR = [['up', '↑', 'Nach oben'], ['down', '↓', 'Nach unten'], ['dup', '⧉', 'Verdoppeln'], ['edit', '✏️', 'Bearbeiten'], ['del', '✕', 'Entfernen']];
  function selectWidget(w) {
    if (selectedWidget && selectedWidget !== w) {
      selectedWidget.classList.remove('ds-widget-selected');
      selectedWidget.querySelector(':scope > .ds-wbar')?.remove();
      selectedWidget.querySelectorAll('.ds-karo-grip').forEach((g) => g.remove());
    }
    selectedWidget = w || null;
    if (!w || w.classList.contains('ds-widget-selected')) return;
    w.classList.add('ds-widget-selected');
    const bar = document.createElement('span');
    bar.className = 'ds-wbar';
    bar.innerHTML = WBAR.map(([act, label, title]) => `<button type="button" data-act="${act}" title="${title}">${label}</button>`).join('');
    w.appendChild(bar);
    addKaroGrips(w);
  }

  // Schreibfeld: am gewählten Feld ziehen – rechter Rand = Breite, unterer Rand =
  // Höhe, Ecke = beides; im 0,5-cm-Raster (wie die Karos). Breiter als 16,5 cm
  // geht für A4 quer; im Hochformat druckt der Renderer höchstens die Satzbreite.
  const GRIPS = { e: 'Breite ziehen', s: 'Höhe ziehen', se: 'Breite und Höhe ziehen' };
  function addKaroGrips(w) {
    const karo = w.querySelector('.ds-karo');
    if (blockOf(w)?.type !== 'karo' || !karo) return;
    for (const [dir, title] of Object.entries(GRIPS)) {
      const grip = document.createElement('span');
      grip.className = `ds-karo-grip ds-karo-grip-${dir}`;
      grip.dataset.grip = dir;
      grip.title = title;
      karo.appendChild(grip);
    }
  }
  surface.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest?.('.ds-karo-grip');
    if (!grip) return;
    e.preventDefault();
    e.stopPropagation();
    const w = grip.closest('.ds-widget');
    const karo = grip.closest('.ds-karo');
    const block = blockOf(w);
    if (!block || !karo) return;
    const dir = grip.dataset.grip;
    const lines = Number.isInteger(block.lines) ? block.lines : 4;
    const box = karo.getBoundingClientRect();
    // Bildschirm-Pixel je cm aus der Höhe des Felds – stimmt auch bei Zoom.
    const pxPerCm = box.height / (lines * 0.5);
    const step = (px) => Math.round((px / pxPerCm) * 2) / 2;
    const size = Object.assign(document.createElement('span'), { className: 'ds-karo-size' });
    karo.appendChild(size);
    // Ausgangsbreite: die gespeicherte – das Feld kann breiter sein als der sichtbare Editor.
    const startPx = parseFloat(block.width) > 0 ? parseFloat(block.width) * pxPerCm : box.width;
    let widthCm = block.width ? step(startPx) : null;
    let heightCm = lines * 0.5;
    const show = () => { size.textContent = `${widthCm ? `${String(widthCm).replace('.', ',')} cm` : 'ganze Breite'} × ${String(heightCm).replace('.', ',')} cm`; };
    show();
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (dir.includes('e')) {
        widthCm = Math.max(1, Math.min(KARO_MAX_WIDTH_CM, step(startPx + ev.clientX - e.clientX)));
        karo.style.width = `${widthCm}cm`;
        karo.style.maxWidth = '100%';
      }
      if (dir.includes('s')) {
        heightCm = Math.max(0.5, Math.min(30, step(box.height + ev.clientY - e.clientY)));
        karo.style.height = `${heightCm}cm`;
      }
      show();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      size.remove();
      const next = { ...block, lines: Math.max(1, Math.min(60, Math.round(heightCm * 2))) };
      if (widthCm) next.width = `${widthCm}cm`;
      const tmp = document.createElement('div');
      tmp.innerHTML = widgetHtml(next);
      const fresh = tmp.firstElementChild;
      selectWidget(null);
      w.replaceWith(fresh);
      selectWidget(fresh);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }, true);
  const cleanWidget = (w) => {
    const copy = w.cloneNode(true);
    copy.classList.remove('ds-widget-selected');
    copy.querySelector(':scope > .ds-wbar')?.remove();
    copy.querySelectorAll('.ds-karo-grip').forEach((g) => g.remove());
    return copy;
  };
  const blockOf = (w) => { try { return JSON.parse(decodeURIComponent(w.dataset.block)); } catch (_) { return null; } };
  const widgetAction = (act, w) => {
    if (act === 'up' && w.previousElementSibling) w.previousElementSibling.before(w);
    else if (act === 'down' && w.nextElementSibling) w.nextElementSibling.after(w);
    else if (act === 'dup') { const copy = cleanWidget(w); w.after(copy); selectWidget(copy); }
    else if (act === 'edit') editWidget(w);
    else if (act === 'del') { selectWidget(null); w.remove(); }
    w.scrollIntoView?.({ block: 'nearest' });
  };
  surface.addEventListener('click', (e) => {
    const btn = e.target.closest('.ds-wbar [data-act]');
    if (btn) { e.preventDefault(); widgetAction(btn.dataset.act, btn.closest('.ds-widget')); return; }
    const w = e.target.closest('.ds-widget');
    selectWidget(w && surface.contains(w) ? w : null);
  });
  const widgetKeysActive = () => mode === 'visual' && selectedWidget && surface.contains(selectedWidget)
    && !document.querySelector('.confirm-overlay:not(.hidden)') && (document.activeElement === surface || document.activeElement === document.body || surface.contains(document.activeElement));
  document.addEventListener('keydown', (e) => {
    if (!widgetKeysActive()) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); widgetAction('del', selectedWidget); }
    else if (e.key === 'Escape') selectWidget(null);
    else if (e.key === 'Enter') { e.preventDefault(); editWidget(selectedWidget); }
    else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); widgetAction('up', selectedWidget); }
    else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); widgetAction('down', selectedWidget); }
  });
  // Kopieren als YAML (`- type: …`) – passt so ins YAML-Feld und zurück.
  const copyWidget = (e, cut) => {
    if (!widgetKeysActive() || !window.getSelection()?.isCollapsed) return;
    const block = blockOf(selectedWidget);
    if (!block) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', yamlDump([block], { lineWidth: -1, noRefs: true }));
    if (cut) widgetAction('del', selectedWidget);
  };
  document.addEventListener('copy', (e) => copyWidget(e, false));
  document.addEventListener('cut', (e) => copyWidget(e, true));
  // Einfügen von YAML-Bausteinen (aus dem YAML-Feld oder kopiert): als Bausteine statt Text.
  surface.addEventListener('paste', (e) => {
    const text = (e.clipboardData?.getData('text/plain') || '').trim();
    if (!/^(- )?type: /.test(text)) return;
    let blocks;
    try { blocks = yamlLoad(text); } catch (_) { return; }
    if (blocks && !Array.isArray(blocks)) blocks = [blocks];
    if (!Array.isArray(blocks) || !blocks.length || validateDocSpec({ content: blocks }).length) return;
    e.preventDefault();
    const nodes = placeHtml(specToEditorHtml({ content: blocks }), currentBlock());
    const firstWidget = nodes.find((n) => n.classList?.contains('ds-widget'));
    selectWidget(firstWidget || null);
  });

  surface.addEventListener('dblclick', (e) => {
    const w = e.target.closest('.ds-widget');
    if (w && surface.contains(w)) editWidget(w);
  });

  // Fehlende Block-IDs nach der Position – wie die Striche der Schüler sie
  // bisher kennen (ids.js). Vor dem Vergleichsstand des Entwurfs, gilt also
  // nicht als Änderung.
  const initialSpec = Array.isArray(value?.content) ? structuredClone(value) : value;
  if (initialSpec !== value) stampBlockIds(initialSpec);
  textarea.value = toYaml(initialSpec);
  update();
  if (!Array.isArray(initialSpec?.content)) starterYaml = textarea.value;
  let initial = 'visual';
  try { initial = localStorage.getItem('lm_ds_mode') || 'visual'; } catch (_) { /* egal */ }
  setMode(initial === 'yaml' ? 'yaml' : 'visual');
  loadContext();
}

window.DocSpecEditor = { mount: mountDocSpecEditor };
