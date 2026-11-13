import { ClassesService } from './classes.service';
import { repo } from '../work/test-repo';

function setup({ strict = false } = {}) {
  const classes = repo([{ id: 'c1', name: 'Fortbildung', ownerId: 'leitung', strict, schoolYear: '2026/27' }]);
  const students = repo([{ id: 's0', classId: 'c1', firstName: 'Kai', lastName: 'Kurz', status: 'confirmed', userId: null }]);
  const users = repo([
    { id: 'leitung', email: 'leitung@schule.de', displayName: 'Lea Leitung', role: 'teacher', active: true },
    { id: 'mia', email: 'Mia.Muster@schule.de', displayName: 'Mia Muster', role: 'teacher', active: true },
    { id: 'ohne', email: 'ohne@schule.de', displayName: 'ohne@schule.de', role: 'teacher', active: true },
    { id: 'kind', email: 'kind@schule.de', displayName: 'Kind', role: 'student', active: true },
  ]);
  const r = () => repo();
  const svc = new ClassesService(classes as any, students as any, r() as any, r() as any, r() as any, r() as any, users as any,
    r() as any, r() as any, r() as any, r() as any, r() as any, r() as any, r() as any, r() as any, r() as any, r() as any, r() as any);
  return { svc, students, klasse: classes.rows[0] };
}

const LEITUNG = { userId: 'leitung' };

describe('👩‍🏫 Lehrkräfte als Teilnehmer (Fortbildung)', () => {
  it('per E-Mail eintragen: Name aus dem Konto, verknüpft, gleich bestätigt', async () => {
    const { svc, students } = setup();
    const s = await svc.addTeacher('c1', LEITUNG, { email: ' mia.muster@SCHULE.de ' });
    expect(s).toMatchObject({ firstName: 'Mia', lastName: 'Muster', userId: 'mia', status: 'confirmed' });
    await expect(svc.addTeacher('c1', LEITUNG, { email: 'mia.muster@schule.de' })).rejects.toThrow(/schon in der Liste/);
    await expect(svc.addTeacher('c1', LEITUNG, { email: 'kind@schule.de' })).rejects.toThrow(/keine Lehrkraft/);
    await expect(svc.addTeacher('c1', LEITUNG, { email: 'leitung@schule.de' })).rejects.toThrow(/du selbst/);
    expect(students.rows).toHaveLength(2);
  });

  it('angemeldet hinein: verknüpfter Eintrag, sonst ein unbestätigter mit Konto (nur in offenen Klassen)', async () => {
    const { svc, students, klasse } = setup();
    const first = await svc.teacherParticipant(klasse as any, { userId: 'mia' });
    expect(first).toMatchObject({ firstName: 'Mia', lastName: 'Muster', status: 'pending', userId: 'mia' });
    expect((await svc.teacherParticipant(klasse as any, { userId: 'mia' })).id).toBe(first.id);
    expect(students.rows).toHaveLength(2);
    await expect(svc.teacherParticipant(klasse as any, { userId: 'leitung' })).rejects.toThrow(/eigene Klasse/);
    await expect(svc.teacherParticipant(klasse as any, { userId: 'ohne' })).rejects.toThrow(/Namen eintragen/);
  });

  it('strikte Klasse: nur, wer eingetragen ist', async () => {
    const { svc, klasse } = setup({ strict: true });
    await expect(svc.teacherParticipant(klasse as any, { userId: 'mia' })).rejects.toThrow(/nicht in der Liste/);
    await svc.addTeacher('c1', LEITUNG, { email: 'mia.muster@schule.de' });
    expect(await svc.teacherParticipant(klasse as any, { userId: 'mia' })).toMatchObject({ userId: 'mia', status: 'confirmed' });
  });
});
