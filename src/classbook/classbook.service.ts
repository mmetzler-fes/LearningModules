import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ClassNotebook, ClassNotebookItem, ClassNotebookMarker } from '../core/entities/class-notebook.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { StudentClass } from '../core/entities/student-class.entity';
import { Result } from '../core/entities/result.entity';
import { DocumentWork } from '../core/entities/document-work.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { ClassesService } from '../classes/classes.service';
import { LinksService, PRACTICE_MODES } from '../links/links.service';
import { NotebooksService } from '../notebooks/notebooks.service';
import { issueTicket, readTicket } from '../classes/student-ticket';
import { isTestStudent } from '../classes/test-student';
import { newPin, pinMatches, pinGuard } from '../work/pin';
import { baseUrl, renderQr } from '../core/share/link-url';
import { endOfDay, firstLoginOpen, loginDecision, unitCells, Unit, DetailLike, classbookTicketKey, examState, toggleSelection, explicitSelection, moduleOn, AvailTopic, SelEntry } from './classbook-rules';

const practiceModes = (link: TopicLink) => PRACTICE_MODES.filter((m) => (link.modes || []).includes(m));

/** Module der Übersicht: je Modul eines, mit seinen Submodulen. */
function unitsOf(modules: LearningModule[]): Array<Unit & { title: string; type: string }> {
  return modules.map((m) => ({
    id: m.id,
    title: m.title || '',
    type: m.type,
    ids: [m.id, ...((m as any).subModules || []).map((s: LearningModule) => s.id)],
  }));
}

/**
 * Klassennotizbuch (docs/klassennotizbuch.md): je Klasse ein Zugang für die
 * Schüler (Klassenbuch-Link, Name und PIN) und eine Übersicht für die
 * Lehrkraft. Zuweisungen sind die Klassenlinks der Klasse, Schülerdaten ihre
 * Ergebnisse und Bearbeitungen – hier liegt nichts davon doppelt.
 */
