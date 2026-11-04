/** Modulinhalt als Objekt (gespeichert wird teils als JSON-Text). */
export function contentOf(m: { content?: any }): any {
  if (!m?.content) return {};
  if (typeof m.content === 'string') { try { return JSON.parse(m.content); } catch { return {}; } }
  return m.content;
}

/** Spec ohne Lösungsblöcke, wo immer sie stehen (Aufgaben, Kästen, Tabellenzellen). */
export function withoutSolutionBlocks(v: any): any {
  if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === 'object' && x.type === 'solution')).map(withoutSolutionBlocks);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutSolutionBlocks(x)]));
  return v;
}

/** Enthält dieses Dokument überhaupt Lösungen? */
export function hasSolutionBlocks(m: { type?: string; content?: any }): boolean {
  if (m?.type !== 'document') return false;
  const visit = (v: any): boolean => (Array.isArray(v) ? v.some(visit)
    : !!v && typeof v === 'object' && (v.type === 'solution' || Object.values(v).some(visit)));
  return visit(contentOf(m).spec);
}

/**
 * Was Schüler von einem Modul bekommen: beim Audio Recorder ohne Ablage-Link und Passwort, bei einem
 * Dokument ohne Lösungen und ohne das alte HTML. `solutions`: Module, deren Lösungen dabei sein dürfen.
 */
export function studentModule(solutions: (m: { id?: string }) => boolean = () => false) {
  const view = <T extends { id?: string; type?: string; content?: any; subModules?: any[] }>(m: T): T => {
    const subs = Array.isArray(m?.subModules) ? { subModules: m.subModules.map(view) } : {};
    if (m?.type === 'audioRecorder') {
      const { uploadUrl, uploadPassword: _pw, ...rest } = contentOf(m);
      return { ...m, ...subs, content: { ...rest, uploadConfigured: !!uploadUrl } };
    }
    if (m?.type === 'document') {
      // legacyHtml: Stand vor der Umwandlung, darin stehen die Lösungen im Klartext.
      const { legacyHtml: _old, ...rest } = contentOf(m);
      return { ...m, ...subs, content: solutions(m) ? rest : { ...rest, spec: withoutSolutionBlocks(rest.spec) } };
    }
    return { ...m, ...subs };
  };
  return view;
}

/** Für Schüler, ohne freigegebene Lösungen. Einzelnes Argument: lässt sich direkt an `map` geben. */
export const forStudents = <T extends { id?: string; type?: string; content?: any; subModules?: any[] }>(m: T): T => studentModule()(m);

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
