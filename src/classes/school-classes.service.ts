import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as crypto from 'crypto';
import { SchoolClass } from '../core/entities/school-class.entity';
import { SchoolClassStudent } from '../core/entities/school-class-student.entity';
import { SchoolClassRequest } from '../core/entities/school-class-request.entity';
import { StudentClass } from '../core/entities/student-class.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { User } from '../core/entities/user.entity';
import { ClassesService } from './classes.service';
import { isSchoolYear, shiftSchoolYear, suggestNextClassName } from './school-year';
import { planRosterSync, rosterOverlap, sameClassByStudents, groupByClass, RosterPlan } from './school-roster';

const MAX_ROWS = 5000;
const cleanName = (v: unknown, max = 40) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const lower = (s: string) => s.toLocaleLowerCase('de');
const full = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`.trim();

/** Zusammenfassung eines Abgleichs für Vorschau und Meldung. */
const summaryOf = (plan: RosterPlan) => ({
  added: plan.add.length,
  updated: plan.update.length,
  unchanged: plan.unchanged,
  renamed: plan.renamed,
  duplicates: plan.duplicates,
  addNames: plan.add.map(full),
  updateNames: plan.update.map(full),
});

/**
 * Klassenliste der Schule (docs/klassen-und-schuljahr.md#klassen-der-schule).
 *
 * Der Schuladmin liest eine Tabelle mit Nachname, Vorname, Klasse und UserID für viele Klassen ein.
 * Gleicher Klassenname: Die Klasse wird aktualisiert. Anderer Name, aber teilweise dieselben Schüler:
 * Die Klasse wird übersprungen und am Ende begründet – der Schuladmin gleicht dann den Namen an.
 *
 * Lehrkräfte übernehmen Klassen daraus in eine eigene Klasse (Kopie der Schülerliste, wie bisher je
 * Lehrkraft) – mit Autoregistrierung sofort, sonst nach Freigabe. Schülernamen sieht eine Lehrkraft erst
 * nach der Übernahme.
 *
 * Die Löschregel der Klassen gilt hier nicht: Zum Schuljahresende versetzt der Schuladmin die Klassen
 * ins nächste Schuljahr oder löscht sie (⏭ Versetzen). Die Lehrkräfte machen ihren Wechsel selbst und
 * übernehmen die versetzte Klasse dann wieder über „Klasse aktualisieren → Über den Schuladmin“.
 */
@Injectable()
export class SchoolClassesService {
  constructor(
    @InjectRepository(SchoolClass) private readonly scRepo: Repository<SchoolClass>,
    @InjectRepository(SchoolClassStudent) private readonly scsRepo: Repository<SchoolClassStudent>,
    @InjectRepository(SchoolClassRequest) private readonly reqRepo: Repository<SchoolClassRequest>,
    @InjectRepository(StudentClass) private readonly classRepo: Repository<StudentClass>,
    @InjectRepository(ClassStudent) private readonly studentRepo: Repository<ClassStudent>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly classes: ClassesService,
  ) {}

  private async removeSchoolClasses(ids: string[]) {
    await this.scsRepo.delete({ schoolClassId: In(ids) });
    await this.reqRepo.delete({ schoolClassId: In(ids) });
    await this.classRepo.update({ schoolClassId: In(ids) }, { schoolClassId: null });
    await this.scRepo.delete({ id: In(ids) });
  }

  // ---------- Schuladmin ----------

  private requireSchoolAdmin(user: any): string {
    if (!user?.isSchoolAdmin || !user?.schoolId) throw new ForbiddenException('Nur für Schuladmins.');
    return user.schoolId;
  }

  private async ownSchoolClass(id: string, user: any): Promise<SchoolClass> {
    const schoolId = this.requireSchoolAdmin(user);
    const sc = await this.scRepo.findOne({ where: { id } });
    if (!sc || sc.schoolId !== schoolId) throw new NotFoundException('Klasse nicht gefunden.');
    return sc;
  }

  private async year(value: unknown) {
    return isSchoolYear(value) ? value : this.classes.currentSchoolYear();
  }

  /** Klassen der Schule in einem Schuljahr mit Schülern und Anfragen der Lehrkräfte. */
  async listForAdmin(user: any, schoolYear?: string) {
    const schoolId = this.requireSchoolAdmin(user);
    const current = await this.classes.currentSchoolYear();
    const year = await this.year(schoolYear);
    const all = await this.scRepo.find({ where: { schoolId }, select: ['id', 'schoolYear'] });
    const years = [...new Set([current, ...all.map((c) => c.schoolYear)])].sort().reverse();
    const list = await this.scRepo.find({ where: { schoolId, schoolYear: year } });
    const ids = list.map((c) => c.id);
    const students = ids.length ? await this.scsRepo.find({ where: { schoolClassId: In(ids) } }) : [];
    const requests = ids.length ? await this.reqRepo.find({ where: { schoolClassId: In(ids) } }) : [];
    const teachers = requests.length ? await this.userRepo.find({ where: { id: In([...new Set(requests.map((r) => r.teacherId))]) } }) : [];
    const teacherName = new Map(teachers.map((t) => [t.id, { name: t.displayName || t.email, email: t.email }]));
    const successors = ids.length ? await this.scRepo.find({ where: { predecessorId: In(ids) } }) : [];
    return {
      schoolYear: year,
      current,
      years,
      pending: await this.pendingCount(user),
      classes: list
        .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
        .map((c) => ({
          id: c.id,
          name: c.name,
          schoolYear: c.schoolYear,
          autoRegister: c.autoRegister,
          suggestedNext: suggestNextClassName(c.name),
          promotedTo: successors.filter((x) => x.predecessorId === c.id).map((x) => ({ name: x.name, schoolYear: x.schoolYear })),
          students: students
            .filter((s) => s.schoolClassId === c.id)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de'))
            .map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, loginId: s.loginId })),
          requests: requests
            .filter((r) => r.schoolClassId === c.id && r.status !== 'declined')
            .map((r) => ({ id: r.id, status: r.status, at: r.createdAt, ...(teacherName.get(r.teacherId) || { name: '?', email: '' }) })),
        })),
    };
  }

  /** Anfragen, die auf die Freigabe warten (alle Schuljahre). */
  async pendingCount(user: any) {
    const schoolId = this.requireSchoolAdmin(user);
    const ids = (await this.scRepo.find({ where: { schoolId }, select: ['id'] })).map((c) => c.id);
    return ids.length ? this.reqRepo.count({ where: { schoolClassId: In(ids), status: 'pending' } }) : 0;
  }

  /**
   * Klassenliste einlesen: `{ rows: [{ className, lastName, firstName, loginId }], schoolYear?, autoRegister?, dryRun? }`.
   * Ergebnis je Klasse: `created` | `updated` | `skipped` (mit Grund).
   */
  async importForAdmin(user: any, body: { rows?: any[]; schoolYear?: string; autoRegister?: boolean; dryRun?: boolean }) {
    const schoolId = this.requireSchoolAdmin(user);
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    if (raw.length === 0) throw new BadRequestException('Die Datei enthält keine Schüler.');
    if (raw.length > MAX_ROWS) throw new BadRequestException(`Höchstens ${MAX_ROWS} Zeilen je Import.`);
    const groups = groupByClass(raw, await this.year(body?.schoolYear));
    if (groups.length === 0) throw new BadRequestException('In der Datei steht bei keinem Schüler eine Klasse.');

    const existing = await this.scRepo.find({ where: { schoolId, schoolYear: In([...new Set(groups.map((g) => g.schoolYear))]) } });
    const students = existing.length ? await this.scsRepo.find({ where: { schoolClassId: In(existing.map((c) => c.id)) } }) : [];
    const studentsOf = (id: string) => students.filter((s) => s.schoolClassId === id);
    const namesInFile = new Set(groups.map((g) => `${g.schoolYear}|${lower(g.name)}`));

    const result: any[] = [];
    for (const g of groups) {
      const sameYear = existing.filter((c) => c.schoolYear === g.schoolYear);
      const target = sameYear.find((c) => lower(c.name) === lower(g.name));
      const base = { name: g.name, schoolYear: g.schoolYear, rows: g.students.length };
      if (!target) {
        // Anderer Name, aber mindestens die Hälfte dieselben Schüler (in einer der beiden Richtungen):
        // wohl dieselbe Klasse unter anderem Namen.
        const clash = sameYear
          .filter((c) => !namesInFile.has(`${c.schoolYear}|${lower(c.name)}`))
          .map((c) => ({ c, size: studentsOf(c.id).length, n: rosterOverlap(studentsOf(c.id), g.students) }))
          .filter((x) => sameClassByStudents(x.n, g.students.length, x.size))
          .sort((a, b) => b.n - a.n)[0];
        if (clash) {
          result.push({
            ...base, action: 'skipped', conflictWith: clash.c.name,
            reason: `${clash.n} von ${g.students.length} Schülern stehen schon in der Klasse „${clash.c.name}“ (${clash.size} Schüler). `
              + `Wenn es dieselbe Klasse ist: „${clash.c.name}“ in „${g.name}“ umbenennen und noch einmal einlesen.`,
          });
          continue;
        }
      }
      const current = target ? studentsOf(target.id) : [];
      const plan = planRosterSync(current, g.students);
      result.push({ ...base, action: target ? 'updated' : 'created', ...summaryOf(plan) });
      if (body?.dryRun) continue;

      let sc = target;
      if (!sc) {
        sc = await this.scRepo.save(this.scRepo.create({
          id: crypto.randomUUID(), schoolId, schoolYear: g.schoolYear, name: g.name, autoRegister: !!body?.autoRegister,
        }));
        existing.push(sc);
      }
      await this.applyToSchoolList(sc.id, current, plan);
    }
    return { dryRun: !!body?.dryRun, classes: result };
  }

  private async applyToSchoolList(schoolClassId: string, current: SchoolClassStudent[], plan: RosterPlan) {
    const byId = new Map(current.map((s) => [s.id, s]));
    const changed = plan.update.map((u) => Object.assign(byId.get(u.id) as SchoolClassStudent, { firstName: u.firstName, lastName: u.lastName, loginId: u.loginId }));
    const added = plan.add.map((r) => this.scsRepo.create({
      id: crypto.randomUUID(), schoolClassId, firstName: r.firstName, lastName: r.lastName, loginId: r.loginId || null,
    }));
    if (changed.length || added.length) await this.scsRepo.save([...changed, ...added]);
  }

  /**
   * ⏭ Versetzen ins nächste Schuljahr: `{ schoolYear, items: [{ id, action: 'promote' | 'delete' | 'keep', name? }] }`.
   * Versetzt wird eine Kopie mit Schülern und Autoregistrierung; gibt es im neuen Jahr schon eine Klasse mit dem
   * Namen, wird sie ergänzt. Freigaben gehen mit – wer die Klasse hatte, übernimmt die neue ohne neue Anfrage.
   * Gelöscht wird nur die Klasse der Schule; die Klassen der Lehrkräfte bleiben, wie sie sind.
   */
  async promote(user: any, body: { schoolYear?: string; items?: Array<{ id?: string; action?: string; name?: string }> }) {
    const schoolId = this.requireSchoolAdmin(user);
    const from = await this.year(body?.schoolYear);
    const to = shiftSchoolYear(from, 1);
    const items = Array.isArray(body?.items) ? body.items : [];
    const list = await this.scRepo.find({ where: { schoolId, schoolYear: from } });
    const byId = new Map(list.map((c) => [c.id, c]));
    const next = await this.scRepo.find({ where: { schoolId, schoolYear: to } });
    const promoted: string[] = [];
    const deleted: string[] = [];
    for (const it of items) {
      const sc = byId.get(String(it?.id || ''));
      if (!sc) continue;
      if (it.action === 'delete') { await this.removeSchoolClasses([sc.id]); deleted.push(sc.name); continue; }
      if (it.action !== 'promote') continue;
      const name = cleanName(it.name) || suggestNextClassName(sc.name);
      let target = next.find((c) => lower(c.name) === lower(name));
      if (!target) {
        target = await this.scRepo.save(this.scRepo.create({
          id: crypto.randomUUID(), schoolId, schoolYear: to, name, autoRegister: sc.autoRegister, predecessorId: sc.id,
        }));
        next.push(target);
      } else if (!target.predecessorId) {
        target.predecessorId = sc.id;
        await this.scRepo.save(target);
      }
      const rows = await this.scsRepo.find({ where: { schoolClassId: sc.id } });
      const current = await this.scsRepo.find({ where: { schoolClassId: target.id } });
      await this.applyToSchoolList(target.id, current, planRosterSync(current, rows));
      const approved = await this.reqRepo.find({ where: { schoolClassId: sc.id, status: 'approved' } });
      const have = new Set((await this.reqRepo.find({ where: { schoolClassId: target.id } })).map((r) => r.teacherId));
      const carried = approved.filter((r) => !have.has(r.teacherId)).map((r) => this.reqRepo.create({
        id: crypto.randomUUID(), schoolClassId: target!.id, teacherId: r.teacherId, classId: null, status: 'approved',
      }));
      if (carried.length) await this.reqRepo.save(carried);
      promoted.push(`${sc.name} → ${target.name}`);
    }
    return { success: true, schoolYear: to, promoted, deleted };
  }

  /** `{ name?, autoRegister? }` – Umbenennen prüft, dass der Name im Schuljahr frei ist. */
  async updateForAdmin(id: string, user: any, body: { name?: string; autoRegister?: boolean }) {
    const sc = await this.ownSchoolClass(id, user);
    if (body?.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) throw new BadRequestException('Bitte einen Klassennamen angeben.');
      const same = await this.scRepo.find({ where: { schoolId: sc.schoolId, schoolYear: sc.schoolYear } });
      if (same.some((c) => c.id !== sc.id && lower(c.name) === lower(name))) throw new BadRequestException(`Die Klasse „${name}“ gibt es im ${sc.schoolYear} schon.`);
      sc.name = name;
    }
    if (body?.autoRegister !== undefined) sc.autoRegister = !!body.autoRegister;
    await this.scRepo.save(sc);
    // Autoregistrierung eingeschaltet: Wer schon wartet, ist damit freigegeben.
    let approved = 0;
    if (sc.autoRegister) {
      for (const r of await this.reqRepo.find({ where: { schoolClassId: sc.id, status: 'pending' } })) { await this.approve(r, sc); approved++; }
    }
    return { success: true, approved };
  }

  /** Autoregistrierung für alle Klassen eines Schuljahres an oder aus. */
  async setAutoRegisterAll(user: any, body: { schoolYear?: string; autoRegister?: boolean }) {
    const schoolId = this.requireSchoolAdmin(user);
    const list = await this.scRepo.find({ where: { schoolId, schoolYear: await this.year(body?.schoolYear) } });
    let approved = 0;
    for (const sc of list) approved += (await this.updateForAdmin(sc.id, user, { autoRegister: !!body?.autoRegister })).approved;
    return { success: true, classes: list.length, approved };
  }

  async removeForAdmin(id: string, user: any) {
    const sc = await this.ownSchoolClass(id, user);
    await this.removeSchoolClasses([sc.id]);
    return { success: true };
  }

  async removeStudentForAdmin(id: string, studentId: string, user: any) {
    const sc = await this.ownSchoolClass(id, user);
    await this.scsRepo.delete({ id: studentId, schoolClassId: sc.id });
    return { success: true };
  }

  async answerRequest(requestId: string, user: any, accept: boolean) {
    const req = await this.reqRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Anfrage nicht gefunden.');
    const sc = await this.ownSchoolClass(req.schoolClassId, user);
    if (!accept) {
      req.status = 'declined';
      await this.reqRepo.save(req);
      return { success: true };
    }
    const res = await this.approve(req, sc);
    return { success: true, ...res };
  }

  /**
   * Freigeben: Die Lehrkraft bekommt die Klasse – ihre gewünschte Klasse, sonst eine gleichnamige
   * eigene im Schuljahr, sonst eine neue – und die Schülerliste wird abgeglichen.
   */
  private async approve(req: SchoolClassRequest, sc: SchoolClass) {
    const teacher = await this.userRepo.findOne({ where: { id: req.teacherId } });
    if (!teacher) throw new NotFoundException('Die Lehrkraft gibt es nicht mehr.');
    let klasse = req.classId ? await this.classRepo.findOne({ where: { id: req.classId, ownerId: teacher.id } }) : null;
    if (!klasse) {
      const mine = await this.classRepo.find({ where: { ownerId: teacher.id, schoolYear: sc.schoolYear } });
      klasse = mine.find((c) => c.schoolClassId === sc.id)
        || mine.find((c) => !c.schoolClassId && lower(c.name) === lower(sc.name))
        || null;
      if (!klasse) {
        const taken = new Set(mine.map((c) => lower(c.name)));
        let name = sc.name;
        for (let i = 2; taken.has(lower(name)); i++) name = `${sc.name} (${i})`;
        klasse = this.classRepo.create({
          id: crypto.randomUUID(), name, ownerId: teacher.id, schoolYear: sc.schoolYear, strict: false,
          predecessorId: null, createdBy: teacher.id,
        });
      }
    }
    klasse.schoolClassId = sc.id;
    await this.classRepo.save(klasse);
    req.status = 'approved';
    req.classId = klasse.id;
    await this.reqRepo.save(req);
    const { summary, apply } = await this.planClassSync(klasse.id, sc.id);
    await apply();
    return { classId: klasse.id, className: klasse.name, ...summary };
  }

  // ---------- Lehrkraft ----------

  private async mayUse(sc: SchoolClass, teacherId: string) {
    if (sc.autoRegister) return true;
    return !!(await this.reqRepo.findOne({ where: { schoolClassId: sc.id, teacherId, status: 'approved' } }));
  }

  /** Klassen der eigenen Schule zum Übernehmen – ohne Schülernamen. */
  async listForTeacher(user: any, schoolYear?: string, forClassId?: string) {
    if (!user?.schoolId) return { schoolYear: await this.year(schoolYear), classes: [], noSchool: true };
    const year = await this.year(schoolYear);
    const list = await this.scRepo.find({ where: { schoolId: user.schoolId, schoolYear: year } });
    const ids = list.map((c) => c.id);
    const counts = ids.length
      ? await this.scsRepo.createQueryBuilder('s').select('s.schoolClassId', 'id').addSelect('COUNT(*)', 'n')
        .where('s.schoolClassId IN (:...ids)', { ids }).groupBy('s.schoolClassId').getRawMany()
      : [];
    const mine = ids.length ? await this.reqRepo.find({ where: { schoolClassId: In(ids), teacherId: user.userId } }) : [];
    const linked = ids.length ? await this.classRepo.find({ where: { ownerId: user.userId, schoolClassId: In(ids) } }) : [];
    // Vorschlag für eine eigene Klasse: die Klasse der Schule, in die ihre Vorjahresklasse versetzt wurde.
    let suggestedId: string | null = null;
    if (forClassId) {
      const own = await this.classRepo.findOne({ where: { id: forClassId, ownerId: user.userId } });
      const before = own?.predecessorId ? await this.classRepo.findOne({ where: { id: own.predecessorId } }) : null;
      if (before?.schoolClassId) suggestedId = list.find((c) => c.predecessorId === before.schoolClassId)?.id || null;
    }
    return {
      schoolYear: year,
      classes: list
        .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
        .map((c) => ({
          id: c.id,
          name: c.name,
          autoRegister: c.autoRegister,
          suggested: c.id === suggestedId,
          studentCount: Number(counts.find((x) => x.id === c.id)?.n || 0),
          request: mine.find((r) => r.schoolClassId === c.id)?.status || null,
          linkedClasses: linked.filter((k) => k.schoolClassId === c.id).map((k) => ({ id: k.id, name: k.name })),
        })),
    };
  }

  /**
   * Klasse der Schulliste übernehmen: `{ classId? }` verbindet sie mit einer eigenen Klasse, sonst entsteht
   * eine neue. Mit Autoregistrierung (oder schon freigegeben) sofort, sonst wartet die Anfrage.
   */
  async take(schoolClassId: string, user: any, body: { classId?: string | null }) {
    const sc = await this.scRepo.findOne({ where: { id: schoolClassId } });
    if (!sc || !user?.schoolId || sc.schoolId !== user.schoolId) throw new NotFoundException('Klasse nicht gefunden.');
    const classId = body?.classId ? String(body.classId) : null;
    if (classId) await this.classes.ownedClass(classId, user);
    let req = await this.reqRepo.findOne({ where: { schoolClassId: sc.id, teacherId: user.userId } });
    if (!req) req = this.reqRepo.create({ id: crypto.randomUUID(), schoolClassId: sc.id, teacherId: user.userId, classId, status: 'pending' });
    else {
      req.classId = classId;
      if (req.status === 'declined') req.status = 'pending';
    }
    if (await this.mayUse(sc, user.userId)) {
      const res = await this.approve(req, sc);
      return { status: 'linked', ...res };
    }
    await this.reqRepo.save(req);
    return { status: 'pending', name: sc.name };
  }

  /**
   * Alle eigenen Klassen eines Schuljahres mit den Klassen der Schule abgleichen: verbundene aktualisieren,
   * unverbundene mit einer gleichnamigen Klasse der Schule verbinden (mit Autoregistrierung oder Freigabe
   * sofort, sonst als Anfrage). `{ schoolYear?, dryRun? }` – die Vorschau sagt je Klasse, was passiert.
   */
  async matchAll(user: any, body: { schoolYear?: string; dryRun?: boolean }) {
    if (!user?.schoolId) return { schoolYear: await this.year(body?.schoolYear), classes: [], noSchool: true };
    const year = await this.year(body?.schoolYear);
    const mine = await this.classRepo.find({ where: { ownerId: user.userId, schoolYear: year } });
    const school = await this.scRepo.find({ where: { schoolId: user.schoolId, schoolYear: year } });
    const byId = new Map(school.map((c) => [c.id, c]));
    const out: any[] = [];
    for (const k of mine.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))) {
      const sc = (k.schoolClassId && byId.get(k.schoolClassId)) || school.find((c) => lower(c.name) === lower(k.name)) || null;
      const base = { classId: k.id, className: k.name, schoolClass: sc?.name || null };
      if (!sc) { out.push({ ...base, action: 'none' }); continue; }
      const usable = await this.mayUse(sc, user.userId);
      const linked = k.schoolClassId === sc.id;
      if (!usable) {
        const req = await this.reqRepo.findOne({ where: { schoolClassId: sc.id, teacherId: user.userId } });
        const waiting = req?.status === 'pending';
        out.push({ ...base, action: waiting ? 'pending' : 'request' });
        if (!body?.dryRun && !waiting) await this.take(sc.id, user, { classId: k.id });
        continue;
      }
      const { summary, apply } = await this.planClassSync(k.id, sc.id);
      out.push({ ...base, action: linked ? 'sync' : 'link', ...summary });
      if (body?.dryRun) continue;
      if (linked) await apply();
      else await this.take(sc.id, user, { classId: k.id });
    }
    return { schoolYear: year, dryRun: !!body?.dryRun, classes: out };
  }

  /** Verbindung einer eigenen Klasse zur Schulliste: Name und Stand. */
  async linkOf(classId: string, user: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const sc = klasse.schoolClassId ? await this.scRepo.findOne({ where: { id: klasse.schoolClassId } }) : null;
    const pending = await this.reqRepo.findOne({ where: { classId, teacherId: user.userId, status: 'pending' } });
    const pendingSc = pending ? await this.scRepo.findOne({ where: { id: pending.schoolClassId } }) : null;
    return {
      linked: sc ? { id: sc.id, name: sc.name, schoolYear: sc.schoolYear, usable: await this.mayUse(sc, user.userId) } : null,
      pending: pendingSc ? { id: pendingSc.id, name: pendingSc.name } : null,
    };
  }

  /** Eigene Klasse mit der Schulliste abgleichen; `{ dryRun }` liefert die Vorschau. */
  async syncClass(classId: string, user: any, body: { dryRun?: boolean }) {
    const klasse = await this.classes.ownedClass(classId, user);
    const sc = klasse.schoolClassId ? await this.scRepo.findOne({ where: { id: klasse.schoolClassId } }) : null;
    if (!sc) throw new BadRequestException('Diese Klasse ist mit keiner Klasse der Schule verbunden.');
    if (!(await this.mayUse(sc, user.userId))) throw new ForbiddenException(`„${sc.name}“ wartet noch auf die Freigabe durch den Schuladmin.`);
    const { summary, apply } = await this.planClassSync(klasse.id, sc.id);
    if (body?.dryRun) return { dryRun: true, schoolClass: sc.name, ...summary };
    await apply();
    return { success: true, schoolClass: sc.name, ...summary };
  }

  /** Schülerliste der Lehrkraft gegen die Schulliste – Lehrkräfte als Teilnehmer bleiben außen vor. */
  private async planClassSync(classId: string, schoolClassId: string) {
    const current = (await this.studentRepo.find({ where: { classId } })).filter((s) => !s.userId);
    const rows = await this.scsRepo.find({ where: { schoolClassId } });
    const plan = planRosterSync(current, rows.map((r) => ({ firstName: r.firstName, lastName: r.lastName, loginId: r.loginId })));
    const apply = async () => {
      const byId = new Map(current.map((s) => [s.id, s]));
      const changed = plan.update.map((u) => Object.assign(byId.get(u.id) as ClassStudent, {
        firstName: u.firstName, lastName: u.lastName, loginId: u.loginId, status: 'confirmed' as const,
      }));
      const added = plan.add.map((r) => this.studentRepo.create({
        id: crypto.randomUUID(), classId, firstName: r.firstName, lastName: r.lastName, loginId: r.loginId || null,
        importId: null, status: 'confirmed',
      }));
      if (changed.length || added.length) await this.studentRepo.save([...changed, ...added]);
    };
    return { summary: summaryOf(plan), apply };
  }
}
