import {
  Injectable, OnModuleInit, Logger, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { School } from '../entities/school.entity';
import { User } from '../entities/user.entity';
import { TeacherGroup } from '../entities/teacher-group.entity';
import { Tag } from '../entities/tag.entity';
import { AccountsService } from '../../accounts/accounts.service';
import { emailMatchesAny } from '../share/email-pattern';

/** Was eine Lehrkraft in den Schullisten zeigt – ohne Hash und Tokens. */
function teacherView(u: User) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName || u.email,
    role: u.role,
    active: u.active !== false,
    isSchoolAdmin: !!u.isSchoolAdmin,
    mustChangePassword: !!u.mustChangePassword,
    schoolManual: !!u.schoolManual,
  };
}

/**
 * Schulen und die Zuordnung der Lehrkräfte.
 *
 * Automatisch zugeordnet wird nur, wer noch keiner Schule angehört und nicht
 * von Hand zugeordnet oder entfernt wurde – und nur, wenn die Adresse auf
 * genau eine Schul-Whitelist passt. Passt sie auf mehrere, entscheidet der
 * Hauptadmin; still die erstbeste zu nehmen, fiele niemandem auf.
 *
 * Eine Whitelist zieht damit nie jemanden aus einer anderen Schule ab, auch
 * wenn ein Schuladmin ein zu weites Muster einträgt.
 */
@Injectable()
export class SchoolsService implements OnModuleInit {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(
    @InjectRepository(School) private readonly schoolRepo: Repository<School>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Altlasten: Das Feld schoolId gab es schon, bevor es Schulen gab. Verweise
   * auf Schulen, die es nicht gibt, werden geleert – sonst hinge jemand in
   * einer unsichtbaren Schule und bekäme nie eine per Whitelist.
   */
  async onModuleInit() {
    const ids = new Set((await this.schoolRepo.find()).map((s) => s.id));
    const orphans = (await this.userRepo.find()).filter((u) => u.schoolId && !ids.has(u.schoolId));
    for (const u of orphans) {
      u.schoolId = null;
      u.isSchoolAdmin = false;
    }
    if (orphans.length) {
      await this.userRepo.save(orphans);
      this.logger.log(`${orphans.length} Konto/Konten ohne gültige Schule bereinigt`);
    }
  }

  // ---- Lesen ----

  async findOne(id: string) {
    const school = id ? await this.schoolRepo.findOne({ where: { id } }) : null;
    if (!school) throw new NotFoundException('Schule nicht gefunden.');
    return school;
  }

  async schoolName(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    return (await this.schoolRepo.findOne({ where: { id } }))?.name ?? null;
  }

  private summary(school: School, users: User[]) {
    const members = users.filter((u) => u.schoolId === school.id);
    return {
      id: school.id,
      name: school.name,
      whitelist: school.whitelist || [],
      adminsMayEditWhitelist: school.adminsMayEditWhitelist !== false,
      adminsMayManageTeachers: school.adminsMayManageTeachers !== false,
      teachers: members
        .map(teacherView)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
    };
  }

  /** Übersicht für den Hauptadmin: alle Schulen plus offene Konflikte. */
  async listForAdmin() {
    const [schools, users] = await Promise.all([this.schoolRepo.find(), this.userRepo.find()]);
    schools.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const conflicts = users
      .filter((u) => this.assignable(u))
      .map((u) => ({ user: teacherView(u), schools: schools.filter((s) => emailMatchesAny(u.email, s.whitelist)) }))
      .filter((c) => c.schools.length > 1)
      .map((c) => ({ ...c.user, schoolIds: c.schools.map((s) => s.id) }));
    return {
      schools: schools.map((s) => this.summary(s, users)),
      unassigned: users.filter((u) => !u.schoolId).map(teacherView),
      conflicts,
    };
  }

  // ---- Hauptadmin: Schulen pflegen ----

  private cleanName(name: any): string {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) throw new BadRequestException('Die Schule braucht einen Namen.');
    if (clean.length > 120) throw new BadRequestException('Der Name ist zu lang (max. 120 Zeichen).');
    return clean;
  }

  private async requireFreeName(name: string, exceptId?: string) {
    const all = await this.schoolRepo.find();
    if (all.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException(`Es gibt bereits eine Schule "${name}".`);
    }
  }

  /** Einträge säubern; offensichtlich Unbrauchbares fällt mit Hinweis heraus. */
  private cleanWhitelist(list: any): string[] {
    if (!Array.isArray(list)) throw new BadRequestException('Die Whitelist muss eine Liste sein.');
    const out: string[] = [];
    for (const raw of list) {
      const entry = String(raw || '').trim().toLowerCase();
      if (!entry) continue;
      if (!entry.includes('.') || /\s/.test(entry)) {
        throw new BadRequestException(`"${entry}" ist weder eine Adresse noch ein Muster wie *@schule.de.`);
      }
      if (!out.includes(entry)) out.push(entry);
    }
    return out;
  }

