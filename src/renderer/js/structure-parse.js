// Struktur-Import (docs/planung.md#struktur-importieren): aus einer Tabelle,
// einer Ordnerstruktur oder einer eingefügten Gliederung einen Baum aus
// Books/Plänen, Bereichen und Abschnitten machen. Nur Ordner, keine Inhalte.
// Ohne Importe, damit die Tests es laden können (structure-parse.spec.ts).
//
// Ein Pfad ist eine Liste von { title, kind }; kind: 'top' (oberste Ebene),
// 'area', 'section' oder 'auto' (Blätter werden Abschnitte, sonst Bereiche).

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLocaleLowerCase('de');

/** Spalte I (Index 8) ist der Abschnitt; A die oberste Ebene, B–H Bereiche. */
export const SECTION_COLUMN = 8;

const HEADER_WORDS = /^(book|buch|bereich|abschnitt|ebene|bildungsgang|beruf|lernfeld|plan|ordner)\b/i;

/**
 * Zeilen einer Tabelle → Pfade. Leere Zellen am Anfang einer Zeile erben von
 * der Zeile darüber (wie eine Gliederung), Lücken mitten in der Zeile werden
 * übersprungen. Eine Kopfzeile (Book, Bereich, Abschnitt …) fällt weg.
 */
export function pathsFromRows(rows) {
  const out = [];
  let prev = [];
  rows.forEach((raw, i) => {
    const cells = Array.from({ length: SECTION_COLUMN + 1 }, (_, j) => norm(raw?.[j]));
    if (i === 0 && cells.filter(Boolean).length > 1 && cells.filter(Boolean).every((c) => HEADER_WORDS.test(c))) return;
    const first = cells.findIndex(Boolean);
    if (first < 0) return;
    const cur = [...prev.slice(0, first), ...cells.slice(first)];
    while (cur.length < cells.length) cur.push('');
    prev = cur;
    const path = [];
    cur.forEach((title, j) => { if (title) path.push({ title, kind: j === 0 ? 'top' : j === SECTION_COLUMN ? 'section' : 'area' }); });
    if (path.length) out.push(path);
  });
  return out;
}

/**
 * Eingefügte Gliederung → Pfade. Ebene aus der Einrückung (Tab = 4 Leerzeichen)
 * oder aus Überschriften (# ## ###); Aufzählungszeichen und Nummern („1.2“) fallen weg.
 */
export function pathsFromOutline(text) {
  const out = [];
  const stack = []; // Titel je Ebene
  let base = 0; // Ebene unter der letzten Überschrift
  let indents = []; // Einrückungen der Zeilen seit der letzten Überschrift
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const expanded = line.replace(/\t/g, '    ');
    const indent = expanded.length - expanded.trimStart().length;
    let rest = expanded.trim();
    let level;
    const heading = /^(#{1,6})\s+/.exec(rest);
    if (heading) {
      level = heading[1].length - 1;
      rest = rest.slice(heading[0].length);
      base = level + 1;
      indents = [];
    } else {
      while (indents.length && indents[indents.length - 1] > indent) indents.pop();
      if (!indents.length || indents[indents.length - 1] < indent) indents.push(indent);
      level = base + indents.length - 1;
    }
    for (let i = 0; i < 2; i++) rest = rest.replace(/^([-*•–+]|\d+(\.\d+)*[.)]?)\s+/, '');
    const title = norm(rest);
    if (!title) continue;
    // Übersprungene Ebenen (### direkt nach #) hängen unter der letzten vorhandenen.
    stack.length = Math.min(stack.length, level);
    stack.push(title);
    out.push(stack.map((t, i) => ({ title: t, kind: i === 0 ? 'top' : 'auto' })));
  }
  return out;
}

/**
 * Ordnerstruktur (webkitRelativePath der Dateien, z. B. „Unterricht/Elektro/LF1/datei.pdf“)
 * → Pfade, ohne Dateien. Versteckte Ordner (.git …) fallen weg; `includeRoot`: der gewählte Ordner selbst als oberste Ebene.
 */
export function pathsFromFolders(relPaths, { includeRoot = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const p of relPaths || []) {
    let parts = String(p || '').split('/').slice(0, -1);
    if (!includeRoot) parts = parts.slice(1);
    if (parts.some((x) => x.startsWith('.'))) continue;
    for (let i = 1; i <= parts.length; i++) {
      const k = parts.slice(0, i).map(key).join('/');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(parts.slice(0, i).map((title, j) => ({ title: norm(title), kind: j === 0 ? 'top' : 'auto' })));
    }
  }
  return out;
}

/**
 * Pfade → Baum `[{ title, kind, children }]`; Gleichnamiges unter demselben
 * Elternteil wird zusammengeführt (ohne Rücksicht auf Groß/klein). Ein
 * Abschnitt mit Unterordnern wird Bereich; `auto`-Blätter unterhalb der
 * obersten Ebene werden Abschnitte.
 */
export function buildTree(paths) {
  const root = [];
  for (const path of paths) {
    let list = root;
    for (const step of path) {
      let node = list.find((n) => key(n.title) === key(step.title));
      if (!node) { node = { title: step.title, kind: step.kind, children: [] }; list.push(node); }
      else if (step.kind === 'section' && node.kind === 'auto') node.kind = 'section';
      list = node.children;
    }
  }
  const settle = (list, depth) => {
    for (const n of list) {
      settle(n.children, depth + 1);
      if (depth === 0) n.kind = 'top';
      else if (n.children.length) n.kind = 'area';
      else if (n.kind === 'auto') n.kind = 'section';
    }
  };
  settle(root, 0);
  return root;
}

/** Ebenen eines Baums (oberste = 1). */
export function treeDepth(list) {
  return list.length ? 1 + Math.max(...list.map((n) => treeDepth(n.children))) : 0;
}

/**
 * Höchstens `max` Ebenen: Tiefere Knoten fallen weg und werden gezählt.
 * Ein Knoten auf der letzten Ebene, der Kinder hatte, wird Abschnitt.
 */
export function limitDepth(list, max) {
  let dropped = 0;
  const count = (l) => l.reduce((s, n) => s + 1 + count(n.children), 0);
  const cut = (l, depth) => l.map((n) => {
    if (depth >= max) { dropped += count(n.children); return { ...n, kind: n.kind === 'top' ? 'top' : 'section', children: [] }; }
    return { ...n, children: cut(n.children, depth + 1) };
  });
  const tree = max > 0 ? cut(list, 1) : [];
  return { tree, dropped: max > 0 ? dropped : count(list) };
}

/** Wie viele Knoten insgesamt. */
export function countNodes(list) {
  return list.reduce((s, n) => s + 1 + countNodes(n.children), 0);
}
