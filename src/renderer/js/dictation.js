/**
 * Diktat: Audio-Quellen und wortweiser Vergleich. Von der Anzeige
 * (h5p-renderer.js) und der Auswertung im Quiz (quiz.js) gemeinsam genutzt,
 * damit beide genau dasselbe zählen.
 */

import { normalizeShareUrl } from './utils.js';

/** Audio-Link; Nextcloud-Freigabelinks werden zum Direktlink (siehe utils.js). */
export const normalizeAudioUrl = normalizeShareUrl;

/** Audioquelle eines Satzes: hochgeladene Datei vor Link; '' = Sprachausgabe. */
export function audioSourceOf(sentence) {
  return sentence?.audioFile || normalizeAudioUrl(sentence?.audioUrl) || '';
}

const PUNCT = /[.,;:!?¿¡"„“”‚‘’'«»()[\]{}…–—-]/g;

/** Wörter eines Satzes; `norm` ist die Vergleichsform je nach Einstellung. */
function words(text, opts) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      let norm = opts.punctuation ? w : w.replace(PUNCT, '');
      if (!opts.caseSensitive) norm = norm.toLocaleLowerCase('de');
      return { raw: w, norm };
    })
    .filter((w) => w.norm !== '');
}

/**
 * Vergleicht Eingabe und Lösung Wort für Wort (längste gemeinsame Folge).
 * Ergebnis: Liste von Schritten
 *   ok      – Wort richtig
 *   wrong   – an dieser Stelle steht ein anderes Wort (given statt expected)
 *   missing – Wort fehlt
 *   extra   – Wort zu viel
 * und die Zahl der Fehler. Ein falsch geschriebenes Wort zählt einmal,
 * nicht als "fehlt + zu viel".
 */
export function compareSentence(expectedText, givenText, opts = {}) {
  const o = { caseSensitive: opts.caseSensitive !== false, punctuation: opts.punctuation !== false };
  const exp = words(expectedText, o);
  const giv = words(givenText, o);
  const n = exp.length;
  const m = giv.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = exp[i].norm === giv[j].norm ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const raw = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && exp[i].norm === giv[j].norm) { raw.push({ type: 'ok', expected: exp[i].raw, given: giv[j].raw }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { raw.push({ type: 'extra', given: giv[j].raw }); j++; }
    else { raw.push({ type: 'missing', expected: exp[i].raw }); i++; }
  }
  // Benachbartes "zu viel" + "fehlt" ist ein falsch geschriebenes Wort.
  const ops = [];
  for (let k = 0; k < raw.length; k++) {
    const a = raw[k];
    const b = raw[k + 1];
    if (b && ((a.type === 'extra' && b.type === 'missing') || (a.type === 'missing' && b.type === 'extra'))) {
      ops.push({ type: 'wrong', expected: a.expected ?? b.expected, given: a.given ?? b.given });
      k++;
    } else ops.push(a);
  }
  const mistakes = ops.filter((s) => s.type !== 'ok').length;
  return { ops, mistakes, total: n };
}

/**
 * Wertung eines ganzen Diktats: Anteil der Wörter ohne Fehler. Fehler über
 * die Satzlänge hinaus (viele überzählige Wörter) machen einen Satz nicht
 * negativ.
 */
export function scoreDictation(sentences, answers, opts) {
  let total = 0;
  let good = 0;
  let mistakes = 0;
  const results = (sentences || []).map((s, idx) => {
    const r = compareSentence(s.text, answers[idx] || '', opts);
    total += r.total;
    good += Math.max(0, r.total - r.mistakes);
    mistakes += r.mistakes;
    return r;
  });
  return { results, total, good, mistakes, points: total ? good / total : 0 };
}

/**
 * Einstellungen eines Moduls. Ältere Diktate hatten keine Häkchen und
 * werteten Groß-/Kleinschreibung nicht – das bleibt so, bis jemand das
 * Häkchen im Editor setzt. Satzzeichen zählten schon immer.
 */
export function dictationOptions(content) {
  return {
    caseSensitive: content?.caseSensitive === true,
    punctuation: content?.punctuation !== false,
  };
}
