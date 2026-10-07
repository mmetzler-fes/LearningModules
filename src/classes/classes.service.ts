import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import { StudentClass } from '../core/entities/student-class.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { Result } from '../core/entities/result.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { ClassShare } from '../core/entities/class-share.entity';
import { User } from '../core/entities/user.entity';
import { isSchoolYear, schoolYearOfDate, compareSchoolYearsDesc, splitSchoolYearPrefix, shiftSchoolYear, suggestNextClassName } from './school-year';
import { planStudentImport, nameKey, ImportRow } from './student-import';
import { matchStudent, splitTypedName, normalizeName } from './name-match';
import { isExpired, deleteAfter, oldestKeptYear } from './retention';
import { shortName } from './short-name';

const SCHOOL_YEAR_KEY = 'school_year';
/** Wann der Admin ins aktuelle Schuljahr gewechselt hat: `{ year, at }` – Grundlage der Löschfrist. */
const SCHOOL_YEAR_SWITCH_KEY = 'school_year_switched';
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_CLASSES = 60;

const cleanName = (v: unknown, max = 80) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);

/** Sortierung der Schülerliste: Name, dann Vorname. */
const byLastFirst = (a: ClassStudent, b: ClassStudent) =>
  a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de');

/**
 * Klassen und Schülerlisten einer Lehrkraft, dazu das aktuelle Schuljahr.
 *
 * Jede Lehrkraft sieht nur ihre eigenen Klassen. Schülerdaten sind
 * bewusst nicht schulweit, siehe `StudentClass`.
 */
