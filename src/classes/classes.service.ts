import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import { StudentClass } from '../core/entities/student-class.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { Result } from '../core/entities/result.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { isSchoolYear, schoolYearOfDate, compareSchoolYearsDesc } from './school-year';
import { planStudentImport, nameKey, ImportRow } from './student-import';

const SCHOOL_YEAR_KEY = 'school_year';
const MAX_IMPORT_ROWS = 500;

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
export class ClassesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClassesService.name);

  constructor(
    @InjectRepository(StudentClass) private readonly classRepo: Repository<StudentClass>,
    @InjectRepository(ClassStudent) private readonly studentRepo: Repository<ClassStudent>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
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
    await this.configRepo.save(this.configRepo.create({ key: SCHOOL_YEAR_KEY, value: year }));
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
    await this.classRepo.remove(klasse);
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
    return this.studentRepo.save(student);
  }

  async removeStudent(classId: string, studentId: string, user: any) {
    const student = await this.ownStudent(classId, studentId, user);
    await this.studentRepo.remove(student);
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

    const existing = await this.studentRepo.find({ where: { classId } });
    const plan = planStudentImport(existing, rows);
    const summary = {
      added: plan.add.length,
      updated: plan.update.length,
      unchanged: plan.unchanged,
      duplicates: plan.duplicates,
      addNames: plan.add.map((r) => `${r.firstName} ${r.lastName}`.trim()),
      updateNames: plan.update.map((r) => `${r.firstName} ${r.lastName}`.trim()),
    };
    if (body?.dryRun) return { dryRun: true, ...summary };

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
    return { success: true, ...summary };
  }
}
