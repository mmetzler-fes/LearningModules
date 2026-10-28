// ==================== ELEMENT ALS OBJEKT ====================
//
// Jedes Element des Blatts – Absatz, Überschrift, Liste, Kasten, Spalten,
// Baustein, Tabelle – hat dieselben Aktionen: nach oben, nach unten,
// verdoppeln, ausschneiden, kopieren, löschen. Wie sie ausgeführt werden,
// bestimmt die Art (Tabelle über ihren Griff, Baustein über seine Leiste,
// sonst allgemein); die Menüeinträge sind für alle gleich.

const ACTIONS = [
  ['up', '↑ Nach oben', 'Alt+↑'],
  ['down', '↓ Nach unten', 'Alt+↓'],
  '-',
  ['dup', '⧉ Verdoppeln'],
  ['cut', '✂ Ausschneiden'],
  ['copy', '📋 Kopieren'],
  '-',
  ['del', '✕ Löschen', 'Entf'],
];

/**
 * Menüeinträge für ein Element. `handlers`: { up, down, dup, cut, copy, del } –
 * fehlt einer, fehlt sein Eintrag. `extra`: Einträge davor (z. B. ✏️ Bearbeiten).
 * `selectable`: Element wird als Ganzes gewählt (Tabelle, Baustein) – dann löscht Entf.
 */
export function objectEntries(handlers, extra = [], { selectable = true } = {}) {
  const entries = [...extra];
  for (const a of ACTIONS) {
    if (a === '-') { if (entries.length && entries[entries.length - 1] !== '-') entries.push('-'); continue; }
    const [act, label, key] = a;
    const hint = act === 'del' && !selectable ? '' : key;
    if (handlers[act]) entries.push({ label, ...(hint ? { hint } : {}), ...(act === 'del' ? { danger: true } : {}), onClick: handlers[act] });
  }
  while (entries[entries.length - 1] === '-') entries.pop();
  return entries;
}

/** Text in die Zwischenablage – auch ohne sichere Verbindung (dann über ein verstecktes Feld). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Name der Art eines Elements der Schreibfläche – für die Überschrift des Untermenüs. */
export function objectName(el) {
  const ds = el.dataset?.ds;
  if (el.classList.contains('ds-widget')) return '▦ Baustein';
  if (el.tagName === 'TABLE') return el.classList.contains('ws-columns') ? '▥ Spalten' : '▤ Tabelle';
  if (el.classList.contains('ws-box')) return '▭ Kasten';
  if (el.tagName === 'UL' || el.tagName === 'OL') return '•≡ Liste';
  if (ds === 'section') return '§ Abschnitt';
  if (ds === 'task') return '¶ Aufgabe';
  if (ds === 'subtask') return '¶ Teilaufgabe';
  if (ds === 'note') return '¶ Hinweis';
  if (/^H[1-6]$/.test(el.tagName)) return '¶ Überschrift';
  if (el.tagName === 'IMG' || el.querySelector?.(':scope > img:only-child')) return '🖼 Bild';
  return '¶ Absatz';
}
