import { Controller, Get, Post, Body, Param, Req, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { Result } from '../entities/result.entity';
import { TopicLink } from '../entities/topic-link.entity';
import { TopicQuickLink } from '../entities/topic-quick-link.entity';
import { LinksService } from '../../links/links.service';
import { TopicsService } from '../../topics/topics.service';
import * as crypto from 'crypto';

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

    const { accessPassword: _ap, subscribeKey: _sk, quickToken: _qt, ...safeTopic } = topic;
    return {
      // Die Lehrkraft, die den Link verteilt hat – nicht zwingend die, von
      // der die Aufgaben stammen. Dort landen später die Ergebnisse.
      teacherEmail: teacher.email,
      topic: safeTopic,
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

    if (!isOwnerLink) {
      const level = this.topicsService.accessLevel(topic, { userId: teacher.id, role: 'teacher' });
      if (level === 'none') {
        throw new ForbiddenException('Dieser Link ist derzeit nicht mehr freigegeben.');
      }
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
    const link = await this.findLinkByToken(token);
    const resolved = await this.linksService.resolveModules(link);

    return {
      linkId: link.id,
      name: link.name,
      modes: link.modes,
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
    const link = await this.findLinkByToken(token);

    const studentName = (body?.studentName || '').trim();
    if (!studentName) throw new BadRequestException('Bitte den Namen eingeben.');

    if (link.accessPassword && (body?.password || '') !== link.accessPassword) {
      throw new ForbiddenException('Falsches Passwort.');
    }

    // Ohne Angabe gilt der einzige erlaubte Modus; bei mehreren muss der
    // Schüler sich entschieden haben.
    const mode = (body?.mode || (link.modes.length === 1 ? link.modes[0] : '')) as string;
    if (!link.modes.includes(mode as any)) {
      throw new ForbiddenException('Dieser Modus ist für den Link nicht freigegeben.');
    }

    if (mode === 'exam' && link.singleAttempt) {
      const previous = await this.resultRepo.count({ where: { linkId: link.id, studentName, mode: 'exam' } });
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
      mode,
      studentName,
      teacherEmail: teacher.email,
      topics: resolved.map((r) => ({
        id: r.topic.id,
        title: r.topic.title,
        description: r.topic.description,
        modules: r.modules,
      })),
    };
  }

  /** Gemeinsame Prüfung: Token bekannt, Link aktiv. */
  private async findLinkByToken(token: string): Promise<TopicLink> {
    if (!token) throw new NotFoundException('Ungültiger Link.');
    const link = await this.linkRepo.findOne({ where: { token } });
    if (!link) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
    if (!link.active) throw new ForbiddenException('Dieser Link ist derzeit deaktiviert.');
    return link;
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
    if (body.linkToken) {
      link = await this.linkRepo.findOne({ where: { token: body.linkToken } });
      if (!link) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
    }

    let teacher: User | null = null;
    if (link) {
      teacher = await this.userRepo.findOne({ where: { id: link.ownerId } });
    } else if (body.quickToken) {
      teacher = (await this.resolveQuickToken(body.quickToken)).teacher;
    } else {
      teacher = await this.userRepo.findOne({
        where: [{ email: body.teacherEmail, role: 'teacher' }, { email: body.teacherEmail, role: 'admin' }],
      });
    }
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');

    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress = (typeof forwarded === 'string' ? forwarded.split(',')[0] : req.ip || '').trim();

    const result = this.resultRepo.create({
      id: crypto.randomUUID(),
      studentName: body.studentName,
      teacherId: teacher.id,
      topicId: body.topicId,
      moduleId: body.moduleId,
      score: body.score,
      maxScore: body.maxScore,
      payload: body.payload || null,
      ipAddress: ipAddress || null,
      linkId: link?.id,
      linkName: link?.name,
      mode: link ? body.mode : undefined,
    });
    const saved = await this.resultRepo.save(result);
    return { success: true, id: saved.id };
  }
}
