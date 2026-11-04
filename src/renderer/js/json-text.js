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

// LaTeX-Befehle, die mit \n, \r oder \t beginnen: in JSON wären das still Zeilenumbruch und Tabulator.
const LATEX_NRT = new Set(['neq', 'ne', 'nu', 'not', 'nabla', 'ni', 'notin', 'nmid', 'nearrow', 'nwarrow', 'newline', 'rightarrow',
  'Rightarrow', 'right', 'rho', 'rangle', 'rceil', 'rfloor', 'rm', 'text', 'textbf', 'textit', 'times', 'theta', 'tau', 'tan', 'tanh', 'to',
  'tilde', 'top', 'triangle', 'triangleq', 'tfrac', 'tt']);

/** Steht nach dem Backslash ein LaTeX-Befehl statt eines JSON-Escapes? */
function isLatexEscape(text, i) {
  const word = /^[a-zA-Z]+/.exec(text.slice(i, i + 16));
  if (!word) return false;
  const c = word[0][0];
  if (c === 'f' || c === 'b') return word[0].length > 1; // \frac, \beta: Seitenvorschub im Text kommt nicht vor
  return (c === 'n' || c === 'r' || c === 't') && LATEX_NRT.has(word[0]);
}

/**
 * Was KIs an JSON falsch machen, reparieren: Kommentare, Komma am Ende,
 * typografische Anführungszeichen als Begrenzer, Zeilenumbrüche und
 * Anführungszeichen in Texten, LaTeX mit einfachem Backslash.
 * Gültiges JSON bleibt gleich – bis auf einfache Backslashes vor LaTeX-Befehlen.
 * Ergebnis: { text, repairs } mit `repairs` als Liste lesbarer Hinweise.
 */
export function repairJson(text) {
  const src = String(text);
  const found = new Set();
  let out = '';
  let close = ''; // Zeichen, die den offenen Text beenden; leer = außerhalb eines Texts
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!close) {
      if (c === '/' && src[i + 1] === '/') { const end = src.indexOf('\n', i); i = end < 0 ? src.length : end - 1; found.add('Kommentare entfernt'); continue; }
      if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 1; found.add('Kommentare entfernt'); continue; }
      if (c === ',' && /^\s*(?:\/\/[^\n]*\s*)*[}\]]/.test(src.slice(i + 1, i + 400))) { found.add('Komma am Ende einer Liste entfernt'); continue; }
      if (c === '"') { close = '"'; out += c; continue; }
      if (c === '“' || c === '„' || c === '”') { close = '”“'; out += '"'; found.add('Typografische Anführungszeichen als Begrenzer ersetzt'); continue; }
      out += c;
      continue;
    }
    if (c === '\\') {
      const next = src[i + 1];
      if (next === '"' || next === '\\' || next === '/') { out += c + next; i++; continue; }
      if (next === 'u' && /^[0-9a-fA-F]{4}/.test(src.slice(i + 2, i + 6))) { out += c; continue; }
      if ('bfnrt'.includes(next) && !isLatexEscape(src, i + 1)) { out += c; continue; }
      out += '\\\\'; // \frac, \sigma, \_ …: ein wörtlicher Backslash
      found.add('Backslashes in Formeln verdoppelt');
      continue;
    }
    if (close.includes(c)) {
      // Ein gerades " beendet den Text nur, wenn danach die Struktur weitergeht.
      if (c === '"' && !/^\s*(?:[,}\]:]|\/\/|\/\*|$)/.test(src.slice(i + 1, i + 200))) {
        out += '\\"';
        found.add('Anführungszeichen im Text geschützt');
        continue;
      }
      out += '"';
      close = '';
      continue;
    }
    if (c === '\n' || c === '\r' || c === '\t') {
      if (c === '\r' && src[i + 1] === '\n') continue;
      out += c === '\t' ? '\\t' : '\\n';
      found.add('Zeilenumbrüche im Text geschützt');
      continue;
    }
    out += c;
  }
  return { text: out, repairs: [...found] };
}

