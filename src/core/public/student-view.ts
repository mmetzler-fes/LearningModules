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


/** Module-IDs der Quizze, die ein Dokument einbettet (Block `quiz`, auch in Aufgaben und Kästen). */
export function embeddedQuizIds(m: { type?: string; content?: any }): string[] {
  if (m?.type !== 'document') return [];
  const ids = new Set<string>();
  const visit = (v: any) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') {
      if (v.type === 'quiz' && typeof v.module === 'string') ids.add(v.module);
      Object.values(v).forEach(visit);
    }
  };
  visit(contentOf(m).spec);
  return [...ids];
}
