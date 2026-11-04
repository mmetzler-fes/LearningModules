import { contentOf, embeddedQuizIds } from '../core/public/student-view';

/**
 * Was Schüler nicht zu sehen bekommen: Dokumente der Art „Klassenarbeit“ und alles mit
 * „🔒 Nur Lehrkraft“ (Modul oder ganzes Lernthema). Die Quizze darin und Untermodule sind
 * mitgesperrt. Die Sperre gilt auf allen Schüler-Wegen außer dem Link der Klassenarbeit
 * (eigener Schlüssel); andere Lehrkräfte sehen die Module weiter, nur nicht deren Schüler.
 * „🔓 Zur Besprechung freigeben“ gilt nur für Links der Eigentümerin: Sonst öffnete
 * eine Besprechung die Arbeit auch für die Klassen aller, die das Thema nutzen.
 */
export interface LockModule {
  id: string;
  type?: string;
  parentId?: string | null;
  teacherOnly?: boolean;
  studentRelease?: boolean;
  content?: any;
}

/** Art und eingebettete Quizze: aus dem Inhalt, im Baum (ohne Inhalt) von außen. */
export interface LockFacts {
  kindOf: (m: LockModule) => string | undefined;
  embedsOf: (m: LockModule) => string[];
}
const FROM_CONTENT: LockFacts = { kindOf: (m) => contentOf(m).kind, embedsOf: embeddedQuizIds };

/** Ist dieses Modul selbst gesperrt, sobald niemand es freigibt? */
function lockedItself(topic: { teacherOnly?: boolean }, m: LockModule, facts: LockFacts) {
  return !!topic.teacherOnly || !!m.teacherOnly || (m.type === 'document' && facts.kindOf(m) === 'klassenarbeit');
}

/** IDs der gesperrten Module. `ownerLink`: Link der Eigentümerin – nur dort zählt die Freigabe. */
export function lockedModuleIds(
  topic: { teacherOnly?: boolean },
  modules: LockModule[],
  ownerLink: boolean,
  facts: LockFacts = FROM_CONTENT,
  /** Für diese Klasse freigegeben (am Klassenlink, nur auf Links der Eigentümerin). */
  releasedHere: ReadonlySet<string> = new Set(),
): Set<string> {
  const released = (m: LockModule) => ownerLink && (!!m.studentRelease || releasedHere.has(m.id));
  const locked = new Set(modules.filter((m) => lockedItself(topic, m, facts) && !released(m)).map((m) => m.id));
  // Was ein freigegebenes Dokument einbettet, gehört zur Besprechung …
  for (const doc of modules) {
    if (released(doc) && lockedItself(topic, doc, facts)) for (const id of facts.embedsOf(doc)) locked.delete(id);
  }
  // … außer es steckt auch in einer noch gesperrten Arbeit.
  for (const doc of modules) {
    if (locked.has(doc.id)) for (const id of facts.embedsOf(doc)) locked.add(id);
  }
  for (const m of modules) if (m.parentId && locked.has(m.parentId)) locked.add(m.id);
  return locked;
}

/** Module ohne die gesperrten. */
export function withoutLocked<T extends LockModule>(topic: { teacherOnly?: boolean }, modules: T[], ownerLink: boolean, releasedHere?: ReadonlySet<string>): T[] {
  const locked = lockedModuleIds(topic, modules, ownerLink, FROM_CONTENT, releasedHere);
  return locked.size ? modules.filter((m) => !locked.has(m.id)) : modules;
}