/** JSON-Text lesen, notfalls repariert. Ergebnis: { ok, data, repairs } oder { ok: false, error }. */
function parseLoose(body) {
  const candidates = [body, body.slice(0, body.lastIndexOf('}') + 1)];
  let error = null;
  for (const candidate of candidates) {
    // Auch gültiges JSON: "\frac" wäre sonst still ein Seitenvorschub plus „rac“.
    let strict;
    let parsedStrict = false;
    try { strict = JSON.parse(candidate); parsedStrict = true; } catch (e) { error = error || e; }
    if (parsedStrict && !/\\[bfnrt][a-zA-Z]/.test(candidate)) return { ok: true, data: strict, repairs: [] };
    const fixed = repairJson(candidate);
    try { return { ok: true, data: JSON.parse(fixed.text), repairs: fixed.repairs }; } catch (e) { error = error || e; }
    if (parsedStrict) return { ok: true, data: strict, repairs: [] };
  }
  return { ok: false, error };
}

const modulesOf = (d) => (d && d.topic && Array.isArray(d.topic.modules) ? d.topic.modules : d && Array.isArray(d.modules) ? d.modules : null);

/** Teile einer Antwort zu einem Thema zusammenführen: Angaben vom ersten, Module von allen. */
function mergeTopics(list) {
  const modules = list.flatMap(modulesOf);
  const first = list[0];
  return first.topic ? { ...first, topic: { ...first.topic, modules } } : { ...first, modules };
}

/**
 * JSON aus einem Text holen. KI-Antworten werden oft samt Markdown-Rahmen
 * eingefügt (```json … ```) und mit Text davor oder danach („Teil 1 von 3 …“);
 * dann zählt das JSON darin. Mehrere Codeblöcke mit Modulen werden zusammengeführt,
 * kleine Syntaxfehler repariert (repairJson).
 *
 * Ergebnis: { ok: true, data, repairs, parts } oder { ok: false, prose, truncated,
 * message, line, column, excerpt } – Zeile und Spalte beziehen sich auf den
 * ganzen Text, so wie er im Eingabefeld steht. `prose`: Fließtext, kein Format.
 */
