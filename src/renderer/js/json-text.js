/**
 * Eingefügten bzw. hochgeladenen Importtext lesen und prüfen – dieselbe
 * Logik für den Import-Dialog (views/import-dialog.js, Vorabprüfung) und
 * den Server (import.service.ts lädt diese Datei, siehe browser-module.ts).
 * Ohne DOM und ohne Importe.
 */

/** Noch offene { bzw. [ am Textende (außerhalb von Strings) – > 0 heißt abgeschnitten. */
export function openBraces(text) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth + (inString ? 1 : 0);
}

/** Zeile und Spalte (ab 1) einer Stelle im Text. */
export function lineColumn(text, pos) {
  const before = text.slice(0, Math.max(0, pos));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Stelle des Fehlers aus der Meldung von JSON.parse: Chrome und Node nennen
 * "position 123", Firefox "line 3 column 5". Ergebnis: Index im Text oder -1.
 */
function errorIndex(message, text) {
  const pos = /position (\d+)/.exec(message);
  if (pos) return Number(pos[1]);
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (!lc) return -1;
  const lines = text.split('\n');
  let index = 0;
  for (let i = 0; i < Number(lc[1]) - 1 && i < lines.length; i++) index += lines[i].length + 1;
  return index + Number(lc[2]) - 1;
}

/**
 * JSON aus einem Text holen. KI-Antworten werden oft samt Markdown-Rahmen
 * eingefügt (```json … ```) und mit Text davor oder danach („Teil 1 von 3 …“);
 * dann zählt nur der Codeblock bzw. das JSON-Objekt darin.
 *
 * Ergebnis: { ok: true, data } oder { ok: false, truncated, message, line,
 * column, excerpt } – Zeile und Spalte beziehen sich auf den ganzen Text,
 * so wie er im Eingabefeld steht.
 */
export function extractJson(text) {
  const raw = String(text || '').replace(/^﻿/, '');
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/i.exec(raw);
  const start = raw.indexOf('{');
  const body = fenced ? fenced[1] : start > 0 ? raw.slice(start) : raw;
  const candidates = [body, body.slice(0, body.lastIndexOf('}') + 1)];
  let firstError = null;
  for (const candidate of candidates) {
    try {
      return { ok: true, data: JSON.parse(candidate) };
    } catch (e) {
      if (!firstError) firstError = e;
    }
  }
  const truncated = openBraces(body) > 0;
  const message = String((firstError && firstError.message) || 'Ungültiges JSON');
  const at = errorIndex(message, body);
  // Die Stelle steht gleich als Zeile/Spalte des ganzen Texts daneben – die
  // des Browsers zählt nur im JSON-Teil und würde dem widersprechen.
  const clean = message
    .replace(/\s*(in JSON )?at position \d+( \(line \d+ column \d+\))?/, '')
    .replace(/\s*at line \d+ column \d+ of the JSON data/, '')
    .replace(/^JSON\.parse: /, '');
  if (at < 0) return { ok: false, truncated, message: clean, line: 0, column: 0, excerpt: '' };
  const offset = fenced ? fenced.index + fenced[0].indexOf(fenced[1]) : start > 0 ? start : 0;
  const { line, column } = lineColumn(raw, offset + at);
  return { ok: false, truncated, message: clean, line, column, excerpt: raw.split('\n')[line - 1] || '' };
}

/** Sieht der Text nach Moodle-XML aus? Das liest der Import ebenfalls. */
export function looksLikeXml(text) {
  return /^\s*(<\?xml|<quiz[\s>])/i.test(String(text || '').replace(/^﻿/, ''));
}

// ==================== Dokument als Markdown (Antwort einer KI, .md-Datei) ====================

/** Den Rahmen ````markdown … ```` und Text davor oder danach entfernen. */
export function unwrapMarkdown(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const open = /^[ \t]*(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*$/im.exec(raw);
  if (open) {
    const fence = open[1];
    const rest = raw.slice(open.index + open[0].length + 1);
    // Der letzte Rahmen zählt: Auch mit zu kurzem Rahmen stehen Codeblöcke im Blatt davor.
    const closers = [...rest.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*$/gm)].filter((m) => m[1][0] === fence[0] && m[1].length >= fence.length);
    const last = closers[closers.length - 1];
    return last ? rest.slice(0, last.index).replace(/\n$/, '') : rest;
  }
  const head = /^---[ \t]*\n(?:title|titel):/m.exec(raw);
  return head ? raw.slice(head.index) : raw;
}

/** Ist der Text ein Dokument in Markdown (und nicht ein Thema als JSON)? */
export function looksLikeDocMarkdown(text) {
  const raw = String(text || '');
  if (!raw.trim() || looksLikeXml(raw)) return false;
  const body = unwrapMarkdown(raw);
  if (body !== raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') || /^---[ \t]*\n/.test(body)) return true;
  const json = extractJson(raw);
  if (json.ok && json.data && typeof json.data === 'object' && (json.data.topic || json.data.modules)) return false;
  return !/^\s*(?:\{|```json)/i.test(raw) && /^(?:#{1,6} |:::)/m.test(body);
}

/**
 * Markdown → Thema im Import-Format: Das Dokument wird ein Modul, ```lm-quiz-Blöcke
 * (JSON) werden Module dahinter. `toDoc(text)` liefert { spec, warnings } – diese
 * Datei importiert nichts, den Parser (lm-editor) gibt der Aufrufer mit.
 * Ergebnis: { ok: true, data, warnings } oder { ok: false, message }.
 */
export function markdownToTopic(text, toDoc) {
  const quiz = [];
  let failed = '';
  const body = unwrapMarkdown(text).replace(/^(`{3,})lm-quiz[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm, (_m, _f, json) => {
    try { quiz.push(...[].concat(JSON.parse(json))); } catch (e) { failed = failed || String(e.message); }
    return '';
  });
  if (failed) return { ok: false, message: `Ein lm-quiz-Block ist kein gültiges JSON: ${failed}` };
  const { spec, warnings = [] } = toDoc(body);
  const { title, titel, description, kind, slug, ...rest } = spec;
  const first = rest.content.find((b) => b.type === 'section' || b.type === 'heading');
  const name = String(title || titel || first?.text || 'Dokument');
  const content = { kind: ['arbeitsblatt', 'klassenarbeit', 'text'].includes(kind) ? kind : 'arbeitsblatt', ...(slug ? { slug: String(slug) } : {}), spec: rest };
  const modules = [
    { title: name, type: 'document', description: '', orderIndex: 0, content },
    ...quiz.map((m, i) => ({ description: '', ...m, orderIndex: i + 1 })),
  ];
  return { ok: true, warnings, data: { topic: { title: name, description: String(description || ''), modules } } };
}

/**
 * Aufbau eines gelesenen Themas prüfen. `typeNames`: { typ: Anzeigename } der
 * bekannten Modultypen. `problems` verhindern den Import, `warnings` nicht.
 */
export function summarizeImport(data, typeNames = {}) {
  const topic = data && typeof data === 'object' && data.topic && typeof data.topic === 'object' ? data.topic : null;
  const modules = topic ? topic.modules : data && Array.isArray(data.modules) ? data.modules : null;
  const problems = [];
  const warnings = [];
  if (!Array.isArray(modules) || !modules.length) {
    problems.push('Keine Module gefunden – erwartet wird {"topic": {"title": …, "modules": [ … ]}}.');
  }
  const counts = new Map();
  (Array.isArray(modules) ? modules : []).forEach((m, i) => {
    const label = `Modul ${i + 1}${m && m.title ? ` („${m.title}“)` : ''}`;
    if (!m || typeof m !== 'object' || Array.isArray(m)) { problems.push(`${label}: ist kein Objekt.`); return; }
    if (!m.type) problems.push(`${label}: "type" fehlt.`);
    else if (!typeNames[m.type]) warnings.push(`${label}: unbekannter Typ "${m.type}" – lässt sich so nicht öffnen.`);
    if (m.content === undefined || m.content === null) warnings.push(`${label}: "content" fehlt.`);
    else if (typeof m.content !== 'object') warnings.push(`${label}: "content" ist kein Objekt.`);
    if (!m.title) warnings.push(`${label}: ohne Titel.`);
    if (m.type) counts.set(m.type, (counts.get(m.type) || 0) + 1);
  });
  // Bilder aus dem KI-Prompt ("nc:<Ordner>/<Datei>"), die der Import verknüpft.
  let ncRefs = 0;
  const walk = (v) => {
    if (typeof v === 'string') { if (/^nc:[^/]+\/[^/]+$/.test(v.trim())) ncRefs++; }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  (Array.isArray(modules) ? modules : []).forEach((m) => walk(m && m.content));
  return {
    title: (topic && topic.title) || '',
    count: Array.isArray(modules) ? modules.length : 0,
    ncRefs,
    types: [...counts].map(([type, n]) => ({ type, n, name: typeNames[type] || type })),
    problems,
    warnings,
  };
}