  async create(body: { name?: string; whitelist?: string[] }) {
    const name = this.cleanName(body?.name);
    await this.requireFreeName(name);
    const school = this.schoolRepo.create({
      id: crypto.randomUUID(),
      name,
      whitelist: body?.whitelist ? this.cleanWhitelist(body.whitelist) : [],
      adminsMayEditWhitelist: true,
      adminsMayManageTeachers: true,
    });
    return this.schoolRepo.save(school);
  }

  async update(id: string, body: {
    name?: string; whitelist?: string[]; adminsMayEditWhitelist?: boolean; adminsMayManageTeachers?: boolean;
  }) {
    const school = await this.findOne(id);
    if (body?.name !== undefined) {
      const name = this.cleanName(body.name);
      await this.requireFreeName(name, id);
      school.name = name;
    }
    if (body?.whitelist !== undefined) school.whitelist = this.cleanWhitelist(body.whitelist);
    if (body?.adminsMayEditWhitelist !== undefined) school.adminsMayEditWhitelist = !!body.adminsMayEditWhitelist;
    if (body?.adminsMayManageTeachers !== undefined) school.adminsMayManageTeachers = !!body.adminsMayManageTeachers;
    return this.schoolRepo.save(school);
  }

  /**
   * Löscht die Schule. Lehrkräfte stehen danach ohne Schule da (und dürfen
   * per Whitelist einer anderen zugeordnet werden), Gruppen werden
   * schulübergreifend – ihre Freigaben sollen nicht still verschwinden.
   * Die Tag-Vorgaben der Schule entfallen; an Themen verbliebene IDs zeigen
   * dann ins Leere und werden in der Anzeige übergangen.
   */
  async remove(id: string) {
    const school = await this.findOne(id);
    const users = await this.userRepo.find({ where: { schoolId: id } });
    for (const u of users) {
      u.schoolId = null;
      u.isSchoolAdmin = false;
      u.schoolManual = false;
    }
    if (users.length) await this.userRepo.save(users);
    const groups = await this.groupRepo.find({ where: { schoolId: id } });
    for (const g of groups) g.schoolId = null;
    if (groups.length) await this.groupRepo.save(groups);
    const tags = await this.tagRepo.find({ where: { schoolId: id } });
    if (tags.length) await this.tagRepo.remove(tags);
    await this.schoolRepo.remove(school);
    return { success: true, teachersReleased: users.length, groupsReleased: groups.length, tagsRemoved: tags.length };
  }

  /**
   * Hauptadmin ordnet von Hand zu (oder entzieht). Das gilt dann fest – die
   * Whitelist überschreibt es nicht mehr.
   */
  async assign(userId: string, body: { schoolId?: string | null; isSchoolAdmin?: boolean }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Benutzer nicht gefunden.');
    if (body?.schoolId !== undefined) {
      const target = body.schoolId ? (await this.findOne(body.schoolId)).id : null;
      if (target !== user.schoolId) {
        user.schoolId = target;
        user.schoolManual = true;
        user.isSchoolAdmin = false;
        await this.leaveForeignGroups(user.id, target);
      }
    }
    if (body?.isSchoolAdmin !== undefined) {
      if (body.isSchoolAdmin && !user.schoolId) {
        throw new BadRequestException('Schuladmin kann nur werden, wer einer Schule angehört.');
      }
      user.isSchoolAdmin = !!body.isSchoolAdmin;
    }
    await this.userRepo.save(user);
    return { success: true, ...teacherView(user), schoolId: user.schoolId };
  }

  /**
   * Wer die Schule wechselt oder verlässt, fällt aus den Gruppen der alten
   * Schule – sonst bekäme er über "Fachschaft Mathe" weiter deren Freigaben.
   * Schulübergreifende Gruppen bleiben unberührt.
   */
  private async leaveForeignGroups(userId: string, schoolId: string | null) {
    const groups = await this.groupRepo.find();
    const touched = groups.filter(
      (g) => g.schoolId && g.schoolId !== schoolId && (g.memberIds || []).includes(userId),
    );
    for (const g of touched) g.memberIds = (g.memberIds || []).filter((id) => id !== userId);
    if (touched.length) await this.groupRepo.save(touched);
  }

  // ---- Zuordnung per Whitelist ----

  private assignable(u: User) {
    return !u.schoolId && !u.schoolManual && (u.role === 'teacher' || u.role === 'admin');
  }

  /**
   * Beim Registrieren, Anlegen und Login: Passt die Adresse auf genau eine
   * Schule, gehört die Lehrkraft ab jetzt dazu.
   */
  async autoAssign(user: User): Promise<void> {
    if (!this.assignable(user)) return;
    const schools = await this.schoolRepo.find();
    const matches = schools.filter((s) => emailMatchesAny(user.email, s.whitelist));
    if (matches.length !== 1) return;
    user.schoolId = matches[0].id;
    await this.userRepo.update(user.id, { schoolId: user.schoolId });
    this.logger.log(`${user.email} per Whitelist der Schule "${matches[0].name}" zugeordnet`);
  }

