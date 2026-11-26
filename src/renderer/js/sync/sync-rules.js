// ==================== NACHSENDEN: REGELN ====================
//
// Reine Regeln der Sende-Warteschlange (outbox.js), ohne Browser – damit
// sie sich im Test prüfen lassen (src/core/sync-rules.spec.ts).
// Nichts importieren (loadBrowserModule).

/**
 * Was eine Antwort des Servers für einen Eintrag bedeutet:
 * - 'ok': angekommen, Eintrag löschen,
 * - 'retry': Netz oder Server gerade nicht da – später noch einmal (Eintrag bleibt),
 * - 'pin': der Server will die PIN – warten, bis eine neue bekannt ist,
 * - 'failed': endgültig abgelehnt (z. B. Klassenarbeit abgegeben) – nicht wiederholen.
 * `status` 0 steht für „keine Antwort“ (offline, Zeitüberschreitung).
 */
export function classifyResponse(status, body) {
  if (!status) return 'retry';
  if (status >= 200 && status < 300) {
    // Manche Endpunkte antworten 200 mit { success: false } oder { statusCode } im Text.
    if (body && (body.success === false || Number(body.statusCode) >= 400)) return 'failed';
    return 'ok';
  }
  if (status === 403 && body && body.needPin) return 'pin';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';
  return 'failed';
}

/** Wartezeit vor dem nächsten Versuch: 2 s, 4 s, 8 s … höchstens 60 s. */
export function backoffMs(tries) {
  const n = Math.max(0, Number(tries) || 0);
  return Math.min(60000, 2000 * 2 ** Math.min(n, 5));
}

/**
 * Neuer Eintrag für `key` in die Warteschlange: ersetzt einen wartenden
 * (nur der neueste Stand zählt), behält aber dessen Platz (`order`) –
 * so bleibt die Reihenfolge erhalten: Was ein Schüler vor der Abgabe
 * geschrieben hat, geht vor der Abgabe hinaus.
 */
export function replaceEntry(old, next, now) {
  return {
    ...next,
    order: old ? old.order : now,
    stamp: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    tries: 0,
    state: 'wait',
    error: null,
    queuedAt: old ? old.queuedAt : now,
    changedAt: now,
  };
}

/** Einträge in der Reihenfolge des Sendens (älteste zuerst); gesperrte (PIN, endgültig) bleiben liegen. */
export function sendOrder(entries) {
  return (entries || []).filter((e) => e && e.state !== 'failed' && e.state !== 'pin').sort((a, b) => a.order - b.order);
}

/** Laufende Nummer eines Geräts: wächst immer, auch wenn die Uhr stehen bleibt oder zurückspringt. */
export function nextSeq(last, now) {
  return Math.max(Number(now) || 0, (Number(last) || 0) + 1);
}
