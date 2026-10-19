/**
 * Bilder zu Wörtern von einer KI erzeugen lassen (KI-Prompt, views/ai-prompt-view.js):
 * feste Dateinamen je Wort, Prompt für die Bild-KI, Zuordnung der
 * heruntergeladenen Dateien. Ohne DOM und ohne Importe – die Tests laden
 * die Datei über browser-module.ts.
 */

/** Stil, den alle Bilder teilen – damit ein Memory wie aus einem Guss aussieht. */
export const DEFAULT_IMAGE_STYLE = 'flache, freundliche Illustration, kräftige Farben, weißer Hintergrund, quadratisch';

/** Dateiname ohne Endung zu einem Wort: klein, Umlaute ausgeschrieben, nur a–z, 0–9 und Bindestrich. */
export function wordSlug(word) {
  const s = String(word || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'bild';
}

/** Wörter aus dem Eingabefeld (je Zeile eines, auch durch Komma getrennt) mit eindeutigem Dateinamen. */
export function parseImageWords(text) {
  const seen = new Map();
  return String(text || '')
    .split(/[\n,;]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((word) => {
      let slug = wordSlug(word);
      const n = (seen.get(slug) || 0) + 1;
      seen.set(slug, n);
      if (n > 1) slug = `${slug}-${n}`;
      return { word, slug, file: `${slug}.png` };
    });
}

/** Prompt für eine Bild-KI (ChatGPT, Gemini, Copilot …): ein Bild je Wort, einheitlicher Stil, feste Namen. */
export function buildImagePrompt(words, style = DEFAULT_IMAGE_STYLE, language = 'Deutsch') {
  const L = [];
  L.push('Erstelle für jeden der folgenden Begriffe ein eigenes Bild. Die Bilder sind für ein Lernspiel im Unterricht (z. B. Memory).');
  L.push('');
  L.push(`Stil – für alle Bilder gleich: ${style || DEFAULT_IMAGE_STYLE}.`);
  L.push('Wichtig:');
  L.push('- Kein Text, keine Buchstaben und keine Zahlen im Bild – das Bild darf die Lösung nicht verraten.');
  L.push('- Ein klar erkennbares Motiv je Bild, mittig, ohne ablenkenden Hintergrund.');
  L.push('- Keine realen Personen, keine Marken oder Logos.');
  L.push('- Kindgerecht und eindeutig: Man soll den Begriff auf einen Blick erkennen.');
  L.push('');
  L.push('Erzeuge die Bilder nacheinander, je Antwort eines. Nenne vor jedem Bild genau den Dateinamen aus der Liste,');
  L.push('damit ich es so speichern kann. Schreibe sonst nichts dazu. Mach nach jedem Bild weiter, wenn ich „weiter“ schreibe.');
  L.push('');
  L.push(`Begriffe (${language}) und Dateinamen:`);
  words.forEach((w, i) => L.push(`${i + 1}. ${w.word} → ${w.file}`));
  return L.join('\n');
}

/**
 * Heruntergeladene Dateien den Wörtern zuordnen: gleicher Dateiname (ohne
 * Endung, wie wordSlug vereinheitlicht) oder der Name enthält ihn. Ergebnis:
 * je Wort der Index der Datei oder -1, dazu die übrigen Dateien.
 */
export function matchImageFiles(words, fileNames) {
  const stems = fileNames.map((n) => wordSlug(String(n).replace(/\.[^.]*$/, '')));
  const used = new Set();
  const pick = (test) => stems.findIndex((s, i) => !used.has(i) && test(s));
  const assigned = words.map(() => -1);
  // Erst exakte Treffer, dann „enthält“ (z. B. „hund (1).png“, „ChatGPT Image hund.png“).
  words.forEach((w, k) => { const i = pick((s) => s === w.slug); if (i >= 0) { assigned[k] = i; used.add(i); } });
  words.forEach((w, k) => {
    if (assigned[k] >= 0) return;
    const i = pick((s) => s.includes(w.slug));
    if (i >= 0) { assigned[k] = i; used.add(i); }
  });
  return { assigned, unused: fileNames.map((_, i) => i).filter((i) => !used.has(i)) };
}
