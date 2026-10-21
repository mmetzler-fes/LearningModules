// Einrückhilfe für das YAML-Feld des Dokument-Editors (docspec-editor.js).
//
// Ohne import und DOM – der Server lädt die Datei für die Tests
// (src/core/browser-module.ts). Alles arbeitet auf Text und
// Cursor-Positionen; das Feld selbst setzt der Editor.

const STEP = 2;

/** Führende Leerzeichen einer Zeile. */
export function leadOf(line) {
  return line.length - line.replace(/^ +/, '').length;
}

function lineStartAt(text, pos) {
  return text.lastIndexOf('\n', pos - 1) + 1;
}

/**
 * Einrückung der neuen Zeile nach Enter: wie die Zeile davor; nach `- `
 * bündig mit dem Inhalt des Listenpunkts, nach `:` am Zeilenende (oder `|`)
 * eine Stufe tiefer.
 */
export function newlineIndent(lineBefore) {
  let n = leadOf(lineBefore);
  const rest = lineBefore.slice(n);
  if (rest.startsWith('- ')) n += STEP;
  if (/:\s*(\|[-+]?|>[-+]?)?\s*$/.test(rest) && !/^- [^:]*$/.test(rest)) n += STEP;
  return ' '.repeat(n);
}

/**
 * Markierte Zeilen ein- (`dir` 1) oder ausrücken (-1). Liefert den neuen Text
 * und die neue Markierung, die die ganzen Zeilen umfasst.
 */
export function shiftLines(text, start, end, dir) {
  const from = lineStartAt(text, start);
  // Endet die Markierung genau am Zeilenanfang, gehört diese Zeile nicht dazu.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  let to = text.indexOf('\n', last);
  if (to < 0) to = text.length;
  const lines = text.slice(from, to).split('\n').map((line) => {
    if (dir > 0) return line.trim() ? ' '.repeat(STEP) + line : line;
    return line.slice(Math.min(STEP, leadOf(line)));
  });
  const block = lines.join('\n');
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

/**
 * Eingefügten Text an die Spalte `col` der Schreibmarke anpassen: Die
 * Einrückungen untereinander bleiben, der Block rückt als Ganzes. Kopiert
 * aus der Mitte einer Zeile (erste Zeile ohne Einrückung, z. B. ab `- type`),
 * wird die erste Zeile aus den übrigen erschlossen.
 */
export function reindentPaste(pasted, col) {
  const lines = String(pasted).replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n');
  if (lines.length < 2) return lines.join('\n');
  const rest = lines.slice(1).filter((l) => l.trim());
  const restMin = rest.length ? Math.min(...rest.map(leadOf)) : 0;
  let first = leadOf(lines[0]);
  if (first === 0 && rest.length) first = Math.max(0, restMin - (lines[0].startsWith('- ') ? STEP : 0));
  const base = rest.length ? Math.min(first, restMin) : first;
  return lines.map((line, i) => {
    if (i === 0) return ' '.repeat(Math.max(0, first - base)) + line.trimStart();
    // Endet das Eingefügte mit einem Umbruch, steht dahinter der Rest der
    // Zeile – er behält die Einrückung der Schreibmarke.
    if (i === lines.length - 1 && !line.trim()) return ' '.repeat(col);
    if (!line.trim()) return '';
    return ' '.repeat(col + leadOf(line) - base) + line.trimStart();
  }).join('\n');
}

/**
 * Block (als YAML eines Listenpunkts, `- type: …`) hinter dem Listenpunkt
 * einfügen, in dem die Schreibmarke steht – gleiche Ebene, also als nächster
 * Block. Ohne Listenpunkt davor: `null` (der Editor hängt ans Ende an).
 */
export function insertAfterItem(text, pos, itemYaml) {
  const lines = text.split('\n');
  let row = text.slice(0, pos).split('\n').length - 1;
  while (row >= 0 && !lines[row].trimStart().startsWith('- ')) row--;
  if (row < 0) return null;
  const indent = leadOf(lines[row]);
  let end = row + 1;
  while (end < lines.length && (!lines[end].trim() || leadOf(lines[end]) > indent)) end++;
  // Leerzeilen am Ende des Blocks bleiben hinter dem neuen.
  while (end > row + 1 && !lines[end - 1].trim()) end--;
  const add = String(itemYaml).replace(/\n+$/, '').split('\n').map((l) => (l ? ' '.repeat(indent) + l : l));
  lines.splice(end, 0, ...add);
  const at = lines.slice(0, end).join('\n').length + 1 + indent;
  return { text: lines.join('\n'), pos: at };
}
