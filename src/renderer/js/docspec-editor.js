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
import { htmlToDocSpec } from './docspec-html.js';

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
      <textarea class="ds-yaml" spellcheck="false" aria-label="Inhalt als YAML"></textarea>
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
        body: JSON.stringify({ spec, title, output, ...(moduleId ? { moduleId } : {}) }),
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

  textarea.value = toYaml(value);
  update();
  loadContext();
}

window.DocSpecEditor = { mount: mountDocSpecEditor };
