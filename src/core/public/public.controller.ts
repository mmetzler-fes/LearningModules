import { Controller, Get, Post, Body, Param, Req, NotFoundException, ForbiddenException, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadToNextcloud, fileStamp } from '../share/nextcloud-upload';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { Result } from '../entities/result.entity';
import { TopicLink } from '../entities/topic-link.entity';
import { TopicQuickLink } from '../entities/topic-quick-link.entity';
import { LinksService, LinkAccess, modesFor } from '../../links/links.service';
import { TopicsService } from '../../topics/topics.service';
import { GroupsService } from '../../groups/groups.service';
import { CompanionService } from '../../companion/companion.service';
import { ClassesService } from '../../classes/classes.service';
import { issueTicket, readTicket } from '../../classes/student-ticket';
import { TimingsService } from '../../timings/timings.service';
import { contentOf, forStudents } from './student-view';
import * as crypto from 'crypto';

const MAX_RECORDING_BYTES = 25 * 1024 * 1024;

@Controller('public')
export class PublicController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(TopicQuickLink) private readonly quickRepo: Repository<TopicQuickLink>,
    private readonly linksService: LinksService,
    private readonly topicsService: TopicsService,
    private readonly groupsService: GroupsService,
    private readonly companionService: CompanionService,
    private readonly classesService: ClassesService,
    private readonly timingsService: TimingsService,
  ) {}

  /**
   * GET /public/quick/:token
   * Einstieg über Quick-Link bzw. QR-Code: liefert das Thema mitsamt Modulen,
   * ohne dass der Schüler Lehrer-E-Mail, Subscribe-Key oder Themenpasswort
   * eingeben muss. Der Token selbst ist der Zugangsschlüssel.
   */
  @Get('quick/:token')
  async getQuickTopic(@Param('token') token: string) {
    const { topic, teacher } = await this.resolveQuickToken(token);

    const { accessPassword: _ap, subscribeKey: _sk, quickToken: _qt, sharedWith: _sw, sharedAccess: _sa, ...safeTopic } = topic;
    return {
      // Die Lehrkraft, die den Link verteilt hat – nicht zwingend die, von
      // der die Aufgaben stammen. Dort landen später die Ergebnisse.
      teacherEmail: teacher.email,
      topic: { ...safeTopic, modules: (safeTopic.modules || []).map(forStudents) },
    };
  }

  /**
   * Löst einen Quick-Token in Thema und zuständige Lehrkraft auf.
   *
   * Zwei Quellen, weil der Token früher als Spalte am Thema hing: zuerst die
   * Tabelle der Quick-Links, danach die alte Spalte. Für Links fremder
   * Lehrkräfte wird die Nutzungsfreigabe bei jedem Start neu geprüft – zieht
   * der Eigentümer sie zurück, wirkt das sofort, genau wie beim Themen-Link.
   */
  private async resolveQuickToken(token: string): Promise<{ topic: LearningTopic; teacher: User }> {
    if (!token) throw new NotFoundException('Ungültiger Link.');

    const entry = await this.quickRepo.findOne({ where: { token } });

    const topicQuery = (where: string, params: any) =>
      this.topicRepo
        .createQueryBuilder('topic')
        .where(where, params)
        .leftJoinAndSelect('topic.modules', 'modules')
        .orderBy('modules.orderIndex', 'ASC')
        .getOne();

    const topic = entry
      ? await topicQuery('topic.id = :id', { id: entry.topicId })
      : await topicQuery('topic.quickToken = :token', { token });

    if (!topic) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');

    const teacherId = entry ? entry.ownerId : topic.ownerId;
    const isOwnerLink = teacherId === topic.ownerId;

    // Der Haken "aktiv" gehört zur Schülersicht des Eigentümers. Bei einem
    // fremden Quick-Link ist die Nutzungsfreigabe die maßgebliche Zustimmung.
    if (isOwnerLink && !topic.selected) {
      throw new ForbiddenException('Dieses Thema ist derzeit nicht freigegeben.');
    }

    const teacher = await this.userRepo.findOne({ where: { id: teacherId } });
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');
    if (teacher.active === false) throw new ForbiddenException('Dieser Link ist derzeit gesperrt.');

    if (!isOwnerLink) {
      const asTeacher = await this.groupsService.asUser(teacher.id);
      const level = this.topicsService.accessLevel(topic, asTeacher);
      if (level === 'none') {
        throw new ForbiddenException('Dieser Link ist derzeit nicht mehr freigegeben.');
      }
      // Mit Nutzungsrecht nur die Module, die es umfasst.
      topic.modules = this.topicsService.visibleModules(topic, topic.modules || [], asTeacher);
    }

    return { topic, teacher };
  }

  // ==================== THEMEN-LINK ====================

  /**
   * GET /public/link/:token
   * Vorschau des Themen-Links: Name, erlaubte Modi und ob ein Passwort nötig
   * ist. Inhalte gibt es erst nach POST .../start – der Name des Schülers
   * gehört zu jedem Durchlauf dazu.
   */
  @Get('link/:token')
  async getLink(@Param('token') token: string) {
    const { link, access } = await this.findAccessByToken(token);
    const resolved = await this.linksService.resolveModules(link);

    const klasse = await this.classesService.findById(link.classId);
    return {
      linkId: link.id,
      name: link.name,
      className: klasse?.name ?? null,
      // Übungslink: Quiz, Lernen mit Lösungen, Lernbegleitung zur Wahl.
      // Link der Klassenarbeit: nur die Klassenarbeit.
      modes: modesFor(link, access),
      access,
      // Die Quiz-Arena läuft über den Übungslink mit &m=contest.
      contestEnabled: access === 'practice' && link.modes.includes('contest'),
      requiresPassword: !!link.accessPassword,
      singleAttempt: link.singleAttempt,
      topicCount: resolved.length,
      moduleCount: resolved.reduce((n, r) => n + r.modules.length, 0),
      topicTitles: resolved.map((r) => r.topic.title),
    };
  }

  /**
   * POST /public/link/:token/start
   * Startet einen Durchlauf: prüft Passwort und Modus, liefert die Module.
   */
  @Post('link/:token/start')
  async startLink(
    @Param('token') token: string,
    @Body() body: { studentName?: string; password?: string; mode?: string },
  ) {
    const { link, access } = await this.findAccessByToken(token);
    const allowed = modesFor(link, access);

    let studentName = (body?.studentName || '').trim().replace(/\s+/g, ' ');
    if (!studentName) throw new BadRequestException('Bitte den Namen eingeben.');

    if (link.accessPassword && (body?.password || '') !== link.accessPassword) {
      throw new ForbiddenException('Falsches Passwort.');
    }

    // Ohne Angabe gilt der einzige erlaubte Modus; bei mehreren muss der
    // Schüler sich entschieden haben.
    const mode = (body?.mode || (allowed.length === 1 ? allowed[0] : '')) as string;
    if (mode === 'contest') {
      throw new BadRequestException('Die Quiz-Arena startet über den Wartebereich.');
    }
    if (!allowed.includes(mode as any)) {
      throw new ForbiddenException(
        mode === 'exam'
          ? 'Die Klassenarbeit hat einen eigenen Link – bitte den Link der Lehrkraft verwenden.'
          : 'Dieser Modus ist für den Link nicht freigegeben.',
      );
    }

    // Klassenlink: Name einem Schüler der Klassenliste zuordnen. Im Ergebnis
    // steht dann sein Name aus der Liste, nicht die Schreibweise der Eingabe.
    const klasse = await this.classesService.findById(link.classId);
    let studentId: string | null = null;
    if (klasse) {
      const who = await this.classesService.resolveStudent(klasse, studentName);
      studentId = who.studentId;
      studentName = who.name;
    }

    if (mode === 'exam' && link.singleAttempt) {
      const previous = await this.resultRepo.count({
        where: studentId ? { linkId: link.id, studentId, mode: 'exam' } : { linkId: link.id, studentName, mode: 'exam' },
      });
      if (previous > 0) {
        throw new ForbiddenException(
          `Für "${studentName}" liegt bereits ein Durchlauf vor. Bitte bei der Lehrkraft melden.`,
        );
      }
    }

    const teacher = await this.userRepo.findOne({ where: { id: link.ownerId } });
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');

    const resolved = await this.linksService.resolveModules(link);
    if (resolved.length === 0) {
      throw new ForbiddenException('Dieser Link enthält derzeit keine Inhalte.');
    }

    return {
      linkId: link.id,
      linkName: link.name,
      className: klasse?.name ?? null,
      mode,
      studentName,
      studentTicket: studentId ? issueTicket(link.id, studentId, studentName) : null,
      teacherEmail: teacher.email,
      // Lernbegleitung: Kommentare, Joker und Zeitstrafe nach Schule,
      // Lehrkraft und Link.
      companion: mode === 'companion'
        ? await this.companionService.effectiveFor(link.ownerId, link.companionSettings)
        : undefined,
      topics: resolved.map((r) => ({
        id: r.topic.id,
        title: r.topic.title,
        description: r.topic.description,
        modules: r.modules.map(forStudents),
      })),
    };
  }

  /**
   * POST /public/recording – Aufnahme eines Schülers (Audio Recorder) in die
   * Nextcloud-Ablage der Lehrkraft. Der Server reicht nur durch.
   *
   * Geprüft wird wie bei den Ergebnissen über den Link: Das Modul muss zum
   * Link gehören, und die Ablage-Adresse stammt aus dem gespeicherten Modul,
   * nie aus der Anfrage. Hochgeladen wird nur, wenn das Modul der Lehrkraft
   * gehört, die den Link verteilt – sonst landeten Aufnahmen fremder Klassen
   * in der Nextcloud des Erstellers.
   */
  @Post('recording')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_RECORDING_BYTES } }))
  async uploadRecording(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { linkToken?: string; quickToken?: string; moduleId?: string; studentName?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Keine Aufnahme empfangen.');
    const studentName = String(body?.studentName || '').trim().slice(0, 60);
    if (!studentName) throw new BadRequestException('Name fehlt.');
    const mod = body?.moduleId ? await this.moduleRepo.findOne({ where: { id: body.moduleId } }) : null;
    if (!mod || mod.type !== 'audioRecorder') throw new NotFoundException('Aufgabe nicht gefunden.');

    let ownerId: string;
    let context: string;
    if (body.linkToken) {
      const link = await this.findLinkByToken(body.linkToken);
      const resolved = await this.linksService.resolveModules(link);
      if (!resolved.some((r) => r.modules.some((m) => m.id === mod.id))) {
        throw new ForbiddenException('Diese Aufgabe gehört nicht zum Link.');
      }
      ownerId = link.ownerId;
      context = link.name;
    } else if (body.quickToken) {
      const { topic, teacher } = await this.resolveQuickToken(body.quickToken);
      if (mod.topicId !== topic.id) throw new ForbiddenException('Diese Aufgabe gehört nicht zum Link.');
      ownerId = teacher.id;
      context = topic.title;
    } else {
      throw new ForbiddenException('Hochladen geht nur über einen Schüler-Link.');
    }

    const topic = await this.topicRepo.findOne({ where: { id: mod.topicId } });
    if (!topic || topic.ownerId !== ownerId) {
      throw new ForbiddenException('Für diese Aufgabe ist keine Ablage der Lehrkraft eingerichtet – bitte Bescheid geben.');
    }
    const content = contentOf(mod);
    if (!content.uploadUrl) throw new BadRequestException('Für diese Aufgabe ist keine Ablage eingerichtet.');

    const ext = /mp4|m4a|aac/.test(file.mimetype) ? 'm4a' : /ogg/.test(file.mimetype) ? 'ogg' : /wav/.test(file.mimetype) ? 'wav' : 'webm';
    const stamp = fileStamp();
    const fileName = `${stamp}_${studentName}_${context}_${mod.title || 'Aufnahme'}.${ext}`;
    await uploadToNextcloud(content.uploadUrl, content.uploadPassword, fileName, file.buffer, file.mimetype);
    return { success: true, fileName };
  }

  /**
   * Link zu einem Schlüssel: Übungslink (`token`) oder Link der
   * Klassenarbeit (`examToken`). Ohne Prüfung auf "aktiv".
   */
  private async linkOfToken(token: string): Promise<{ link: TopicLink; access: LinkAccess } | null> {
    if (!token) return null;
    const practice = await this.linkRepo.findOne({ where: { token } });
    if (practice) return { link: practice, access: 'practice' };
    const exam = await this.linkRepo.findOne({ where: { examToken: token } });
    return exam ? { link: exam, access: 'exam' } : null;
  }

  /** Gemeinsame Prüfung: Token bekannt, Link aktiv. */
  private async findLinkByToken(token: string): Promise<TopicLink> {
    return (await this.findAccessByToken(token)).link;
  }

  private async findAccessByToken(token: string): Promise<{ link: TopicLink; access: LinkAccess }> {
    if (!token) throw new NotFoundException('Ungültiger Link.');
    const found = await this.linkOfToken(token);
    if (!found) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
    const { link } = found;
    if (!link.active) throw new ForbiddenException('Dieser Link ist derzeit deaktiviert.');
    // Links eines deaktivierten Kontos ruhen mit ihm.
    const owner = await this.userRepo.findOne({ where: { id: link.ownerId } });
    if (!owner || owner.active === false) throw new ForbiddenException('Dieser Link ist derzeit gesperrt.');
    return found;
  }

  /**
   * POST /public/results
   * Submits a quiz result for a student (no account required).
   */
  @Post('results')
  async submitResult(
    @Body() body: {
      teacherEmail?: string;
      linkToken?: string;
      quickToken?: string;
      mode?: string;
      studentName: string;
      studentTicket?: string;
      topicId: string;
      moduleId: string;
      score: number;
      maxScore: number;
      payload?: any;
    },
    @Req() req: any,
  ) {
    // Kommt der Durchlauf über einen Link, ist der Token die Quelle der
    // Wahrheit: Lehrkraft und Linkname stammen dann aus dem Link selbst und
    // nicht aus dem, was der Browser mitschickt. Das gilt für den Themen-Link
    // wie für den Quick-Link – in beiden Fällen zählt, wer den Link verteilt
    // hat, nicht wem die Aufgaben gehören.
    let link: TopicLink | null = null;
    let linkMode: string | undefined;
    if (body.linkToken) {
      const found = await this.linkOfToken(body.linkToken);
      if (!found) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
      link = found.link;
      // Der Modus muss zum Zugang passen – über den Link der Klassenarbeit
      // entsteht immer ein Klassenarbeits-Ergebnis.
      const allowed: string[] = modesFor(link, found.access);
      linkMode = allowed.includes(body.mode || '') ? body.mode : allowed[0];
    }

    let teacher: User | null = null;
    // Beim Quick-Link steht der Thementitel als Linkname im Ergebnis, damit
    // die Durchlaeufe unter ihrem Thema erscheinen statt unter "Ohne Link".
    let quickTopicTitle: string | null = null;
    if (link) {
      teacher = await this.userRepo.findOne({ where: { id: link.ownerId } });
    } else if (body.quickToken) {
      const quick = await this.resolveQuickToken(body.quickToken);
      teacher = quick.teacher;
      quickTopicTitle = quick.topic.title;
    } else if (body.teacherEmail) {
      // Ohne Adresse keine Suche: TypeORM übergeht `email: undefined` in der
      // Bedingung und lieferte sonst einfach die erste Lehrkraft.
      teacher = await this.userRepo.findOne({
        where: [{ email: body.teacherEmail, role: 'teacher' }, { email: body.teacherEmail, role: 'admin' }],
      });
    }
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');

    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress = (typeof forwarded === 'string' ? forwarded.split(',')[0] : req.ip || '').trim();

    // Über einen Klassenlink: Klasse und ihr Schuljahr, sonst das aktuelle.
    // Wer es ist, sagt der Schülerausweis vom Start. Ohne gültigen Ausweis
    // nimmt eine strikte Klasse nichts an; eine offene den Namen wie bisher.
    const klasse = await this.classesService.findById(link?.classId);
    const ticket = klasse && link ? readTicket(body.studentTicket, link.id) : null;
    if (klasse?.strict && !ticket) {
      throw new ForbiddenException('Die Anmeldung ist abgelaufen. Bitte den Link neu öffnen und den Namen eingeben.');
    }

    const result = this.resultRepo.create({
      id: crypto.randomUUID(),
      studentName: ticket ? ticket.n : body.studentName,
      studentId: ticket ? ticket.s : null,
      teacherId: teacher.id,
      topicId: body.topicId,
      moduleId: body.moduleId,
      score: body.score,
      maxScore: body.maxScore,
      payload: body.payload || null,
      ipAddress: ipAddress || null,
      linkId: link?.id,
      linkName: link ? link.name : quickTopicTitle ?? undefined,
      linkKind: quickTopicTitle !== null ? 'quick' : undefined,
      // Der Quick-Link startet immer im Quiz-Modus.
      mode: link ? linkMode : quickTopicTitle !== null ? 'quiz' : undefined,
      schoolYear: klasse?.schoolYear || (await this.classesService.currentSchoolYear()),
      classId: klasse?.id ?? null,
      className: klasse?.name ?? null,
    });
    const saved = await this.resultRepo.save(result);
    // Bearbeitungszeiten für die Quiz-Arena – nur aus Durchläufen über einen
    // Link, nicht aus der Lehrervorschau. Ein Fehler hier kostet kein Ergebnis.
    if (link || quickTopicTitle !== null) {
      await this.timingsService.record(body.payload?.details, result.mode).catch(() => undefined);
    }
    return { success: true, id: saved.id };
  }
}
