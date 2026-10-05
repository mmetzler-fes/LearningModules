/**
 * Misst je Aufgabe, wie lange ein Schüler bis zur ersten Antwort braucht.
 * Daraus entstehen die Vorgabezeiten der Quiz-Arena.
 *
 * - Gezählt wird nur, solange die Seite sichtbar ist: Wer zwischendurch die
 *   App wechselt, soll den Schnitt nicht um Minuten verschieben.
 * - Es zählt die erste Antwort (Weiter bzw. der erste Prüfen-Klick in der
 *   Lernbegleitung) – in der Quiz-Arena antwortet man auch genau einmal.
 *   Wer zurückblättert, ändert an einer schon beantworteten Aufgabe nichts;
 *   eine noch offene sammelt beim nächsten Besuch weiter.
 */
export class TaskTimer {
  constructor() {
    /** Index → gemessene Millisekunden (nur beantwortete Aufgaben). */
    this._ms = new Map();
    /** Index → bisher gesammelte Zeit offener Aufgaben. */
    this._open = new Map();
    this._current = null;
    this._since = null;
    this._onVisibility = () => {
      if (document.hidden) this._pause();
      else if (this._current !== null) this._since = performance.now();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /** Aufgabe `index` wird angezeigt. */
  show(index) {
    this._pause();
    this._current = this._ms.has(index) ? null : index;
    this._since = this._current !== null && !document.hidden ? performance.now() : null;
  }

  /** Erste Antwort auf die gerade gezeigte Aufgabe. */
  answered(index) {
    if (this._ms.has(index) || this._current !== index) return;
    this._pause();
    this._ms.set(index, Math.round(this._open.get(index) || 0));
    this._open.delete(index);
    this._current = null;
  }

  /** Gemessene Zeit einer Aufgabe oder `undefined`. */
  msOf(index) {
    return this._ms.get(index);
  }

  dispose() {
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  _pause() {
    if (this._current !== null && this._since !== null) {
      this._open.set(this._current, (this._open.get(this._current) || 0) + performance.now() - this._since);
    }
    this._since = null;
  }
}
