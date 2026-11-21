import { DataSource } from 'typeorm';
import { SchoolClass } from '../core/entities/school-class.entity';
import { SchoolClassStudent } from '../core/entities/school-class-student.entity';
import { SchoolClassRequest } from '../core/entities/school-class-request.entity';
import { StudentClass } from '../core/entities/student-class.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { User } from '../core/entities/user.entity';
import { SchoolClassesService } from './school-classes.service';

const YEAR = 'SJ26-27';
const admin = { userId: 'a1', schoolId: 's1', isSchoolAdmin: true };
const teacher = { userId: 't1', schoolId: 's1', isSchoolAdmin: false };
const row = (className: string, lastName: string, firstName: string, loginId: string) => ({ className, lastName, firstName, loginId });

describe('SchoolClassesService', () => {
  let ds: DataSource;
  let svc: SchoolClassesService;

  beforeEach(async () => {
    ds = new DataSource({ type: 'sqlite', database: ':memory:', entities: [SchoolClass, SchoolClassStudent, SchoolClassRequest, StudentClass, ClassStudent, User], synchronize: true });
    await ds.initialize();
    await ds.getRepository(User).save([
      { id: 'a1', email: 'a@s.de', passwordHash: 'x', role: 'teacher', schoolId: 's1', isSchoolAdmin: true },
      { id: 't1', email: 't@s.de', passwordHash: 'x', role: 'teacher', displayName: 'Frau Lehrer', schoolId: 's1' },
    ] as any);
    const classRepo = ds.getRepository(StudentClass);
    const classes = {
      currentSchoolYear: async () => YEAR,
      ownedClass: async (id: string, user: any) => {
        const k = await classRepo.findOne({ where: { id } });
        if (!k || k.ownerId !== user.userId) throw new Error('nicht gefunden');
        return k;
      },
    };
    svc = new SchoolClassesService(
      ds.getRepository(SchoolClass), ds.getRepository(SchoolClassStudent), ds.getRepository(SchoolClassRequest),
      classRepo, ds.getRepository(ClassStudent), ds.getRepository(User), classes as any,
    );
  });
  afterEach(() => ds.destroy());

  it('liest ein, aktualisiert gleichnamige Klassen und überspringt umbenannte', async () => {
    const first = await svc.importForAdmin(admin, { rows: [
      row('TG12', 'Meier', 'Max', 'mmeier'), row('TG12', 'Ost', 'Eva', 'eost'), row('TG12', 'Albrecht', 'Adrain', ''),
      row('E1', 'Kurz', 'Tim', 'tkurz'),
    ] });
    expect(first.classes.map((c: any) => [c.name, c.action, c.added])).toEqual([['TG12', 'created', 3], ['E1', 'created', 1]]);

    const second = await svc.importForAdmin(admin, { rows: [
      row('TG12', 'Meier', 'Max', 'mmeier'), row('TG12', 'Albrecht', 'Adrian', 'aalbrecht'), row('TG12', 'Neu', 'Nina', 'nneu'),
      row('TG 12a', 'Ost', 'Eva', 'eost'),
    ] });
    const tg = second.classes.find((c: any) => c.name === 'TG12');
    expect(tg).toMatchObject({ action: 'updated', added: 1, updated: 1, unchanged: 1, renamed: ['Adrain Albrecht → Adrian Albrecht'] });
    // „TG 12a“: Eva steht schon in TG12 – aber TG12 steht selbst in der Datei, also eine echte neue Klasse.
    expect(second.classes.find((c: any) => c.name === 'TG 12a').action).toBe('created');

    const third = await svc.importForAdmin(admin, { rows: [row('E1-neu', 'Kurz', 'Tim', 'tkurz')] });
    expect(third.classes[0]).toMatchObject({ action: 'skipped', conflictWith: 'E1' });
    expect((await svc.listForAdmin(admin)).classes.map((c: any) => c.name)).toEqual(['E1', 'TG 12a', 'TG12']);
  });

  it('Übernahme mit Freigabe und Aktualisieren über den Schuladmin', async () => {
    await svc.importForAdmin(admin, { rows: [row('TG12', 'Meier', 'Max', 'mmeier'), row('TG12', 'Ost', 'Eva', 'eost')] });
    const sc = (await svc.listForTeacher(teacher)).classes[0];
    expect(sc).toMatchObject({ name: 'TG12', studentCount: 2, request: null });

    const asked = await svc.take(sc.id, teacher, {});
    expect(asked.status).toBe('pending');
    await expect(svc.pendingCount(admin)).resolves.toBe(1);
    const list = await svc.listForAdmin(admin);
    const req = list.classes[0].requests[0];
    expect(req).toMatchObject({ status: 'pending', name: 'Frau Lehrer' });

    const ok = await svc.answerRequest(req.id, admin, true);
    expect(ok).toMatchObject({ className: 'TG12', added: 2 });
    const students = await ds.getRepository(ClassStudent).find({ where: { classId: ok.classId } });
    expect(students.map((s) => s.loginId).sort()).toEqual(['eost', 'mmeier']);

    // Später kommt ein Schüler dazu: die Lehrkraft gleicht ab, ihre Einträge (PIN) bleiben.
    await svc.importForAdmin(admin, { rows: [row('TG12', 'Neu', 'Nina', 'nneu')] });
    const preview = await svc.syncClass(ok.classId, teacher, { dryRun: true });
    expect(preview).toMatchObject({ added: 1, updated: 0, unchanged: 2 });
    await svc.syncClass(ok.classId, teacher, {});
    expect(await ds.getRepository(ClassStudent).count({ where: { classId: ok.classId } })).toBe(3);
  });

  it('Autoregistrierung: sofort übernommen, eigene gleichnamige Klasse wird ergänzt', async () => {
    await svc.importForAdmin(admin, { rows: [row('TG12', 'Meier', 'Max', 'mmeier')], autoRegister: true });
    await ds.getRepository(StudentClass).save({ id: 'k1', name: 'tg12', ownerId: 't1', schoolYear: YEAR, strict: false } as any);
    await ds.getRepository(ClassStudent).save({ id: 'st1', classId: 'k1', firstName: 'Max', lastName: 'Maier', status: 'confirmed', importId: null } as any);
    const sc = (await svc.listForTeacher(teacher)).classes[0];
    const res: any = await svc.take(sc.id, teacher, {});
    expect(res).toMatchObject({ status: 'linked', classId: 'k1', added: 0, updated: 1 });
    const st = await ds.getRepository(ClassStudent).findOne({ where: { id: 'st1' } });
    expect(st).toMatchObject({ lastName: 'Meier', loginId: 'mmeier' });
  });

  it('⏭ Versetzen: Kopie ins nächste Schuljahr mit Freigaben, Löschen nur bei der Schule', async () => {
    await svc.importForAdmin(admin, { rows: [row('TG11', 'Meier', 'Max', 'mmeier'), row('E3', 'Kurz', 'Tim', 'tkurz')] });
    const before = await svc.listForAdmin(admin);
    const tg = before.classes.find((c: any) => c.name === 'TG11');
    const e3 = before.classes.find((c: any) => c.name === 'E3');
    expect(tg.suggestedNext).toBe('TG12');
    await svc.take(tg.id, teacher, {});
    await svc.answerRequest((await svc.listForAdmin(admin)).classes.find((c: any) => c.name === 'TG11').requests[0].id, admin, true);

    const res = await svc.promote(admin, { schoolYear: YEAR, items: [{ id: tg.id, action: 'promote', name: 'TG12' }, { id: e3.id, action: 'delete' }] });
    expect(res).toMatchObject({ schoolYear: 'SJ27-28', promoted: ['TG11 → TG12'], deleted: ['E3'] });
    expect((await svc.listForAdmin(admin)).classes.map((c: any) => [c.name, c.promotedTo])).toEqual([['TG11', [{ name: 'TG12', schoolYear: 'SJ27-28' }]]]);
    const next = await svc.listForAdmin(admin, 'SJ27-28');
    expect(next.classes[0]).toMatchObject({ name: 'TG12', students: [expect.objectContaining({ loginId: 'mmeier' })] });

    // Die Lehrkraft wechselt selbst ins neue Jahr; ihre Klasse bekommt die versetzte als Vorschlag und ist schon freigegeben.
    const old = await ds.getRepository(StudentClass).findOne({ where: { ownerId: 't1', schoolYear: YEAR } });
    await ds.getRepository(StudentClass).save({ id: 'k2', name: 'TG12', ownerId: 't1', schoolYear: 'SJ27-28', strict: false, predecessorId: old!.id } as any);
    const offer = await svc.listForTeacher(teacher, 'SJ27-28', 'k2');
    expect(offer.classes[0]).toMatchObject({ name: 'TG12', suggested: true, request: 'approved' });
    await expect(svc.take(offer.classes[0].id, teacher, { classId: 'k2' })).resolves.toMatchObject({ status: 'linked', classId: 'k2', added: 1 });
  });

  it('alle eigenen Klassen abgleichen: UserIDs kommen in vorhandene Klassen', async () => {
    await svc.importForAdmin(admin, { rows: [row('TG12', 'Meier', 'Max', 'mmeier'), row('E1', 'Kurz', 'Tim', 'tkurz')] });
    await svc.updateForAdmin((await svc.listForAdmin(admin)).classes.find((c: any) => c.name === 'TG12').id, admin, { autoRegister: true });
    const repo = ds.getRepository(StudentClass);
    await repo.save([
      { id: 'k1', name: 'TG12', ownerId: 't1', schoolYear: YEAR, strict: false },
      { id: 'k2', name: 'E1', ownerId: 't1', schoolYear: YEAR, strict: false },
      { id: 'k3', name: 'AG Robotik', ownerId: 't1', schoolYear: YEAR, strict: false },
    ] as any);
    await ds.getRepository(ClassStudent).save({ id: 'st1', classId: 'k1', firstName: 'Max', lastName: 'Meier', status: 'confirmed', importId: null } as any);

    const preview = await svc.matchAll(teacher, { dryRun: true });
    expect(preview.classes.map((c: any) => [c.className, c.action])).toEqual([['AG Robotik', 'none'], ['E1', 'request'], ['TG12', 'link']]);
    expect(await ds.getRepository(ClassStudent).findOne({ where: { id: 'st1' } })).toMatchObject({ loginId: null });

    await svc.matchAll(teacher, {});
    expect(await ds.getRepository(ClassStudent).findOne({ where: { id: 'st1' } })).toMatchObject({ loginId: 'mmeier' });
    expect(await svc.pendingCount(admin)).toBe(1);
    expect((await svc.matchAll(teacher, { dryRun: true })).classes.map((c: any) => c.action)).toEqual(['none', 'pending', 'sync']);
  });

  it('alle Klassen aus einer Datei im Schuladmin-Format aktualisieren', async () => {
    await ds.getRepository(StudentClass).save({ id: 'k1', name: 'TG12', ownerId: 't1', schoolYear: YEAR, strict: false } as any);
    await ds.getRepository(ClassStudent).save({ id: 'st1', classId: 'k1', firstName: 'Max', lastName: 'Maier', status: 'confirmed', importId: null } as any);
    const rows = [row('tg12', 'Meier', 'Max', 'mmeier'), row('TG12', 'Neu', 'Nina', 'nneu'), row('E1', 'Kurz', 'Tim', 'tkurz')];
    const preview = await svc.updateFromFile(teacher, { rows, dryRun: true });
    expect(preview.classes).toEqual([
      expect.objectContaining({ className: 'TG12', action: 'update', added: 1, updated: 1 }),
      expect.objectContaining({ className: 'E1', action: 'none' }),
    ]);
    await svc.updateFromFile(teacher, { rows });
    expect(await ds.getRepository(ClassStudent).findOne({ where: { id: 'st1' } })).toMatchObject({ lastName: 'Meier', loginId: 'mmeier' });
    expect(await ds.getRepository(ClassStudent).count({ where: { classId: 'k1' } })).toBe(2);
  });

  it('nur Schuladmins der eigenen Schule', async () => {
    await expect(svc.importForAdmin(teacher, { rows: [row('A', 'B', 'C', 'd')] })).rejects.toThrow('Nur für Schuladmins');
    await svc.importForAdmin(admin, { rows: [row('A', 'B', 'C', 'd')] });
    const id = (await svc.listForAdmin(admin)).classes[0].id;
    await expect(svc.removeForAdmin(id, { userId: 'x', schoolId: 's2', isSchoolAdmin: true })).rejects.toThrow('nicht gefunden');
    await expect(svc.take(id, { userId: 'y', schoolId: 's2' }, {})).rejects.toThrow('nicht gefunden');
  });
});