export function extractJson(text) {
  const raw = String(text || '').replace(/^﻿/, '');
  const blocks = [];
  const fences = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/gi;
  let lastEnd = 0;
  for (let m = fences.exec(raw); m; m = fences.exec(raw)) {
    blocks.push({ body: m[1], offset: m.index + m[0].indexOf(m[1]) });
    lastEnd = fences.lastIndex;
  }
  // Ein offener Codeblock hinter geschlossenen: abgeschnittener letzter Teil.
  if (blocks.length) {
    const open = /```(?:json)?\s*\n/i.exec(raw.slice(lastEnd));
    if (open) blocks.push({ body: raw.slice(lastEnd + open.index + open[0].length), offset: lastEnd + open.index + open[0].length });
  }
  if (!blocks.length) {
    // Das erste { eines Objekts – nicht das aus \underline{…} im Fließtext davor.
    const object = /\{\s*["“„]/.exec(raw);
    const start = object ? object.index : raw.indexOf('{');
    if (!object && !/^\s*[{[]/.test(raw)) {
      return { ok: false, prose: true, truncated: false, message: 'Fließtext statt des verlangten Formats', line: 0, column: 0, excerpt: '' };
    }
    blocks.push({ body: start > 0 ? raw.slice(start) : raw, offset: start > 0 ? start : 0 });
  }
  const results = [];
  const repairs = new Set();
  for (const { body, offset } of blocks) {
    const res = parseLoose(body);
    if (res.ok) {
      res.repairs.forEach((r) => repairs.add(r));
      results.push(res.data);
      continue;
    }
    const truncated = openBraces(body) > 0;
    const message = String((res.error && res.error.message) || 'Ungültiges JSON');
    const at = errorIndex(message, body);
    // Die Stelle steht gleich als Zeile/Spalte des ganzen Texts daneben – die
    // des Browsers zählt nur im JSON-Teil und würde dem widersprechen.
    const clean = message
      .replace(/\s*(in JSON )?at position \d+( \(line \d+ column \d+\))?/, '')
      .replace(/\s*at line \d+ column \d+ of the JSON data/, '')
      .replace(/^JSON\.parse: /, '');
    if (at < 0) return { ok: false, truncated, message: clean, line: 0, column: 0, excerpt: '' };
    const { line, column } = lineColumn(raw, offset + at);
    return { ok: false, truncated, message: clean, line, column, excerpt: raw.split('\n')[line - 1] || '' };
  }
  const withModules = results.filter(modulesOf);
  const data = withModules.length > 1 ? mergeTopics(withModules) : withModules[0] || results[0];
  return { ok: true, data, repairs: [...repairs], parts: Math.max(withModules.length, 1) };
}

/** Sieht der Text nach Moodle-XML aus? Das liest der Import ebenfalls. */
export function looksLikeXml(text) {
  return /^\s*(<\?xml|<quiz[\s>])/i.test(String(text || '').replace(/^﻿/, ''));
}

// ==================== Dokument als Markdown (Antwort einer KI, .md-Datei) ====================

/** Rahmen ````markdown … ```` entfernen: { body, before, after, truncated } – truncated: nie geschlossen. */
function splitMarkdownFrame(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const open = /^[ \t]*(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*$/im.exec(raw);
  if (open) {
    const fence = open[1];
    const from = open.index + open[0].length + 1;
    const rest = raw.slice(from);
    // Der letzte Rahmen zählt: Auch mit zu kurzem Rahmen stehen Codeblöcke im Blatt davor.
    const closers = [...rest.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*$/gm)].filter((m) => m[1][0] === fence[0] && m[1].length >= fence.length);
    const last = closers[closers.length - 1];
    if (!last) return { body: rest, before: raw.slice(0, open.index), after: '', truncated: true };
    return { body: rest.slice(0, last.index).replace(/\n$/, ''), before: raw.slice(0, open.index), after: rest.slice(last.index + last[0].length), truncated: false };
  }
  const head = /^---[ \t]*\n(?:title|titel):/m.exec(raw);
  return { body: head ? raw.slice(head.index) : raw, before: head ? raw.slice(0, head.index) : '', after: '', truncated: false };
}

/** Den Rahmen ````markdown … ```` und Text davor oder danach entfernen. */
export function unwrapMarkdown(text) {
  return splitMarkdownFrame(text).body;
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
  const repairs = new Set();
  let failed = '';
  const frame = splitMarkdownFrame(text);
  const isQuiz = (v) => [].concat(v).every((m) => m && typeof m === 'object' && m.type && m.content);
  // Quiz-Blöcke zählen überall: im Rahmen, dahinter, eingerückt, auch als ```json.
  const takeQuiz = (part) => part.replace(/^[ \t]*(`{3,})(lm-quiz|json)[ \t]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm, (m, _f, lang, json) => {
    const res = parseLoose(json);
    if (!res.ok) {
      if (lang === 'lm-quiz') failed = failed || String(res.error && res.error.message);
      return lang === 'lm-quiz' ? '' : m;
    }
    if (lang === 'json' && !isQuiz(res.data)) return m;
    res.repairs.forEach((r) => repairs.add(r));
    quiz.push(...[].concat(res.data));
    return '';
  });
  const body = takeQuiz(frame.body);
  takeQuiz(frame.before);
  takeQuiz(frame.after);
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
  const notes = [...warnings];
  if (frame.truncated) notes.unshift('Der Rahmen um den Text wird nie geschlossen – die Antwort wurde vermutlich abgeschnitten. Prüfe das Ende des Dokuments.');
  if (/^[ \t]*(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*$/im.test(body)) notes.unshift('Die Antwort enthält mehrere Blätter in einem Text – sie landen so in einem Dokument. Besser je Blatt eine Antwort.');
  if (repairs.size) notes.push(`Quiz-Blöcke automatisch korrigiert: ${[...repairs].join(', ')}.`);
  return { ok: true, warnings: notes, data: { topic: { title: name, description: String(description || ''), modules } } };
}

/** Lücken bzw. Lösungswörter stehen in *Sternchen*. */
const hasStars = (v) => /\*[^*\s][^*]*\*/.test(String(v || ''));
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * Inhalt eines Moduls je Typ prüfen: Was fehlt, damit die Aufgabe lösbar ist?
 * Nur Hinweise, kein Hindernis: Auch eigene Exporte mit Entwürfen kommen hier durch.
 */
export function contentIssues(type, c) {
  if (!c || typeof c !== 'object') return [];
  switch (type) {
    case 'multipleChoice': {
      const out = [];
      if (!String(c.question || '').trim()) out.push('die Frage fehlt');
      const answers = list(c.answers);
      if (answers.length < 2) out.push('weniger als zwei Antworten');
      else if (!answers.some((a) => a && (a.correct === true || a.correct === 'true'))) out.push('keine richtige Antwort markiert');
      return out;
    }
    case 'trueFalse': {
      const qs = list(c.questions);
      if (!qs.length) return ['keine Aussagen'];
      return qs.some((q) => !q || !['true', 'false'].includes(String(q.correctAnswer))) ? ['"correctAnswer" muss "true" oder "false" sein'] : [];
    }
    case 'fillInTheBlanks': {
      const qs = list(c.questions);
      if (!qs.length) return ['keine Texte'];
      return qs.some((q) => !q || !hasStars(q.text)) ? ['ein Text hat keine Lücke in *Sternchen*'] : [];
    }
    case 'dragTheWords':
    case 'markTheWords':
      return hasStars(c.textField) ? [] : ['keine Wörter in *Sternchen* im Text'];
    case 'dragAndDrop':
      return list(c.dropZones).length && list(c.draggables).length ? [] : ['Zonen oder Elemente fehlen'];
    case 'formula':
      return list(c.results).some((r) => r && r.formula) ? [] : ['keine Ergebnisformel'];
    case 'sorting':
      return list(c.items).length >= 2 ? [] : ['weniger als zwei Elemente'];
    case 'crossword':
      return list(c.words).length >= 2 ? [] : ['weniger als zwei Wörter'];
    case 'memory':
      return list(c.pairs).length >= 2 ? [] : ['weniger als zwei Paare'];
    default:
      return [];
  }
}

/**
 * Text für den KI-Chat, wenn eine Antwort nicht passt. Der Chat kennt Prompt und
 * Inhalt schon und muss nur das Format nachliefern.
 * @param o { prose, truncated, line, message, excerpt, findings: [Text] }
 */
export function buildFixPrompt(o = {}) {
  const again = 'Deine gesamte Antwort ist genau ein Codeblock im Format aus meiner ersten Nachricht: kein Text davor oder danach, keine Erklärung, kein Dokument-Fenster (Canvas).';
  if (o.prose) return `Deine Antwort hatte nicht das verlangte Format und lässt sich so nicht einlesen. Sie wird maschinell gelesen, nicht von Menschen.\nGib dieselben Inhalte unverändert noch einmal aus. ${again}`;
  if (o.truncated) return `Deine Antwort wurde abgeschnitten und ist deshalb unbrauchbar.\nGib sie vollständig neu aus, aber kürzer: nur so viel, wie sicher in eine Antwort passt, den Rest im nächsten Teil auf „weiter“. ${again}`;
  const lines = ['Deine Antwort lässt sich nicht einlesen. Korrigiere genau diese Punkte und ändere sonst nichts:'];
  if (o.message) lines.push(`- Syntaxfehler${o.line ? ` in Zeile ${o.line}` : ''}: ${o.message}${o.excerpt ? `\n  Stelle: ${String(o.excerpt).trim().slice(0, 160)}` : ''}`);
  for (const f of o.findings || []) lines.push(`- ${f}`);
  lines.push(`Gib danach die vollständige Antwort neu aus. ${again}`);
  return lines.join('\n');
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
    contentIssues(m.type, m.content).forEach((issue) => warnings.push(`${label}: ${issue}.`));
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