@Injectable()
export class ClassesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ClassesService.name);
  private retentionTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(StudentClass) private readonly classRepo: Repository<StudentClass>,
    @InjectRepository(ClassStudent) private readonly studentRepo: Repository<ClassStudent>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(ClassShare) private readonly shareRepo: Repository<ClassShare>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Bestand ohne Schuljahr kommt ins aktuelle: Klassen aus der Zeit vor den
   * Schuljahren und alle bisherigen Ergebnisse. Das Programm ist jung genug,
   * dass praktisch alles aus dem laufenden Schuljahr stammt. Läuft bei jedem
   * Start, tut aber nur etwas, solange es solche Einträge gibt.
   */
  async onApplicationBootstrap() {
    try {
      const year = await this.currentSchoolYear();
      const classes = await this.classRepo.find({ where: { schoolYear: IsNull() } });
      for (const c of classes) {
        c.schoolYear = year;
        if (!c.ownerId && c.createdBy) c.ownerId = c.createdBy;
      }
      if (classes.length) await this.classRepo.save(classes);
      const results = await this.resultRepo.update({ schoolYear: IsNull() }, { schoolYear: year });
      if (classes.length || results.affected) {
        this.logger.log(`Schuljahr ${year} nachgetragen: ${classes.length} Klassen, ${results.affected ?? 0} Ergebnisse.`);
      }
    } catch (err) {
      this.logger.error('Schuljahr nachtragen fehlgeschlagen', err as any);
    }
    await this.runRetention();
    this.retentionTimer = setInterval(() => void this.runRetention(), RETENTION_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
  }

  // ---- Löschregel ----

  /** Ab wann abgelaufene Schuljahre gelöscht werden. */
  private async retentionDeadline(current: string): Promise<Date> {
    const entry = await this.configRepo.findOne({ where: { key: SCHOOL_YEAR_SWITCH_KEY } });
    const switched = entry?.value?.year === current && entry?.value?.at ? new Date(entry.value.at) : null;
    return deleteAfter(current, switched);
  }

  /** Abgelaufene Schuljahre, in denen es (bei `ownerId`: eigene) Klassen oder Ergebnisse gibt. */
  private async expiredYears(current: string, ownerId?: string): Promise<string[]> {
    const classYears = await this.classRepo
      .createQueryBuilder('c').select('DISTINCT c.schoolYear', 'y')
      .where(ownerId ? 'c.ownerId = :ownerId' : '1=1', { ownerId }).getRawMany();
    const resultYears = await this.resultRepo
      .createQueryBuilder('r').select('DISTINCT r.schoolYear', 'y')
      .where(ownerId ? 'r.teacherId = :ownerId' : '1=1', { ownerId }).getRawMany();
    return [...new Set([...classYears, ...resultYears].map((r) => r.y))].filter((y) => isExpired(y, current)).sort(compareSchoolYearsDesc);
  }

  /** Für den Hinweis: Was von mir wird wann gelöscht? */
  async retentionInfo(user: any) {
    const current = await this.currentSchoolYear();
    const years = await this.expiredYears(current, user.userId);
    const classes = years.length ? await this.classRepo.count({ where: { ownerId: user.userId, schoolYear: In(years) } }) : 0;
    const results = years.length ? await this.resultRepo.count({ where: { teacherId: user.userId, schoolYear: In(years) } }) : 0;
    return { current, keepFrom: oldestKeptYear(current), years, classes, results, deleteAfter: (await this.retentionDeadline(current)).toISOString() };
  }

  /**
   * Löscht abgelaufene Schuljahre, sobald die Frist nach dem Wechsel um ist:
   * Ergebnisse, Klassen mit Schülerlisten, ihre Klassenlinks und offene
   * Teilen-Angebote. Läuft beim Start und alle sechs Stunden.
   */
  async runRetention(now = new Date()) {
    try {
      const current = await this.currentSchoolYear();
      if (now < (await this.retentionDeadline(current))) return;
      const years = await this.expiredYears(current);
      if (years.length === 0) return;
      const classes = await this.classRepo.find({ where: { schoolYear: In(years) }, select: ['id'] });
      const ids = classes.map((c) => c.id);
      const results = await this.resultRepo.delete({ schoolYear: In(years) });
      if (ids.length) {
        await this.studentRepo.delete({ classId: In(ids) });
        await this.linkRepo.delete({ classId: In(ids) });
        await this.shareRepo.delete({ classId: In(ids) });
        await this.classRepo.delete({ id: In(ids) });
      }
      this.logger.log(`Löschregel: ${years.join(', ')} gelöscht – ${ids.length} Klassen, ${results.affected ?? 0} Ergebnisse.`);
    } catch (err) {
      this.logger.error('Löschregel fehlgeschlagen', err as any);
    }
  }

  // ---- Schuljahr ----

  /** Aktuelles Schuljahr: vom Hauptadmin gesetzt, sonst nach Kalender. */
  async currentSchoolYear(): Promise<string> {
    const entry = await this.configRepo.findOne({ where: { key: SCHOOL_YEAR_KEY } });
    return isSchoolYear(entry?.value) ? entry.value : schoolYearOfDate(new Date());
  }

  async schoolYearInfo(user: any) {
    const entry = await this.configRepo.findOne({ where: { key: SCHOOL_YEAR_KEY } });
    const current = await this.currentSchoolYear();
    const rows = await this.classRepo
      .createQueryBuilder('c')
      .select('DISTINCT c.schoolYear', 'schoolYear')
      .where('c.ownerId = :id', { id: user.userId })
      .getRawMany();
    const years = new Set<string>([current, ...rows.map((r) => r.schoolYear).filter(isSchoolYear)]);
    return {
      current,
      // Ohne Eintrag gilt der Kalender – der Admin sieht so, dass er noch nie gesetzt hat.
      setByAdmin: isSchoolYear(entry?.value),
      years: [...years].sort(compareSchoolYearsDesc),
    };
  }

  async setSchoolYear(user: any, value: unknown) {
    if (user?.role !== 'admin') throw new ForbiddenException('Nur der Admin setzt das Schuljahr.');
    const year = String(value ?? '').trim().toUpperCase();
    if (!isSchoolYear(year)) throw new BadRequestException('Schuljahr bitte im Format SJ26-27 angeben.');
    const before = await this.currentSchoolYear();
    await this.configRepo.save(this.configRepo.create({ key: SCHOOL_YEAR_KEY, value: year }));
    // Der Tag des Wechsels startet die Frist der Löschregel.
    if (before !== year) {
      await this.configRepo.save(this.configRepo.create({ key: SCHOOL_YEAR_SWITCH_KEY, value: { year, at: new Date().toISOString() } }));
    }
    return { success: true, current: year };
  }

  // ---- Klassen ----

  private async own(id: string, user: any): Promise<StudentClass> {
    const klasse = await this.classRepo.findOne({ where: { id } });
    if (!klasse || klasse.ownerId !== user.userId) throw new NotFoundException('Klasse nicht gefunden.');
    return klasse;
  }

  /** Eigene Klasse oder 404 – für Klassenlinks. */
  async ownedClass(id: string, user: any): Promise<StudentClass> {
    return this.own(id, user);
  }

  /** Klasse ohne Rechteprüfung – für das Speichern von Ergebnissen über einen Klassenlink. */
  async findById(id: string | null | undefined): Promise<StudentClass | null> {
    return id ? this.classRepo.findOne({ where: { id } }) : null;
  }

  /**
   * Anmeldung über einen Klassenlink: Wer ist das?
   *
   * Passt der Name genau einem Schüler, ist er es. Sonst weist eine strikte
   * Klasse ab – ohne Namen zu verraten, sonst ließe sich über den Link die
   * Klassenliste auslesen. Eine offene Klasse nimmt den Namen als
   * unbestätigten Eintrag auf (oder findet den von neulich wieder); die
   * Lehrkraft bestätigt ihn oder führt ihn mit einem Schüler zusammen.
   */
  /**
   * `name` ist der volle Name (für Ergebnisse), `shortName` der Vorname plus
   * nötige Buchstaben des Nachnamens (für Anzeigen wie die Quiz-Arena).
   */
  async resolveStudent(klasse: StudentClass, typedName: string): Promise<{ studentId: string; name: string; shortName: string }> {
    const students = await this.studentRepo.find({ where: { classId: klasse.id } });
    const found = matchStudent(typedName, students);
    if (found.kind === 'match') {
      return {
        studentId: found.student.id,
        name: `${found.student.firstName} ${found.student.lastName}`.trim(),
        shortName: shortName(found.student, students),
      };
    }
    if (klasse.strict) {
      throw new ForbiddenException(
        found.kind === 'ambiguous'
          ? 'Der Name passt zu mehreren Schülern der Klasse. Bitte zusätzlich den Nachnamen oder seinen Anfang eingeben, z. B. „Max M“.'
          : 'Dieser Name steht nicht in der Klassenliste. Bitte Vor- und Nachnamen prüfen – sonst bei der Lehrkraft melden.',
      );
    }
    const typed = splitTypedName(typedName);
    const key = normalizeName(`${typed.firstName} ${typed.lastName}`);
    const again = students.find((s) => s.status === 'pending' && normalizeName(`${s.firstName} ${s.lastName}`) === key);
    if (again) return { studentId: again.id, name: `${again.firstName} ${again.lastName}`.trim(), shortName: shortName(again, students) };
    const created = await this.studentRepo.save(
      this.studentRepo.create({
        id: crypto.randomUUID(), classId: klasse.id, firstName: typed.firstName.slice(0, 80),
        lastName: typed.lastName.slice(0, 80), status: 'pending', importId: null,
      }),
    );
    return {
      studentId: created.id,
      name: `${created.firstName} ${created.lastName}`.trim(),
      shortName: shortName(created, [...students, created]),
    };
  }

  /**
   * Unbestätigten Eintrag mit einem Schüler zusammenführen: Seine Ergebnisse
   * gehen auf den Schüler über, der Eintrag verschwindet.
   */
  async mergeStudent(classId: string, studentId: string, user: any, targetId: string) {
    const from = await this.ownStudent(classId, studentId, user);
    const to = await this.studentRepo.findOne({ where: { id: String(targetId || ''), classId } });
    if (!to || to.id === from.id) throw new BadRequestException('Bitte einen anderen Schüler der Klasse wählen.');
    const name = `${to.firstName} ${to.lastName}`.trim();
    const moved = await this.resultRepo.update({ studentId: from.id }, { studentId: to.id, studentName: name });
    await this.studentRepo.remove(from);
    return { success: true, moved: moved.affected ?? 0 };
  }

  private async assertNameFree(user: any, schoolYear: string, name: string, exceptId?: string) {
    const same = await this.classRepo.find({ where: { ownerId: user.userId, schoolYear } });
    const key = name.toLocaleLowerCase('de');
    if (same.some((c) => c.id !== exceptId && c.name.toLocaleLowerCase('de') === key)) {
      throw new BadRequestException(`Die Klasse „${name}“ gibt es im ${schoolYear} schon.`);
    }
  }

  async findAll(user: any, schoolYear?: string) {
    const year = isSchoolYear(schoolYear) ? schoolYear : await this.currentSchoolYear();
    const classes = await this.classRepo.find({ where: { ownerId: user.userId, schoolYear: year } });
    const ids = classes.map((c) => c.id);
    const students = ids.length
      ? await this.studentRepo.find({ where: { classId: In(ids) }, select: ['classId', 'status'] })
      : [];
    const links = ids.length ? await this.linkRepo.find({ where: { classId: In(ids) }, select: ['classId'] }) : [];
    return classes
      .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
      .map((c) => {
        const mine = students.filter((s) => s.classId === c.id);
        return {
          ...c,
          studentCount: mine.length,
          pendingCount: mine.filter((s) => s.status === 'pending').length,
          linkCount: links.filter((l) => l.classId === c.id).length,
        };
      });
  }

  async findOne(id: string, user: any) {
    const klasse = await this.own(id, user);
    const students = await this.studentRepo.find({ where: { classId: id } });
    return { ...klasse, students: students.sort(byLastFirst) };
  }

  async create(user: any, body: { name?: string; schoolYear?: string }) {
    const name = cleanName(body?.name, 40);
    if (!name) throw new BadRequestException('Bitte einen Klassennamen angeben.');
    const schoolYear = isSchoolYear(body?.schoolYear) ? body.schoolYear : await this.currentSchoolYear();
    await this.assertNameFree(user, schoolYear, name);
    const klasse = this.classRepo.create({
      id: crypto.randomUUID(),
      name,
      ownerId: user.userId,
      schoolYear,
      strict: false,
      predecessorId: null,
      createdBy: user.userId,
    });
    return this.classRepo.save(klasse);
  }

  async update(id: string, user: any, body: { name?: string; strict?: boolean }) {
    const klasse = await this.own(id, user);
    if (body?.name !== undefined) {
      const name = cleanName(body.name, 40);
      if (!name) throw new BadRequestException('Bitte einen Klassennamen angeben.');
      await this.assertNameFree(user, klasse.schoolYear as string, name, id);
      klasse.name = name;
    }
    if (body?.strict !== undefined) klasse.strict = !!body.strict;
    return this.classRepo.save(klasse);
  }

  /**
   * Löscht Klasse, Schülerliste und ihre Klassenlinks – ein Link auf eine
   * Klasse, die es nicht mehr gibt, hätte keinen Sinn. Ergebnisse bleiben;
   * den Klassennamen tragen sie selbst.
   */
  async remove(id: string, user: any) {
    const klasse = await this.own(id, user);
    await this.linkRepo.delete({ classId: id, ownerId: user.userId });
    await this.studentRepo.delete({ classId: id });
    await this.shareRepo.delete({ classId: id, status: 'offered' });
    await this.classRepo.remove(klasse);
    return { success: true };
  }

  // ---- Schuljahreswechsel ----

  /**
   * Klassen des Vorjahres, über die noch nicht entschieden ist – Grundlage
   * des Assistenten. Leer, sobald jede übernommen oder aufgegeben ist.
   */
  async rolloverInfo(user: any) {
    const to = await this.currentSchoolYear();
    const from = shiftSchoolYear(to, -1);
    const open = await this.classRepo.find({ where: { ownerId: user.userId, schoolYear: from, rolledOver: IsNull() } });
    const ids = open.map((c) => c.id);
    const students = ids.length ? await this.studentRepo.find({ where: { classId: In(ids) }, select: ['classId', 'status'] }) : [];
    const links = ids.length ? await this.linkRepo.find({ where: { classId: In(ids) }, select: ['classId'] }) : [];
    return {
      from,
      to,
      classes: open
        .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
        .map((c) => ({
          id: c.id,
          name: c.name,
          suggestedName: suggestNextClassName(c.name),
          studentCount: students.filter((s) => s.classId === c.id && s.status === 'confirmed').length,
          linkCount: links.filter((l) => l.classId === c.id).length,
          strict: c.strict,
        })),
    };
  }

  /**
   * Klassen ins neue Schuljahr übernehmen: Je Klasse entsteht eine neue mit
   * der (bestätigten) Schülerliste; die alte bleibt für die Ergebnisse des
   * Vorjahres. `moveLinks` hängt ihre Klassenlinks an die neue Klasse, damit
   * ausgeteilte QR-Codes weiter gelten. Nicht übernommene Klassen gelten als
   * aufgegeben, ihre Klassenlinks werden deaktiviert.
   */
  async rollover(user: any, body: { items?: Array<{ classId?: string; take?: boolean; name?: string; moveLinks?: boolean }> }) {
    const info = await this.rolloverInfo(user);
    const items = Array.isArray(body?.items) ? body.items : [];
    const openIds = new Set(info.classes.map((c) => c.id));
    const taken: string[] = [];
    const dropped: string[] = [];

    for (const item of items) {
      if (!item?.classId || !openIds.has(item.classId)) continue;
      const old = await this.own(item.classId, user);
      if (!item.take) {
        await this.linkRepo.update({ classId: old.id, ownerId: user.userId }, { active: false });
        old.rolledOver = 'dropped';
        await this.classRepo.save(old);
        dropped.push(old.name);
        continue;
      }
      const name = cleanName(item.name, 40) || old.name;
      await this.assertNameFree(user, info.to, name);
      const klasse = await this.classRepo.save(
        this.classRepo.create({
          id: crypto.randomUUID(), name, ownerId: user.userId, schoolYear: info.to, strict: old.strict,
          predecessorId: old.id, importId: null, rolledOver: null, createdBy: user.userId,
        }),
      );
      const students = await this.studentRepo.find({ where: { classId: old.id, status: 'confirmed' } });
      await this.studentRepo.save(
        students.map((s) =>
          this.studentRepo.create({
            id: crypto.randomUUID(), classId: klasse.id, firstName: s.firstName, lastName: s.lastName,
            status: 'confirmed', importId: s.importId,
          }),
        ),
      );
      if (item.moveLinks) await this.linkRepo.update({ classId: old.id, ownerId: user.userId }, { classId: klasse.id });
      old.rolledOver = 'copied';
      await this.classRepo.save(old);
      taken.push(name);
    }
    return { success: true, taken, dropped };
  }

  // ---- Teilen ----

  /**
   * Klasse Kolleginnen und Kollegen anbieten – nur innerhalb der eigenen
   * Schule (ohne Schule: alle Lehrkräfte). Ein schon offenes Angebot an
   * dieselbe Person bleibt, wie es ist.
   */
  async shareClass(classId: string, user: any, body: { userIds?: string[] }) {
    const klasse = await this.own(classId, user);
    const ids = [...new Set((Array.isArray(body?.userIds) ? body.userIds : []).map(String))].filter((id) => id !== user.userId);
    if (ids.length === 0) throw new BadRequestException('Bitte mindestens eine Person wählen.');
    const recipients = await this.userRepo.find({ where: { id: In(ids) } });
    const allowed = recipients.filter(
      (u) => u.active !== false && (u.role === 'teacher' || u.role === 'admin') && (!user.schoolId || u.schoolId === user.schoolId),
    );
    if (allowed.length === 0) throw new BadRequestException('Diese Personen gehören nicht zu deiner Schule.');
    const me = await this.userRepo.findOne({ where: { id: user.userId } });
    const existing = await this.shareRepo.find({ where: { classId, status: 'offered' } });
    const fresh = allowed
      .filter((u) => !existing.some((s) => s.toUserId === u.id))
      .map((u) =>
        this.shareRepo.create({
          id: crypto.randomUUID(), classId, fromUserId: user.userId, toUserId: u.id, status: 'offered',
          className: klasse.name, schoolYear: klasse.schoolYear, fromName: me?.displayName || me?.email || '',
        }),
      );
    if (fresh.length) await this.shareRepo.save(fresh);
    return { success: true, offered: fresh.length };
  }

  /** Mit wem die Klasse geteilt ist – für die Schülerliste. */
  async sharesOfClass(classId: string, user: any) {
    await this.own(classId, user);
    const shares = await this.shareRepo.find({ where: { classId } });
    const users = shares.length ? await this.userRepo.find({ where: { id: In(shares.map((s) => s.toUserId)) } }) : [];
    return shares.map((s) => {
      const u = users.find((x) => x.id === s.toUserId);
      return { id: s.id, status: s.status, toName: u?.displayName || u?.email || '?', createdAt: s.createdAt };
    });
  }

  /** Offene Angebote an mich. */
  async incomingShares(user: any) {
    const shares = await this.shareRepo.find({ where: { toUserId: user.userId, status: 'offered' } });
    return shares.map((s) => ({ id: s.id, className: s.className, schoolYear: s.schoolYear, fromName: s.fromName, createdAt: s.createdAt }));
  }

  private async ownShare(id: string, user: any) {
    const share = await this.shareRepo.findOne({ where: { id, toUserId: user.userId, status: 'offered' } });
    if (!share) throw new NotFoundException('Dieses Angebot gibt es nicht (mehr).');
    return share;
  }

  /**
   * Angebot annehmen: eigene Klasse im selben Schuljahr mit dem heutigen
   * Stand der Schülerliste (bestätigte Schüler). Gibt es den Namen bei mir
   * schon, bekommt die Kopie einen Zusatz.
   */
  async acceptShare(id: string, user: any) {
    const share = await this.ownShare(id, user);
    const source = await this.classRepo.findOne({ where: { id: share.classId } });
    if (!source) {
      share.status = 'declined';
      await this.shareRepo.save(share);
      throw new NotFoundException('Die Klasse wurde inzwischen gelöscht.');
    }
    const schoolYear = source.schoolYear || (await this.currentSchoolYear());
    const mine = await this.classRepo.find({ where: { ownerId: user.userId, schoolYear } });
    const taken = (n: string) => mine.some((c) => c.name.toLocaleLowerCase('de') === n.toLocaleLowerCase('de'));
    let name = source.name;
    if (taken(name)) name = `${source.name} (von ${share.fromName})`.slice(0, 40);
    for (let i = 2; taken(name); i++) name = `${source.name} (${i})`;
    const klasse = await this.classRepo.save(
      this.classRepo.create({
        id: crypto.randomUUID(), name, ownerId: user.userId, schoolYear, strict: source.strict,
        predecessorId: null, importId: source.importId, rolledOver: null, createdBy: user.userId,
      }),
    );
    const students = await this.studentRepo.find({ where: { classId: source.id, status: 'confirmed' } });
    await this.studentRepo.save(
      students.map((s) =>
        this.studentRepo.create({
          id: crypto.randomUUID(), classId: klasse.id, firstName: s.firstName, lastName: s.lastName, status: 'confirmed', importId: s.importId,
        }),
      ),
    );
    share.status = 'accepted';
    await this.shareRepo.save(share);
    return { success: true, class: { id: klasse.id, name: klasse.name, schoolYear: klasse.schoolYear }, students: students.length };
  }

  async declineShare(id: string, user: any) {
    const share = await this.ownShare(id, user);
    share.status = 'declined';
    await this.shareRepo.save(share);
    return { success: true };
  }

  // ---- Schülerliste ----

  private async ownStudent(classId: string, studentId: string, user: any) {
    await this.own(classId, user);
    const student = await this.studentRepo.findOne({ where: { id: studentId, classId } });
    if (!student) throw new NotFoundException('Schüler nicht gefunden.');
    return student;
  }

  async addStudent(classId: string, user: any, body: { firstName?: string; lastName?: string }) {
    await this.own(classId, user);
    const firstName = cleanName(body?.firstName);
    const lastName = cleanName(body?.lastName);
    if (!firstName) throw new BadRequestException('Bitte mindestens den Vornamen angeben.');
    const existing = await this.studentRepo.find({ where: { classId } });
    if (existing.some((s) => nameKey(s.firstName, s.lastName) === nameKey(firstName, lastName))) {
      throw new BadRequestException(`„${firstName} ${lastName}“ steht schon in der Klasse.`);
    }
    return this.studentRepo.save(
      this.studentRepo.create({ id: crypto.randomUUID(), classId, firstName, lastName, status: 'confirmed', importId: null }),
    );
  }

  async updateStudent(
    classId: string,
    studentId: string,
    user: any,
    body: { firstName?: string; lastName?: string; confirm?: boolean },
  ) {
    const student = await this.ownStudent(classId, studentId, user);
    if (body?.firstName !== undefined) {
      const firstName = cleanName(body.firstName);
      if (!firstName) throw new BadRequestException('Der Vorname darf nicht leer sein.');
      student.firstName = firstName;
    }
    if (body?.lastName !== undefined) student.lastName = cleanName(body.lastName);
    if (body?.confirm) student.status = 'confirmed';
    const saved = await this.studentRepo.save(student);
    // Ergebnisse tragen den Namen mit – nach einer Korrektur den richtigen.
    await this.resultRepo.update({ studentId: saved.id }, { studentName: `${saved.firstName} ${saved.lastName}`.trim() });
    return saved;
  }

  async removeStudent(classId: string, studentId: string, user: any) {
    const student = await this.ownStudent(classId, studentId, user);
    await this.studentRepo.remove(student);
    // Ergebnisse bleiben mit ihrem Namen stehen, gehören aber niemandem mehr.
    await this.resultRepo.update({ studentId: student.id }, { studentId: null });
    return { success: true };
  }

  /**
   * Schülerliste einlesen. Mit `dryRun` kommt nur die Vorschau zurück –
   * die Oberfläche zeigt sie, bevor etwas geändert wird.
   */
  async importStudents(classId: string, user: any, body: { students?: ImportRow[]; dryRun?: boolean }) {
    await this.own(classId, user);
    const rows = Array.isArray(body?.students) ? body.students : [];
    if (rows.length === 0) throw new BadRequestException('Die Liste enthält keine Schüler.');
    if (rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`Höchstens ${MAX_IMPORT_ROWS} Schüler je Import.`);

    const { summary, apply } = await this.planImport(classId, rows);
    if (body?.dryRun) return { dryRun: true, ...summary };
    await apply();
    return { success: true, ...summary };
  }

  /** Abgleich der Schülerliste: Zusammenfassung für die Vorschau und `apply` zum Übernehmen. */
  private async planImport(classId: string | null, rows: ImportRow[]) {
    const existing = classId ? await this.studentRepo.find({ where: { classId } }) : [];
    const plan = planStudentImport(existing, rows);
    const summary = {
      added: plan.add.length,
      updated: plan.update.length,
      unchanged: plan.unchanged,
      duplicates: plan.duplicates,
      addNames: plan.add.map((r) => `${r.firstName} ${r.lastName}`.trim()),
      updateNames: plan.update.map((r) => `${r.firstName} ${r.lastName}`.trim()),
    };
    const apply = (targetId = classId as string) => this.applyImport(targetId, existing, plan);
    return { summary, apply };
  }

  private async applyImport(classId: string, existing: ClassStudent[], plan: ReturnType<typeof planStudentImport>) {
    const byId = new Map(existing.map((s) => [s.id, s]));
    const changed = plan.update.map((u) => Object.assign(byId.get(u.id) as ClassStudent, u));
    const added = plan.add.map((r) =>
      this.studentRepo.create({
        id: crypto.randomUUID(),
        classId,
        firstName: r.firstName,
        lastName: r.lastName,
        importId: r.importId || null,
        status: 'confirmed',
      }),
    );
    await this.studentRepo.save([...changed, ...added]);
  }

  /**
   * Mehrere Klassen auf einmal einlesen – der Export „Klassen für
   * LearningModules“ des SchülerLernTools. Das Schuljahr steht dort als
   * Vorsatz im Namen ("SJ26-27-E1ME1"), sonst gilt `schoolYear`. Vorhandene
   * Klassen werden über die Klassen-ID, sonst über den Namen gefunden und
   * ergänzt; neue werden angelegt. `strict` schaltet die strikte Anmeldung
   * für alle eingelesenen Klassen ein. Mit `dryRun` nur die Vorschau.
   */
  async importClasses(
    user: any,
    body: { classes?: Array<{ name?: string; classId?: string; students?: ImportRow[] }>; schoolYear?: string; strict?: boolean; dryRun?: boolean },
  ) {
    const input = Array.isArray(body?.classes) ? body.classes : [];
    if (input.length === 0) throw new BadRequestException('Die Datei enthält keine Klassen.');
    if (input.length > MAX_IMPORT_CLASSES) throw new BadRequestException(`Höchstens ${MAX_IMPORT_CLASSES} Klassen je Import.`);
    const fallbackYear = isSchoolYear(body?.schoolYear) ? body.schoolYear : await this.currentSchoolYear();
    const mine = await this.classRepo.find({ where: { ownerId: user.userId } });

    const result: any[] = [];
    for (const c of input) {
      const split = splitSchoolYearPrefix(cleanName(c?.name, 60));
      const name = split.name.slice(0, 40);
      if (!name) continue;
      const schoolYear = split.schoolYear || fallbackYear;
      const importId = cleanName(c?.classId, 64) || null;
      const rows = Array.isArray(c?.students) ? c.students.slice(0, MAX_IMPORT_ROWS) : [];
      const sameYear = mine.filter((k) => k.schoolYear === schoolYear);
      const target =
        (importId && sameYear.find((k) => k.importId === importId)) ||
        sameYear.find((k) => k.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')) ||
        null;
      const { summary, apply } = await this.planImport(target?.id ?? null, rows);
      result.push({ name: target?.name ?? name, schoolYear, exists: !!target, strict: !!target?.strict, ...summary });
      if (body?.dryRun) continue;

      let klasse = target;
      if (!klasse) {
        klasse = await this.classRepo.save(
          this.classRepo.create({
            id: crypto.randomUUID(), name, ownerId: user.userId, schoolYear, strict: false,
            predecessorId: null, importId, createdBy: user.userId,
          }),
        );
        mine.push(klasse);
      } else if (importId && !klasse.importId) {
        klasse.importId = importId;
      }
      if (body?.strict) klasse.strict = true;
      await this.classRepo.save(klasse);
      await apply(klasse.id);
    }
    return { dryRun: !!body?.dryRun, classes: result };
  }
}
