// ==================== HTML-APP IM DURCHLAUF ====================
//
// Eine App zerfällt im Durchlauf in ihre Schritte aus dem Steckbrief (docs/html-apps.md), wie
// Wahr/Falsch in seine Fragen. Die Klasse sieht nur die Abschnitte, die ihr Link enthält.

const parsed = (c) => {
  if (typeof c !== 'string') return c || {};
  try { return JSON.parse(c); } catch (_) { return {}; }
};

/** `onlyUnit`: Modul-ID eines Abschnitts, wenn nur dieser gefragt ist. */
export function expandAppSteps(modules, onlyUnit = null) {
  return modules.flatMap((mod) => {
    if (mod?.type !== 'htmlApp') return [mod];
    const content = parsed(mod.content);
    const units = content.app?.manifest?.units;
    // Alte Schnittstelle: als Ganzes lassen, beim Öffnen sagt der Server, dass sie umgebaut werden muss.
    if (content.app?.manifest?.lmApp !== 2 || !Array.isArray(units)) return [mod];
    const kids = (mod.subModules || []).filter((k) => k.type === 'htmlAppUnit');
    const { subModules: _, ...rest } = mod;
    return units.flatMap((u) => {
      const kid = kids.find((k) => parsed(k.content).unit === u.id);
      if (kids.length && !kid) return [];
      if (onlyUnit && onlyUnit !== mod.id && kid?.id !== onlyUnit) return [];
      return (u.steps || []).map((s) => ({
        ...rest,
        // Ergebnisse zählen beim Abschnitt, in der Klassenübersicht eine Spalte je Abschnitt.
        id: kid?.id || mod.id,
        type: s.kind === 'task' ? 'htmlAppTask' : 'htmlAppInfo',
        title: s.title,
        content: { rootId: mod.id, app: { fileId: content.app.fileId }, step: { unit: u.id, id: s.id, title: s.title, kind: s.kind } },
      }));
    });
  });
}

/** Die laufende App einer Aufgabenansicht, falls es eine ist. */
export const appOfView = (view) => view?.querySelector?.('[data-lm-app]')?._lmApp || null;
