/**
 * Logik der Aufgabentypen Reihenfolge und Kreuzworträtsel – ohne DOM und
 * ohne Importe, damit die Tests die Datei wie formula.js laden können
 * (src/core/puzzles/puzzles.ts). Die Anzeige steht in puzzle-views.js.
 */

// ==================== ZUFALL ====================

/**
 * Zufallszahlen aus einem Startwert (mulberry32): Gleicher Startwert, gleiche
 * Folge. So sieht jeder Schüler dasselbe Kreuzworträtsel.
 */
export function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ==================== REIHENFOLGE ====================

/**
 * Die Elemente in der richtigen Reihenfolge. Elemente mit gleichem Text und
 * Bild haben denselben Schlüssel und sind untereinander vertauschbar.
 */
export function sortingItems(content) {
  const raw = (content && Array.isArray(content.items)) ? content.items : [];
  return raw
    .map((it) => ({ text: String((it && it.text) || '').trim(), imageUrl: String((it && it.imageUrl) || '') }))
    .filter((it) => it.text || it.imageUrl)
    .map((it, index) => ({ ...it, index, key: `${it.text}\u0000${it.imageUrl}` }));
}

/** Wie ein Element in der Auswertung heißt; ein Bild ohne Text nach seiner Stelle. */
export function sortingLabel(item) {
  return item.text || `Bild ${item.index + 1}`;
}

/**
 * Bewertung über Nachbarpaare: Teilpunkte für jedes Paar, das wie in der
 * Lösung direkt aufeinander folgt. Wer ein Element an die falsche Stelle
 * setzt, verliert so ein, zwei Paare – nach Positionen gezählt wäre alles
 * dahinter falsch. Gleiche Elemente zählen als vertauschbar.
 */
export function scoreSorting(expectedKeys, givenKeys) {
  const n = expectedKeys.length;
  const isCorrect = n > 0 && givenKeys.length === n && givenKeys.every((k, i) => k === expectedKeys[i]);
  if (n < 2) return { isCorrect, points: isCorrect ? 1 : 0, pairs: 0, totalPairs: 0 };
  const pair = (a, b) => `${a}\u0001${b}`;
  const want = new Map();
  for (let i = 0; i < n - 1; i++) {
    const p = pair(expectedKeys[i], expectedKeys[i + 1]);
    want.set(p, (want.get(p) || 0) + 1);
  }
  let pairs = 0;
  for (let i = 0; i < givenKeys.length - 1; i++) {
    const p = pair(givenKeys[i], givenKeys[i + 1]);
    const left = want.get(p) || 0;
    if (left > 0) { pairs++; want.set(p, left - 1); }
  }
  return { isCorrect, points: isCorrect ? 1 : pairs / (n - 1), pairs, totalPairs: n - 1 };
}

/**
 * Gemischt, aber nie schon richtig sortiert – außer es gibt nichts zu
 * mischen (alle Elemente gleich). Notfalls um eins verschoben: Das ergibt
 * bei mindestens zwei verschiedenen Elementen immer eine andere Folge.
 */
export function shuffleForSorting(items, random = Math.random) {
  const keys = items.map((it) => it.key);
  if (new Set(keys).size < 2) return items.slice();
  for (let t = 0; t < 20; t++) {
    const s = shuffled(items, random);
    if (s.some((it, i) => it.key !== keys[i])) return s;
  }
  return [...items.slice(1), items[0]];
}

// ==================== MEMORY ====================

/**
 * Paare aus dem Inhalt. Ist Karte B leer, sind beide Karten gleich (das
 * klassische Memory); sonst gehören zwei verschiedene Karten zusammen.
 */
export function memoryPairs(content) {
  const raw = content && Array.isArray(content.pairs) ? content.pairs : [];
  return raw.map((p) => {
    const a = { text: String((p && p.aText) || '').trim(), imageUrl: String((p && p.aImage) || '') };
    const b = { text: String((p && p.bText) || '').trim(), imageUrl: String((p && p.bImage) || '') };
    return { a, b: b.text || b.imageUrl ? b : a };
  }).filter((p) => p.a.text || p.a.imageUrl);
}

// ==================== KREUZWORTRÄTSEL ====================

/**
 * Ein Buchstabe je Feld: groß geschrieben, Umlaute bleiben, ß bleibt ein
 * Feld (toUpperCase machte daraus "SS"). Leerzeichen, Bindestriche und
 * Satzzeichen fallen weg – "New York" wird NEWYORK.
 */
