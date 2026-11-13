import { matchStudent, MatchableStudent } from './name-match';

/**
 * Was eine angemeldete Lehrkraft auf der Eingabeseite eines Klassenlinks tun kann:
 * `owner` ihre eigene Klasse (dort würde sie sonst selbst zum Schülereintrag), `listed` ihr Name steht in der
 * Liste, `open` sie kommt als unbestätigter Eintrag dazu, `closed` strikte Klasse ohne ihren Namen,
 * `linked` ein Eintrag ist mit ihrem Konto verknüpft (👩‍🏫, ohne PIN hinein).
 */
export type ParticipantRelation = 'owner' | 'linked' | 'listed' | 'open' | 'closed';

export function participantRelation(
  userId: string,
  name: string,
  klasse: { ownerId?: string | null; strict?: boolean },
  students: MatchableStudent[],
): ParticipantRelation {
  if (klasse.ownerId === userId) return 'owner';
  if (students.some((s) => (s as { userId?: string | null }).userId === userId)) return 'linked';
  if (matchStudent(name, students).kind === 'match') return 'listed';
  return klasse.strict ? 'closed' : 'open';
}
