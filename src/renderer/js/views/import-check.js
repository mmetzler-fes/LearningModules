import { escapeHtml } from '../utils.js';
import { buildFixPrompt, extractJson, looksLikeDocMarkdown, looksLikeXml, markdownToTopic, summarizeImport } from '../json-text.js';
import { markdownToPm } from '../../lm-editor/src/doc/pm-markdown.js';
import { pmToSpec } from '../../lm-editor/src/doc/pm-convert.js';

// Text prüfen und importieren – für den Import-Dialog und das Antwortfeld im KI-Ablauf.

const list = (items) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;

/** Bekannte Modultypen mit Anzeigename. */
export function knownTypeNames() {
  return Object.fromEntries(Object.values(typeof H5P_TYPES !== 'undefined' ? H5P_TYPES : {})
    .map((t) => [t.id, `${t.icon || ''} ${t.name}`.trim()]));
}

/** Markdown → Thema; der Server bekommt dann das übliche JSON. */
export function topicFromMarkdown(text) {
  return markdownToTopic(text, (body) => {
    const warnings = [];
    return { spec: pmToSpec(markdownToPm(body, { warnings })), warnings };
  });
}

/**
 * Text prüfen. Ergebnis: { valid, kind ('ok' | 'warn' | 'error' | ''), html, fix }
 * – `fix` ist der Korrektur-Prompt für den KI-Chat, sonst null.
 */
export function checkAnswer(text, { docsOn = false, topicId = null, typeNames = knownTypeNames() } = {}) {
  if (!String(text || '').trim()) return { valid: false, kind: '', html: '', fix: null };
  if (looksLikeXml(text)) return { valid: true, kind: 'ok', html: '✅ Moodle-XML erkannt – wird beim Import in Module umgewandelt.', fix: null };
  const fromMd = docsOn && looksLikeDocMarkdown(text) ? topicFromMarkdown(text) : null;
  if (fromMd && !fromMd.ok) return { valid: false, kind: 'error', html: `❌ ${escapeHtml(fromMd.message)}`, fix: buildFixPrompt({ message: fromMd.message }) };
  const parsed = fromMd || extractJson(text);
  if (!parsed.ok) {
    const fix = buildFixPrompt(parsed);
    if (parsed.prose) {
      return { valid: false, kind: 'error', fix, html: '❌ <strong>Das ist Fließtext</strong> – die KI hat das verlangte Format nicht eingehalten, oder die Antwort wurde aus der fertigen Ansicht kopiert.'
        + ' Mit dem Korrektur-Prompt liefert der Chat dieselben Inhalte als Codeblock. Dann den Kopier-Knopf am Codeblock nutzen.' };
    }
    if (parsed.truncated) {
      return { valid: false, kind: 'error', fix, html: '❌ <strong>Unvollständig</strong> – der Text endet mitten im JSON. Vermutlich wurde die KI-Antwort abgeschnitten:'
        + ' den Rest nachfordern („weiter“) oder den Prompt mit weniger Modulen erzeugen.' };
    }
    const where = parsed.line ? ` in <strong>Zeile ${parsed.line}, Spalte ${parsed.column}</strong>` : '';
    const excerpt = parsed.line
      ? `<pre class="json-text-excerpt">${escapeHtml(parsed.excerpt)}\n${' '.repeat(Math.max(0, parsed.column - 1))}^</pre>`
      : '';
    return { valid: false, kind: 'error', fix, html: `❌ Kein gültiges JSON${where}: ${escapeHtml(parsed.message)}${excerpt}` };
  }
  const s = summarizeImport(parsed.data, typeNames);
  if (fromMd) s.warnings.push(...fromMd.warnings);
  if (s.problems.length) return { valid: false, kind: 'error', html: `❌ Gültiges JSON, aber so nicht importierbar:${list(s.problems)}`, fix: buildFixPrompt({ findings: s.problems }) };
  const fixed = parsed.repairs?.length ? `<p>🔧 Automatisch korrigiert: ${escapeHtml(parsed.repairs.join(', '))}.</p>` : '';
  const parts = parsed.parts > 1 ? ` (aus ${parsed.parts} Codeblöcken)` : '';
  const kinds = s.types.map((t) => `${t.n}× ${escapeHtml(t.name)}`).join(', ');
  return {
    valid: true,
    kind: s.warnings.length ? 'warn' : 'ok',
    fix: s.warnings.length ? buildFixPrompt({ findings: s.warnings }) : null,
    html: `✅ ${s.title && !topicId ? `Thema „${escapeHtml(s.title)}“ – ` : ''}${s.count} Modul${s.count === 1 ? '' : 'e'}${parts}: ${kinds}`
      + (s.ncRefs ? ` · ☁️ ${s.ncRefs} Bild${s.ncRefs === 1 ? '' : 'er'} aus deiner Nextcloud werden verknüpft` : '')
      + fixed
      + (s.warnings.length ? `<p>⚠️ Hinweise:</p>${list(s.warnings)}` : ''),
  };
}

/** Eingefügten Text importieren: Antwort des Servers, bei Fehlern eine Ausnahme. */
export async function importAnswer(app, text, { docsOn = false, topicId = null } = {}) {
  const form = new FormData();
  if (docsOn && looksLikeDocMarkdown(text)) {
    form.append('file', new Blob([JSON.stringify(topicFromMarkdown(text).data)], { type: 'application/json' }), 'markdown.json');
  } else {
    const xml = looksLikeXml(text);
    form.append('file', new Blob([text], { type: xml ? 'application/xml' : 'application/json' }), xml ? 'eingefuegt.xml' : 'eingefuegt.json');
  }
  if (topicId) form.append('topicId', topicId);
  const token = app.authStore.getToken();
  const res = await fetch('/api/interchange/import-json', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || data.error || 'Unbekannter Fehler');
  return data;
}

/** Die Dokumente einer Antwort: [{ title, spec }] – als Material für den nächsten Prompt. */
export function documentsInAnswer(text, { docsOn = false } = {}) {
  if (!docsOn || !looksLikeDocMarkdown(text)) return [];
  const topic = topicFromMarkdown(text);
  if (!topic.ok) return [];
  return topic.data.topic.modules.filter((m) => m.type === 'document').map((m) => ({ title: m.title, spec: m.content.spec }));
}