export function crosswordLetters(text) {
  return Array.from(String(text || '').normalize('NFC'))
    .map((ch) => (ch === 'ß' || ch === 'ẞ' ? 'ß' : ch.toLocaleUpperCase('de-DE')))
    .filter((ch) => ch.length === 1 && /[\p{L}\p{N}]/u.test(ch));
}

/** Die verwertbaren Wörter (mindestens zwei Buchstaben) mit Hinweis. */
export function crosswordWords(content) {
  const raw = (content && Array.isArray(content.words)) ? content.words : [];
  return raw
    .map((w, i) => ({
      index: i,
      text: String((w && w.answer) || '').trim(),
      letters: crosswordLetters(w && w.answer),
      clue: String((w && w.clue) || '').trim(),
      imageUrl: String((w && w.imageUrl) || ''),
    }))
    .filter((w) => w.letters.length >= 2);
}

const DIRS = { across: [0, 1], down: [1, 0] };
const cellKey = (r, c) => `${r},${c}`;

/**
 * Passt das Wort an diese Stelle? Ergebnis: Zahl der Kreuzungen oder -1.
 * Regeln wie im gedruckten Rätsel: Vor und hinter dem Wort bleibt ein Feld
 * frei, belegte Felder müssen denselben Buchstaben haben und dürfen nicht
 * schon zu einem Wort derselben Richtung gehören, und neue Felder haben
 * keine Nachbarn quer zur Richtung (sonst entstünden Unsinnswörter).
 */
function fits(grid, letters, r, c, dir) {
  const [dr, dc] = DIRS[dir];
  if (grid.has(cellKey(r - dr, c - dc))) return -1;
  if (grid.has(cellKey(r + dr * letters.length, c + dc * letters.length))) return -1;
  let crossings = 0;
  for (let i = 0; i < letters.length; i++) {
    const rr = r + dr * i;
    const cc = c + dc * i;
    const cell = grid.get(cellKey(rr, cc));
    if (cell) {
      if (cell.letter !== letters[i] || cell[dir] !== undefined) return -1;
      crossings++;
    } else if (grid.has(cellKey(rr + dc, cc + dr)) || grid.has(cellKey(rr - dc, cc - dr))) {
      return -1;
    }
  }
  return crossings;
}

function place(state, wordIndex, letters, r, c, dir) {
  const [dr, dc] = DIRS[dir];
  for (let i = 0; i < letters.length; i++) {
    const k = cellKey(r + dr * i, c + dc * i);
    const cell = state.grid.get(k) || { letter: letters[i] };
    cell[dir] = wordIndex;
    state.grid.set(k, cell);
  }
  const endR = r + dr * (letters.length - 1);
  const endC = c + dc * (letters.length - 1);
  state.minR = Math.min(state.minR, r); state.maxR = Math.max(state.maxR, endR);
  state.minC = Math.min(state.minC, c); state.maxC = Math.max(state.maxC, endC);
  state.placements.push({ wordIndex, row: r, col: c, dir });
}