@Injectable()
export class ClassbookService {
  constructor(
    @InjectRepository(ClassNotebook) private readonly repo: Repository<ClassNotebook>,
    @InjectRepository(ClassStudent) private readonly studentRepo: Repository<ClassStudent>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(DocumentWork) private readonly workRepo: Repository<DocumentWork>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ExamAttempt) private readonly attemptRepo: Repository<ExamAttempt>,
    private readonly classes: ClassesService,
    private readonly links: LinksService,
    private readonly notebooks: NotebooksService,
  ) {}

  /** Notizbuch der Klasse – beim ersten Aufruf angelegt. */
  private async ensure(klasse: StudentClass): Promise<ClassNotebook> {
    const found = await this.repo.findOne({ where: { classId: klasse.id } });
    if (found) return found;
    return this.repo.save(this.repo.create({
      id: crypto.randomUUID(), classId: klasse.id, ownerId: klasse.ownerId || '',
      token: crypto.randomBytes(12).toString('base64url'), firstLoginUntil: null, teacherItems: [],
    }));
  }

  /** Klassenlinks der Klasse (die Zuweisungen), neueste zuerst. */
  private async classLinks(klasse: StudentClass): Promise<TopicLink[]> {
    const list = await this.linkRepo.find({ where: { classId: klasse.id, ownerId: klasse.ownerId || '' } });
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private async linkInfo(link: TopicLink) {
    const resolved = await this.links.resolveModules(link);
    return {
      id: link.id,
      name: link.name,
      active: link.active,
      modes: link.modes || [],
      practice: practiceModes(link),
      exam: (link.modes || []).includes('exam'),
      contest: (link.modes || []).includes('contest'),
      topics: resolved.map((r) => ({ id: r.topic.id, title: r.topic.title, units: unitsOf(r.modules).map(({ id, title, type }) => ({ id, title, type })) })),
      resolved,
    };
  }

  // ---- Lehrkraft ----

  async forTeacher(user: any, classId: string, req?: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    const url = `${baseUrl(req)}/?k=${nb.token}`;
    const students = await this.studentRepo.find({ where: { classId }, select: ['id', 'status', 'pinShownAt'] });
    const links = await Promise.all((await this.classLinks(klasse)).map(async (l) => {
      const info = await this.linkInfo(l);
      const avail = await this.available(l, user);
      const selection = (l.selection || []) as SelEntry[];
      return {
        ...info,
        notReleased: avail.notReleased,
        // Was die Zuweisung enthalten kann, mit Schalter je Lernthema und Modul.
        available: avail.topics.map((t) => {
          const entry = selection.find((e) => e.topicId === t.topicId);
          return { ...t, enabled: !!entry && t.modules.some((m) => moduleOn(entry, m)), modules: t.modules.map((m) => ({ ...m, enabled: moduleOn(entry, m) })) };
        }),
      };
    }));
    return {
      classId,
      className: klasse.name,
      schoolYear: klasse.schoolYear,
      strict: klasse.strict,
      url,
      qrSvg: await renderQr(url),
      firstLoginUntil: firstLoginOpen(nb.firstLoginUntil) ? nb.firstLoginUntil : null,
      teacherItems: nb.teacherItems || [],
      marker: nb.marker || null,
      students: {
        total: students.length,
        confirmed: students.filter((s) => s.status !== 'pending').length,
        pinSeen: students.filter((s) => s.status !== 'pending' && s.pinShownAt).length,
      },
      links: links.map(({ resolved: _r, ...l }) => l),
    };
  }

  /**
   * Was eine Zuweisung enthalten kann: bei einem Bereich (Regel des Knotens)
   * alle startbaren Lernthemen darin – auch später dazugelegte –, sonst die
   * gewählten; je Lernthema alle Module, die der Lehrkraft zustehen.
   */
  private async available(link: TopicLink, user: any) {
    const rule = link.templateId ? await this.linkRepo.findOne({ where: { id: link.templateId } }) : null;
    const ids: string[] = [];
    let notReleased: string[] = [];
    if (rule?.quickNodeId) {
      const found = await this.notebooks.topicsOfNode(rule.quickNodeId, user).catch(() => ({ included: [] as string[], notReleased: [] as string[] }));
      ids.push(...found.included);
      notReleased = found.notReleased;
    }
    if (rule?.quickTopicId && !ids.includes(rule.quickTopicId)) ids.push(rule.quickTopicId);
    for (const e of [...(rule?.selection || []), ...(link.selection || [])]) if (!ids.includes(e.topicId)) ids.push(e.topicId);
    const resolved = ids.length
      ? await this.links.resolveModules(Object.assign(new TopicLink(), link, { selection: ids.map((topicId) => ({ topicId, all: true })) }))
      : [];
    const topics = resolved.map((r) => ({
      topicId: r.topic.id,
      title: r.topic.title,
      modules: r.modules.map((m) => ({
        id: m.id, title: m.title || '', type: m.type,
        subIds: ((m as any).subModules || []).map((x: LearningModule) => x.id),
      })),
    }));
    return { topics, notReleased };
  }

  private async ownClassLink(user: any, classId: string, linkId: string) {
    await this.classes.ownedClass(classId, user);
    const link = await this.linkRepo.findOne({ where: { id: linkId, classId, ownerId: user.userId } });
    if (!link) throw new NotFoundException('Zuweisung nicht gefunden.');
    return link;
  }

  /** `{ topicId, moduleId?, enabled }` – Lernthema oder Modul dieser Zuweisung ein- oder ausschalten. */
  async setItem(user: any, classId: string, linkId: string, body: { topicId?: string; moduleId?: string; enabled?: boolean }) {
    const link = await this.ownClassLink(user, classId, linkId);
    const { topics } = await this.available(link, user);
    const topicId = String(body?.topicId || '');
    if (!topics.some((t) => t.topicId === topicId)) throw new BadRequestException('Dieses Lernthema gehört nicht zur Zuweisung.');
    link.selection = toggleSelection((link.selection || []) as SelEntry[], topics as AvailTopic[], {
      topicId, moduleId: body?.moduleId ? String(body.moduleId) : undefined, enabled: !!body?.enabled,
    });
    // Eigene Auswahl dieser Klasse – das Nachziehen einer Freigabe überschreibt sie nicht ungefragt.
    link.customized = true;
    await this.linkRepo.save(link);
    return { success: true };
  }

  /**
   * Lernthema oder Knoten des Notizbuchs zuweisen. Die Auswahl wird
   * ausdrücklich: Später ergänzte Module und Lernthemen erscheinen
   * ausgeschaltet. Eine schon vorhandene Zuweisung bleibt, wie sie ist.
   */
  async assign(user: any, classId: string, body: { type?: string; id?: string }, req?: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const id = String(body?.id || '');
    const isNode = body?.type === 'node';
    const rule = await this.linkRepo.findOne({ where: { ownerId: user.userId, classId: IsNull(), ...(isNode ? { quickNodeId: id } : { quickTopicId: id }) } });
    const existing = rule ? await this.linkRepo.findOne({ where: { ownerId: user.userId, templateId: rule.id, classId: klasse.id } }) : null;
    if (existing) return { linkId: existing.id, existed: true, notReleased: [] };
    const created: any = isNode
      ? await this.notebooks.quickLink(id, user, klasse.id, req)
      : await this.links.classLinkForTopic(id, klasse.id, user, req);
    const link = await this.linkRepo.findOne({ where: { id: created.id } });
    if (link) {
      const { topics } = await this.available(link, user);
      link.selection = explicitSelection((link.selection || []) as SelEntry[], topics as AvailTopic[]);
      await this.linkRepo.save(link);
    }
    return { linkId: created.id, existed: false, notReleased: created.notReleased || [] };
  }

  /** 📍 Merker setzen (`{ linkId, topicId, moduleId }`) oder entfernen (`null`/leer). */
  async setMarker(user: any, classId: string, body: Partial<ClassNotebookMarker> | null) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    let marker: ClassNotebookMarker | null = null;
    if (body?.linkId && body.moduleId) {
      const link = await this.ownClassLink(user, classId, String(body.linkId));
      const { topics } = await this.available(link, user);
      const topic = topics.find((t) => t.modules.some((m) => m.id === body.moduleId));
      if (!topic) throw new BadRequestException('Dieses Modul gehört nicht zur Zuweisung.');
      marker = { linkId: link.id, topicId: topic.topicId, moduleId: String(body.moduleId) };
    }
    nb.marker = marker;
    await this.repo.save(nb);
    return { marker };
  }

  /** Erstanmeldung an (bis Ende des Tages) oder aus. */
  async setFirstLogin(user: any, classId: string, open: boolean) {
    const nb = await this.ensure(await this.classes.ownedClass(classId, user));
    nb.firstLoginUntil = open ? endOfDay() : null;
    await this.repo.save(nb);
    return { firstLoginUntil: nb.firstLoginUntil };
  }

  /** Neuer Klassenbuch-Link – der alte gilt nicht mehr. */
  async renewToken(user: any, classId: string, req?: any) {
    const nb = await this.ensure(await this.classes.ownedClass(classId, user));
    nb.token = crypto.randomBytes(12).toString('base64url');
    await this.repo.save(nb);
    return this.forTeacher(user, classId, req);
  }

  async setTeacherItems(user: any, classId: string, items: unknown) {
    const nb = await this.ensure(await this.classes.ownedClass(classId, user));
    const clean: ClassNotebookItem[] = [];
    for (const it of Array.isArray(items) ? items.slice(0, 200) : []) {
      const type = it?.type === 'node' ? 'node' : it?.type === 'topic' ? 'topic' : null;
      const id = typeof it?.id === 'string' ? it.id.slice(0, 64) : '';
      if (type && id && !clean.some((c) => c.type === type && c.id === id)) clean.push({ type, id });
    }
    nb.teacherItems = clean;
    await this.repo.save(nb);
    return { teacherItems: clean };
  }

  /**
   * Ergebnisübersicht: je Zuweisung (Klassenlink mit Übungsmodus) die Module,
   * je Schüler und Modul erledigt, bester Anteil richtig, Blatt bearbeitet.
   */
  async overview(user: any, classId: string) {
    const klasse = await this.classes.ownedClass(classId, user);
    const students = await this.studentRepo.find({ where: { classId } });
    const links = (await Promise.all((await this.classLinks(klasse)).map((l) => this.linkInfo(l)))).filter((l) => l.practice.length);
    const ids = links.map((l) => l.id);
    const results = ids.length ? await this.resultRepo.find({ where: { classId, linkId: In(ids) }, select: ['id', 'linkId', 'studentId', 'payload'] }) : [];
    const works = await this.workRepo.find({ where: { classId }, select: ['studentId', 'moduleId', 'linkId'] });
    return {
      students: students
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'de'))
        .map((s) => ({ id: s.id, name: s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName, pending: s.status === 'pending' })),
      links: links.map((l) => {
        const units = l.resolved.flatMap((r) => unitsOf(r.modules));
        const cells: Record<string, Record<string, unknown>> = {};
        for (const s of students) {
          const runs = results.filter((r) => r.linkId === l.id && r.studentId === s.id).map((r) => ({ details: (r.payload?.details || []) as DetailLike[] }));
          const mine = new Set(works.filter((w) => w.studentId === s.id && w.linkId === l.id).map((w) => w.moduleId));
          cells[s.id] = unitCells(units, runs, mine);
        }
        return { id: l.id, name: l.name, active: l.active, units: units.map(({ id, title, type }) => ({ id, title, type })), cells };
      }),
    };
  }

  // ---- Schüler ----

  private async byToken(token: string) {
    const nb = token ? await this.repo.findOne({ where: { token } }) : null;
    const klasse = nb ? await this.classes.findById(nb.classId) : null;
    if (!nb || !klasse) throw new NotFoundException('Diesen Klassenbuch-Link gibt es nicht (mehr). Bitte bei der Lehrkraft nachfragen.');
    const owner = klasse.ownerId ? await this.userRepo.findOne({ where: { id: klasse.ownerId } }) : null;
    if (!owner || owner.active === false) throw new ForbiddenException('Dieses Klassennotizbuch ist derzeit gesperrt.');
    return { nb, klasse, owner };
  }

  async info(token: string) {
    const { nb, klasse, owner } = await this.byToken(token);
    return { className: klasse.name, teacher: owner.displayName || '', firstLoginOpen: firstLoginOpen(nb.firstLoginUntil) };
  }

  /**
   * Anmeldung mit Name (wie beim Klassenlink) und PIN. Ergebnis: Ausweis für
   * das Klassennotizbuch; `pin`, wenn sie jetzt das erste Mal gezeigt wird.
   */
  async login(token: string, body: { name?: string; pin?: string; testPassword?: string }) {
    const { nb, klasse } = await this.byToken(token);
    const typed = String(body?.name || '').trim().replace(/\s+/g, ' ');
    if (!typed) throw new BadRequestException('Bitte den Namen eingeben.');
    const who = await this.classes.resolveStudent(klasse, typed, body?.testPassword);
    const student = isTestStudent(who.studentId) ? null : await this.studentRepo.findOne({ where: { id: who.studentId, classId: klasse.id } });
    const pin = String(body?.pin ?? '').trim() || undefined;

    if (student && student.status !== 'pending') {
      const locked = pinGuard.lockedFor(student.id);
      if (locked) throw new ForbiddenException({ statusCode: 403, needPin: true, message: `Zu viele falsche PINs – bitte in ${locked} Minute${locked === 1 ? '' : 'n'} noch einmal.` });
    }
    const decision = loginDecision(student, pin, firstLoginOpen(nb.firstLoginUntil), pinMatches);
    if (decision === 'wrong') {
      pinGuard.failed(student!.id);
      throw new ForbiddenException({ statusCode: 403, needPin: true, message: 'Falsche PIN. Vergessen? Die Lehrkraft sieht sie in der Klassenliste.' });
    }
    if (decision === 'need') throw new ForbiddenException({ statusCode: 403, needPin: true, message: 'Bitte deine PIN eingeben.' });
    if (decision === 'closed') {
      throw new ForbiddenException({
        statusCode: 403, needPin: true,
        message: 'Gib deine PIN ein. Kennst du sie noch nicht, frag deine Lehrkraft – sie kann sie dir sagen oder die erste Anmeldung im Unterricht freischalten.',
      });
    }
    let shown: string | undefined;
    if (student && decision === 'show') {
      student.pin = student.pin || newPin();
      student.pinShownAt = new Date();
      await this.studentRepo.update({ id: student.id }, { pin: student.pin, pinShownAt: student.pinShownAt });
      shown = student.pin;
    } else if (student && decision === 'ok' && student.status !== 'pending') {
      pinGuard.passed(student.id);
      // Von der Lehrkraft gesagte PIN: gilt ab jetzt als gesehen.
      if (!student.pinShownAt) await this.studentRepo.update({ id: student.id }, { pinShownAt: new Date() });
    }
    return {
      ticket: issueTicket(classbookTicketKey(klasse.id), who.studentId, who.name),
      name: who.name,
      pending: student?.status === 'pending',
      ...(shown ? { pin: shown } : {}),
    };
  }

  private async session(token: string, ticket: unknown) {
    const { nb, klasse } = await this.byToken(token);
    const t = readTicket(ticket, classbookTicketKey(klasse.id));
    if (!t) throw new ForbiddenException({ statusCode: 403, expired: true, message: 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.' });
    const student = isTestStudent(t.s) ? null : await this.studentRepo.findOne({ where: { id: t.s, classId: klasse.id } });
    if (!student && !isTestStudent(t.s)) throw new ForbiddenException({ statusCode: 403, expired: true, message: 'Dieser Name steht nicht mehr in der Klassenliste.' });
    return { nb, klasse, ticket: t, student };
  }

  /**
   * Startseite des Schülers: Zuweisungen mit Modulen und seinem Stand, dazu
   * seine Ergebnisse und Blätter. Unbestätigte Einträge sehen nur die
   * Zuweisungen – unter ihrem Namen könnte sich jeder anmelden.
   */
  async home(token: string, ticket: unknown) {
    const { nb, klasse, ticket: t, student } = await this.session(token, ticket);
    const confirmed = !!student && student.status !== 'pending';
    const active = (await this.classLinks(klasse)).filter((l) => l.active);
    const links = (await Promise.all(active.map((l) => this.linkInfo(l)))).filter((l) => l.practice.length || l.contest);
    // Laufende Klassenarbeiten: aktiv und ihr Link ist erzeugt (die Lehrkraft hat ihn ausgegeben).
    const exams = await Promise.all(active.filter((l) => (l.modes || []).includes('exam') && l.examToken).map(async (l) => {
      const attempt = await this.attemptRepo.findOne({ where: { linkId: l.id, studentId: t.s } });
      return { linkId: l.id, name: l.name, state: isTestStudent(t.s) ? 'open' : examState(attempt, l.singleAttempt) };
    }));
    const results = confirmed ? await this.resultRepo.find({ where: { classId: klasse.id, studentId: t.s }, order: { createdAt: 'DESC' } }) : [];
    const works = confirmed
      ? await this.workRepo.find({ where: { classId: klasse.id, studentId: t.s }, select: ['id', 'linkId', 'moduleId', 'moduleTitle', 'access', 'updatedAt'], order: { updatedAt: 'DESC' } })
      : [];
    return {
      className: klasse.name,
      name: t.n,
      pending: !confirmed && !isTestStudent(t.s),
      exams,
      // Nur, wenn die Schüler das Modul gerade sehen (Zuweisung aktiv, Modul eingeschaltet).
      marker: nb.marker && links.some((l) => l.id === nb.marker!.linkId
        && l.topics.some((tp) => tp.id === nb.marker!.topicId && tp.units.some((u) => u.id === nb.marker!.moduleId))) ? nb.marker : null,
      assignments: links.map((l) => {
        const runs = results.filter((r) => r.linkId === l.id).map((r) => ({ details: (r.payload?.details || []) as DetailLike[] }));
        const mine = new Set(works.filter((w) => w.linkId === l.id).map((w) => w.moduleId));
        const units = l.resolved.flatMap((r) => unitsOf(r.modules));
        const cells = confirmed ? unitCells(units, runs, mine) : {};
        return {
          linkId: l.id,
          name: l.name,
          modes: l.practice,
          contest: l.contest,
          topics: l.topics.map((tp) => ({ ...tp, units: tp.units.map((u) => ({ ...u, ...(cells[u.id] || {}) })) })),
        };
      }),
      results: results.filter((r) => r.mode !== 'exam').map((r) => ({
        id: r.id, linkName: r.linkName || '', mode: r.mode, score: r.score, maxScore: r.maxScore,
        percentage: r.payload?.percentage ?? null, at: r.createdAt,
      })),
      works: works.filter((w) => w.access !== 'exam').map((w) => ({ linkId: w.linkId, moduleId: w.moduleId, title: w.moduleTitle || 'Dokument', at: w.updatedAt })),
    };
  }

  /**
   * Eine Zuweisung öffnen: Adresse des Klassenlinks. Den Durchlauf startet
   * dann der gewöhnliche Link-Start mit dem Ausweis des Klassennotizbuchs.
   */
  async enter(token: string, body: { ticket?: string; linkId?: string; exam?: boolean }) {
    const { klasse } = await this.session(token, body?.ticket);
    const link = await this.linkRepo.findOne({ where: { id: String(body?.linkId || ''), classId: klasse.id } });
    if (!link || !link.active) throw new NotFoundException('Diese Aufgabe ist gerade nicht freigegeben.');
    // Klassenarbeit: nur über ihren eigenen Link – den gibt es erst, wenn die Lehrkraft ihn ausgegeben hat.
    if (body?.exam) {
      if (!(link.modes || []).includes('exam') || !link.examToken) throw new NotFoundException('Diese Klassenarbeit ist gerade nicht freigegeben.');
      return { linkToken: link.examToken };
    }
    let linkToken = await this.links.practiceToken(link);
    if (!linkToken) {
      link.token = crypto.randomBytes(12).toString('base64url');
      await this.linkRepo.save(link);
      linkToken = link.token;
    }
    return { linkToken };
  }
}
