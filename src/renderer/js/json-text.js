/**
 * Eingefügten bzw. hochgeladenen Importtext lesen und prüfen – dieselbe
 * Logik für den Dialog „JSON-Text importieren“ (Vorabprüfung im Browser) und
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
  return {
    title: (topic && topic.title) || '',
    count: Array.isArray(modules) ? modules.length : 0,
    types: [...counts].map(([type, n]) => ({ type, n, name: typeNames[type] || type })),
    problems,
    warnings,
  };
}