/** Ein Versuch: Wörter nacheinander an die beste Kreuzung legen. */
function attempt(words, random) {
  const order = words
    .map((w, i) => ({ i, sortKey: w.length + random() * 3 }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((o) => o.i);
  const state = { grid: new Map(), placements: [], minR: 0, maxR: 0, minC: 0, maxC: 0, crossings: 0 };
  place(state, order[0], words[order[0]], 0, 0, random() < 0.5 ? 'across' : 'down');

  let pending = order.slice(1);
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    const still = [];
    for (const wi of pending) {
      const letters = words[wi];
      let best = null;
      for (const [k, cell] of state.grid) {
        const [cr, cc] = k.split(',').map(Number);
        for (let i = 0; i < letters.length; i++) {
          if (letters[i] !== cell.letter) continue;
          for (const dir of ['across', 'down']) {
            if (cell[dir] !== undefined) continue;
            const [dr, dc] = DIRS[dir];
            const r = cr - dr * i;
            const c = cc - dc * i;
            const crossings = fits(state.grid, letters, r, c, dir);
            if (crossings < 1) continue;
            // Viele Kreuzungen, wenig Wachstum, möglichst quadratisch.
            const h = Math.max(state.maxR, r + dr * (letters.length - 1)) - Math.min(state.minR, r) + 1;
            const w = Math.max(state.maxC, c + dc * (letters.length - 1)) - Math.min(state.minC, c) + 1;
            const oldArea = (state.maxR - state.minR + 1) * (state.maxC - state.minC + 1);
            const score = crossings * 10 - (h * w - oldArea) * 0.3 - Math.abs(h - w) * 0.5 + random() * 2;
            if (!best || score > best.score) best = { r, c, dir, crossings, score };
          }
        }
      }
      if (best) {
        place(state, wi, letters, best.r, best.c, best.dir);
        state.crossings += best.crossings;
        progress = true;
      } else {
        still.push(wi);
      }
    }
    pending = still;
  }
  // Wörter ohne gemeinsamen Buchstaben: frei stehend darunter, je eine Zeile
  // Abstand – im Rätsel fehlen soll keines.
  for (const wi of pending) place(state, wi, words[wi], state.maxR + 2, state.minC, 'across');
  state.islands = pending.length;
  return state;
}

/**
 * Gitter für die Wörter (Arrays von Buchstaben), bestimmt durch den
 * Startwert: einige Versuche, der beste gewinnt (wenig frei stehende
 * Wörter, viele Kreuzungen, kleine Fläche). Bewusst nur wenige – bei vielen
 * gewänne fast immer dasselbe Gitter, und „Neu anordnen“ änderte nichts.
 *
 * Ergebnis: rows, cols, cells[r][c] (Buchstabe oder null), entries mit
 * number, dir ('across' | 'down'), row, col, length, wordIndex – nummeriert
 * zeilenweise wie im gedruckten Rätsel –, islands (frei stehende Wörter).
 */
export function layoutCrossword(words, seed = 0, attempts = 6) {
  if (!words.length) return { rows: 0, cols: 0, cells: [], entries: [], islands: 0 };
  let best = null;
  for (let a = 0; a < attempts; a++) {
    const s = attempt(words, seededRandom(((Number(seed) || 0) * 7919 + a * 104729 + 1) >>> 0));
    const area = (s.maxR - s.minR + 1) * (s.maxC - s.minC + 1);
    if (!best
      || s.islands < best.s.islands
      || (s.islands === best.s.islands && (s.crossings > best.s.crossings
        || (s.crossings === best.s.crossings && area < best.area)))) {
      best = { s, area };
    }
  }
  const { s } = best;
  const rows = s.maxR - s.minR + 1;
  const cols = s.maxC - s.minC + 1;
  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const [k, cell] of s.grid) {
    const [r, c] = k.split(',').map(Number);
    cells[r - s.minR][c - s.minC] = cell.letter;
  }
  const placed = s.placements
    .map((p) => ({ ...p, row: p.row - s.minR, col: p.col - s.minC, length: words[p.wordIndex].length }))
    .sort((a, b) => a.row - b.row || a.col - b.col || (a.dir === 'across' ? -1 : 1));
  const numbers = new Map();
  const entries = placed.map((p) => {
    const k = cellKey(p.row, p.col);
    if (!numbers.has(k)) numbers.set(k, numbers.size + 1);
    return { number: numbers.get(k), dir: p.dir, row: p.row, col: p.col, length: p.length, wordIndex: p.wordIndex };
  });
  return { rows, cols, cells, entries, islands: s.islands };
}

/** Die Felder eines Eintrags als [row, col]. */
export function entryCells(entry) {
  const [dr, dc] = DIRS[entry.dir];
  return Array.from({ length: entry.length }, (_, i) => [entry.row + dr * i, entry.col + dc * i]);
}

/** Rätsel fertig aufbereitet: Wörter, Gitter und Startwert aus dem Inhalt. */
export function buildCrossword(content) {
  const words = crosswordWords(content);
  const layout = layoutCrossword(words.map((w) => w.letters), Number(content && content.seed) || 0);
  return { words, layout };
}

/**
 * Bewertung je Wort. `letterAt(row, col)` liefert den eingetragenen
 * Buchstaben (schon wie crosswordLetters vereinheitlicht) oder ''.
 */
export function scoreCrossword(puzzle, letterAt) {
  const perEntry = puzzle.layout.entries.map((e) => {
    const expected = puzzle.words[e.wordIndex].letters.join('');
    const given = entryCells(e).map(([r, c]) => letterAt(r, c) || '_').join('');
    return { number: e.number, dir: e.dir, expected, given, ok: given === expected };
  });
  const correct = perEntry.filter((p) => p.ok).length;
  return { perEntry, correct, total: perEntry.length };
}