  /**
   * Wen die Whitelist dieser Schule jetzt aufnehmen würde – und wen nicht,
   * weil die Adresse auch auf eine andere Schule passt.
   */
  async whitelistPreview(schoolId: string) {
    const school = await this.findOne(schoolId);
    const [schools, users] = await Promise.all([this.schoolRepo.find(), this.userRepo.find()]);
    const assignable: ReturnType<typeof teacherView>[] = [];
    const conflicts: Array<ReturnType<typeof teacherView> & { otherSchools: string[] }> = [];
    for (const u of users) {
      if (!this.assignable(u) || !emailMatchesAny(u.email, school.whitelist)) continue;
      const others = schools.filter((s) => s.id !== school.id && emailMatchesAny(u.email, s.whitelist));
      if (others.length) conflicts.push({ ...teacherView(u), otherSchools: others.map((s) => s.name) });
      else assignable.push(teacherView(u));
    }
    return { assignable, conflicts };
  }

  async applyWhitelist(schoolId: string) {
    const { assignable, conflicts } = await this.whitelistPreview(schoolId);
    if (assignable.length) {
      const users = await this.userRepo.find({ where: { id: In(assignable.map((u) => u.id)) } });
      for (const u of users) u.schoolId = schoolId;
      await this.userRepo.save(users);
    }
    return { assigned: assignable.length, conflicts };
  }

  // ---- Schuladmin ----

  /** Die Schule, die `user` verwalten darf – sonst 403. */
  async requireSchoolAdmin(user: any): Promise<School> {
    if (!user?.isSchoolAdmin || !user?.schoolId) {
      throw new ForbiddenException('Nur für Schuladmins.');
    }
    return this.findOne(user.schoolId);
  }

  async overviewFor(user: any) {
    const school = await this.requireSchoolAdmin(user);
    const users = await this.userRepo.find({ where: { schoolId: school.id } });
    return this.summary(school, users);
  }

  async setWhitelistAsSchoolAdmin(user: any, whitelist: string[]) {
    const school = await this.requireSchoolAdmin(user);
    if (school.adminsMayEditWhitelist === false) {
      throw new ForbiddenException('Die Whitelist pflegt bei eurer Schule der Hauptadmin.');
    }
    school.whitelist = this.cleanWhitelist(whitelist);
    await this.schoolRepo.save(school);
    return { success: true, whitelist: school.whitelist };
  }

  async previewAsSchoolAdmin(user: any) {
    const school = await this.requireSchoolAdmin(user);
    return this.whitelistPreview(school.id);
  }

  async applyAsSchoolAdmin(user: any) {
    const school = await this.requireSchoolAdmin(user);
    if (school.adminsMayEditWhitelist === false) {
      throw new ForbiddenException('Die Whitelist pflegt bei eurer Schule der Hauptadmin.');
    }
    return this.applyWhitelist(school.id);
  }

  /**
   * Eine Lehrkraft der eigenen Schule, an der ein Schuladmin etwas ändern
   * darf. Nicht sich selbst (sonst sperrt man sich aus) und nicht den
   * Hauptadmin – der steht über der Schule.
   */
  private async manageableTeacher(user: any, targetId: string) {
    const school = await this.requireSchoolAdmin(user);
    if (school.adminsMayManageTeachers === false) {
      throw new ForbiddenException('Lehrkräfte verwaltet bei eurer Schule der Hauptadmin.');
    }
    if (targetId === user.userId) throw new BadRequestException('Das geht nicht beim eigenen Konto.');
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target || target.schoolId !== school.id) throw new NotFoundException('Lehrkraft nicht in eurer Schule.');
    if (target.role === 'admin') throw new ForbiddenException('Den Hauptadmin kann nur ein Hauptadmin ändern.');
    return target;
  }

  /** Aus der Schule nehmen; die Whitelist holt sie danach nicht zurück. */
  async removeFromSchool(user: any, targetId: string) {
    const target = await this.manageableTeacher(user, targetId);
    target.schoolId = null;
    target.isSchoolAdmin = false;
    target.schoolManual = true;
    await this.userRepo.save(target);
    await this.leaveForeignGroups(target.id, null);
    return { success: true };
  }

  async deactivateTeacher(user: any, targetId: string) {
    const target = await this.manageableTeacher(user, targetId);
    if (target.active === false) return { success: true, alreadyInactive: true };
    const offeredTopics = await this.accounts.deactivate(target);
    return { success: true, offeredTopics };
  }

  async reactivateTeacher(user: any, targetId: string) {
    const target = await this.manageableTeacher(user, targetId);
    if (target.active !== false) return { success: true, alreadyActive: true };
    return this.accounts.reactivate(target);
  }
}
