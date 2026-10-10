/**
 * Hilfe in der App: die Dokumente aus docs/ für Lehrkräfte aufbereitet.
 *
 * Abschnitte für Entwickler (Technik, Endpunkte, beteiligte Dateien …) und
 * "Code: …"-Hinweise fallen weg; die Dateien selbst bleiben unverändert die
 * eine Quelle für beide Leserschaften.
 */

/** Gruppen der Themenübersicht, in dieser Reihenfolge. Unbekannte Dateien landen unter "Weitere". */
export const HELP_GROUPS: Array<{ title: string; icon: string; files: string[] }> = [
  { title: 'Lernthemen und Aufgaben', icon: '📚', files: ['notebooks', 'entwuerfe', 'ansicht-und-zoom', 'ki-prompt', 'formelaufgabe', 'arbeitsblaetter', 'diktat', 'audio-recorder', 'moodle-und-h5p'] },
  { title: 'Unterricht mit Schülern', icon: '🏫', files: ['themen-links', 'quick-link', 'klassen-und-schuljahr', 'lernbegleitung-und-quiz-arena'] },
  { title: 'Konto und Sicherheit', icon: '🔐', files: ['zwei-faktor'] },
  { title: 'Administration', icon: '⚙️', files: ['benutzerverwaltung', 'benutzer-tabelle', 'schulen', 'shop-und-rechte', 'nutzung-und-bewertung'] },
];

/** Überschriften, deren Abschnitte (samt Unterabschnitten) nur Entwickler betreffen. */
const DEV_HEADINGS = /^(Technik|Technisch|Umsetzung|Endpunkte|Beteiligte Dateien|H5P-Bibliotheken aktualisieren)$/i;

/** Dateiname ohne .md, nur Kleinbuchstaben, Ziffern und Bindestrich. */
export function isDocName(name: string): boolean {
  return /^[a-z0-9-]{1,60}$/.test(String(name || ''));
}

/**
 * Entwicklerteile entfernen. Ein Abschnitt reicht bis zur nächsten Überschrift
 * derselben oder einer höheren Ebene; Codeblöcke zählen nicht als Überschrift.
 */
export function forTeachers(markdown: string): string {
  const out: string[] = [];
  let skipLevel = 0;
  let inFence = false;
  let inCodeNote = false;
  for (const line of String(markdown || '').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && DEV_HEADINGS.test(h[2].trim())) skipLevel = level;
    }
    if (skipLevel) continue;
    // "Code: `src/…`" – Absatz bis zur nächsten Leerzeile
    if (!inFence && /^Code:\s/.test(line)) inCodeNote = true;
    if (inCodeNote) {
      if (!line.trim()) inCodeNote = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Anker wie im Browser-Darsteller (markdown.js): Kleinbuchstaben, Umlaute ausgeschrieben. */
export function slug(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] as string)
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Titel (erste #-Überschrift) und Abschnitte (##) für die Übersicht. */
export function outline(markdown: string): { title: string; sections: Array<{ title: string; anchor: string }> } {
  let title = '';
  const sections: Array<{ title: string; anchor: string }> = [];
  let inFence = false;
  for (const line of String(markdown || '').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1 && !title) title = h1[1].trim();
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) sections.push({ title: h2[1].trim(), anchor: slug(h2[1].trim()) });
  }
  return { title, sections };
}
