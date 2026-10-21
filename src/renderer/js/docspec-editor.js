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
import { validateDocSpec, renderDocSpecHtml, docRefSlugs } from './docspec.js';
import { downloadBlob } from './api.js';
import { escapeHtml } from './utils.js';
import { htmlToDocSpec, specToEditorHtml, widgetHtml } from './docspec-html.js';

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
      ${OUTPUTS.map((o) => `<button type="button" class="btn btn-secondary btn-sm" data-output="${o.output}" title="${o.title}">${o.label}</button>`).join('')}
      <label class="ds-editor-toggle"><input type="checkbox" class="ds-show-solutions"> Lösungen zeigen</label>
      <button type="button" class="btn btn-secondary btn-sm ds-import-odt" title="Writer-Dokument übernehmen: Überschriften, Absätze, Listen, Tabellen, Bilder, Textrahmen">📄 Aus .odt übernehmen</button>
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
            <select class="ds-vblock" title="Absatzart">
              <option value="p">Text</option><option value="section">Abschnitt (1.)</option><option value="task">Aufgabe (1.1)</option>
              <option value="subtask">Teilaufgabe (1.1.1)</option><option value="heading">Überschrift ohne Nummer</option><option value="note">Hinweis</option>
            </select>
            ${[['bold', '<b>F</b>', 'Fett'], ['italic', '<i>K</i>', 'Kursiv'], ['underline', '<u>U</u>', 'Unterstrichen'], ['strikeThrough', '<s>D</s>', 'Durchgestrichen'],
              ['superscript', 'x²', 'Hochgestellt'], ['subscript', 'x₂', 'Tiefgestellt'], ['insertUnorderedList', '•', 'Aufzählung'], ['insertOrderedList', '1.', 'Nummerierung'],
              ['justifyLeft', '⇤', 'Linksbündig'], ['justifyCenter', '↔', 'Zentriert'], ['justifyRight', '⇥', 'Rechtsbündig'], ['createLink', '🔗', 'Link']]
              .map(([cmd, label, title]) => `<button type="button" class="rt-btn" data-cmd="${cmd}" title="${title}">${label}</button>`).join('')}
            <select class="ds-vinsert" title="Baustein einfügen">
              <option value="">➕ Einfügen …</option><option value="karo">Karo</option><option value="solution">Lösung</option>
              <option value="formula">Formel</option><option value="code">Code</option><option value="table">Tabelle</option>
              <option value="box">Kasten</option><option value="spacer">Platz</option><option value="pagebreak">Seitenumbruch</option>
            </select>
          </div>
          <div class="ds-surface worksheet-content" contenteditable="true" spellcheck="true" aria-label="Inhalt bearbeiten"></div>
          <p class="hint">Bausteine (grau) per Doppelklick bearbeiten. Lösungen folgen auf ein Karo und erscheinen im Lösungsblatt darüber.</p>
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
    hidden.value = JSON.stringify(spec);
    const errors = validateDocSpec(spec);
    const missing = ctx?.refs ? docRefSlugs(spec).filter((s) => !ctx.refs[s]) : [];
    errorsEl.innerHTML = errors.map((e) => `<p class="ds-error">⚠️ ${escapeHtml(e)}</p>`).join('')
      + (missing.length ? `<p class="ds-error">⚠️ Verweis auf fehlende Blätter: ${escapeHtml(missing.join(', '))}</p>` : '');
    preview.innerHTML = renderDocSpecHtml(spec, { showSolutions: showSolutions.checked, showPageBreaks: true, refs: ctx?.refs || undefined });
  };

  let timer = null;
  textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 250); });
  // Tab rückt ein, statt das Feld zu verlassen – YAML lebt von Einrückung.
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input'));
  });
  showSolutions.addEventListener('change', update);

  root.querySelector('.ds-import-odt').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.odt,.ott,.fodt,application/vnd.oasis.opendocument.text';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const ask = window.appConfirm || ((m) => Promise.resolve(window.confirm(m)));
      const empty = !spec || !Array.isArray(spec.content) || !spec.content.length || textarea.value === STARTER;
      if (!empty && !(await ask('Den bisherigen Inhalt durch das Dokument ersetzen?'))) return;
      status.textContent = 'Wird übernommen …';
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/interchange/odt-to-html', { method: 'POST', headers: token() ? { Authorization: `Bearer ${token()}` } : {}, body: form });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
        const { spec: imported, warnings } = htmlToDocSpec(data.html);
        textarea.value = toYaml(imported);
        if (titleInput && !titleInput.value.trim()) titleInput.value = data.title || '';
        update();
        const all = [...(data.warnings || []), ...warnings];
        status.innerHTML = `✅ Übernommen: ${imported.content.length} Blöcke.` + (all.length ? ` ${all.map((w) => `⚠️ ${escapeHtml(w)}`).join(' ')}` : '');
      } catch (err) {
        status.textContent = `❌ Übernahme fehlgeschlagen: ${err.message}`;
      }
    };
    input.click();
  });

  for (const btn of root.querySelectorAll('[data-output]')) {
    btn.addEventListener('click', () => print(btn.dataset.output, btn));
  }

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
        body: JSON.stringify({ spec, title, output, kind: document.querySelector('select[name="content_kind"]')?.value, ...(moduleId ? { moduleId } : {}) }),
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
  const surface = root.querySelector('.ds-surface');
  const blockSelect = root.querySelector('.ds-vblock');
  let mode = 'yaml';
  let syncing = false;
  let vTimer = null;

  const fromVisual = () => {
    const { spec: next } = htmlToDocSpec(surface.innerHTML);
    textarea.value = toYaml(next);
    update();
  };
  new MutationObserver(() => {
    if (syncing || mode !== 'visual') return;
    clearTimeout(vTimer);
    vTimer = setTimeout(fromVisual, 300);
  }).observe(surface, { childList: true, subtree: true, characterData: true, attributes: true });
  if (typeof window.WorksheetImageTools !== 'undefined') {
    new window.WorksheetImageTools(surface, document.createElement('input'), root.querySelector('.ds-vtoolbar'));
  }

  const setMode = (next) => {
    if (next === 'visual') {
      update();
      try { yamlLoad(textarea.value); } catch (_) { status.textContent = 'Erst den YAML-Fehler beheben, dann umschalten.'; return; }
      syncing = true;
      surface.innerHTML = specToEditorHtml(spec || { content: [] });
      syncing = false;
    } else if (mode === 'visual') {
      clearTimeout(vTimer);
      fromVisual();
    }
    mode = next;
    visual.hidden = mode !== 'visual';
    textarea.hidden = mode !== 'yaml';
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    try { localStorage.setItem('lm_ds_mode', mode); } catch (_) { /* egal */ }
  };
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /** Block-Element der Schreibmarke (direktes Kind der Fläche bzw. eines Kastens). */
  const currentBlock = () => {
    const sel = window.getSelection();
    let n = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    if (n && n.nodeType === 3) n = n.parentNode;
    while (n && n !== surface && !(n.parentNode === surface || n.parentNode?.classList?.contains('ws-box'))) n = n.parentNode;
    return n && n !== surface ? n : null;
  };
  document.addEventListener('selectionchange', () => {
    if (mode !== 'visual' || !surface.contains(document.getSelection()?.anchorNode)) return;
    const b = currentBlock();
    blockSelect.value = b?.dataset?.ds && b.dataset.ds !== 'note' ? b.dataset.ds : b?.dataset?.ds === 'note' ? 'note' : 'p';
  });
  blockSelect.addEventListener('change', () => {
    const b = currentBlock();
    if (!b || !/^(P|H[1-6]|DIV)$/.test(b.tagName) || b.classList.contains('ds-widget') || b.classList.contains('ws-box')) return;
    const kind = blockSelect.value;
    const tag = { p: 'p', note: 'p', section: 'h2', task: 'h3', subtask: 'h4', heading: 'h2' }[kind];
    const el = document.createElement(tag);
    if (kind !== 'p') el.dataset.ds = kind;
    const inner = b.dataset.ds === 'note' && b.firstElementChild?.tagName === 'EM' ? b.firstElementChild.innerHTML : b.innerHTML;
    el.innerHTML = kind === 'note' ? `<em>${inner}</em>` : inner;
    b.replaceWith(el);
    surface.focus();
  });
  root.querySelectorAll('[data-cmd]').forEach((btn) => btn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Auswahl in der Fläche behalten
    const cmd = btn.dataset.cmd;
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
    spacer: { type: 'spacer', lines: 3 },
    pagebreak: { type: 'pagebreak' },
  };
  root.querySelector('.ds-vinsert').addEventListener('change', (e) => {
    const what = e.target.value;
    e.target.value = '';
    if (!what) return;
    const html = what === 'table' ? '<table><thead><tr><th>Spalte 1</th><th>Spalte 2</th></tr></thead><tbody><tr><td>…</td><td>…</td></tr></tbody></table>'
      : what === 'box' ? '<div class="ws-box" data-title="Merke"><p>…</p></div>'
        : widgetHtml(STARTERS[what]);
    const tmp = document.createElement('div');
    tmp.innerHTML = `${html}<p><br></p>`;
    const after = currentBlock();
    const nodes = [...tmp.childNodes];
    if (after) after.after(...nodes); else surface.append(...nodes);
    if (what in STARTERS && what !== 'pagebreak') editWidget(nodes[0]);
  });

  /** Baustein als YAML bearbeiten. */
  const editWidget = (w) => {
    let block;
    try { block = JSON.parse(decodeURIComponent(w.dataset.block)); } catch (_) { return; }
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `<form class="import-modules-card ds-widget-dialog">
        <h3>Baustein bearbeiten</h3>
        <textarea class="ds-yaml" rows="12" spellcheck="false"></textarea>
        <p class="ds-error"></p>
        <div class="confirm-actions">
          <button type="submit" class="btn btn-primary">Übernehmen</button>
          <button type="button" class="btn btn-danger ds-w-del">Entfernen</button>
          <button type="button" class="btn btn-secondary ds-w-cancel">Abbrechen</button>
        </div></form>`;
    document.body.appendChild(overlay);
    const ta = overlay.querySelector('textarea');
    ta.value = yamlDump(block, { lineWidth: -1, noRefs: true });
    ta.focus();
    const close = () => overlay.remove();
    overlay.querySelector('.ds-w-cancel').addEventListener('click', close);
    overlay.querySelector('.ds-w-del').addEventListener('click', () => { w.remove(); close(); });
    overlay.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      let next;
      try { next = yamlLoad(ta.value); } catch (err) { overlay.querySelector('.ds-error').textContent = `YAML: ${err.reason || err.message}`; return; }
      const errs = validateDocSpec({ content: [next] });
      if (errs.length) { overlay.querySelector('.ds-error').textContent = errs.join(' · '); return; }
      const tmp = document.createElement('div');
      tmp.innerHTML = widgetHtml(next);
      w.replaceWith(tmp.firstElementChild);
      close();
    });
  };
  surface.addEventListener('dblclick', (e) => {
    const w = e.target.closest('.ds-widget');
    if (w && surface.contains(w)) editWidget(w);
  });

  textarea.value = toYaml(value);
  update();
  let initial = 'visual';
  try { initial = localStorage.getItem('lm_ds_mode') || 'visual'; } catch (_) { /* egal */ }
  setMode(initial === 'yaml' ? 'yaml' : 'visual');
  loadContext();
}

window.DocSpecEditor = { mount: mountDocSpecEditor };
