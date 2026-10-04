/** Modulinhalt als Objekt (gespeichert wird teils als JSON-Text). */
export function contentOf(m: { content?: any }): any {
  if (!m?.content) return {};
  if (typeof m.content === 'string') { try { return JSON.parse(m.content); } catch { return {}; } }
  return m.content;
}

/**
 * Was Schüler von einem Modul bekommen: beim Audio Recorder ohne
 * Ablage-Link und Passwort – nur die Angabe, dass hochgeladen wird.
 */
export function forStudents<T extends { type?: string; content?: any }>(m: T): T {
  if (m?.type !== 'audioRecorder') return m;
  const { uploadUrl, uploadPassword: _pw, ...rest } = contentOf(m);
  return { ...m, content: { ...rest, uploadConfigured: !!uploadUrl } };
}

