import { Controller, Get, Post, Body, Param, Req, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { Result } from '../entities/result.entity';
import { TopicLink } from '../entities/topic-link.entity';
import { LinksService } from '../../links/links.service';
import * as crypto from 'crypto';

@Controller('public')
export class PublicController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    private readonly linksService: LinksService,
  ) {}

  /**
   * GET /public/quick/:token
   * Einstieg über Quick-Link bzw. QR-Code: liefert das Thema mitsamt Modulen,
   * ohne dass der Schüler Lehrer-E-Mail, Subscribe-Key oder Themenpasswort
   * eingeben muss. Der Token selbst ist der Zugangsschlüssel.
   */
  @Get('quick/:token')
  async getQuickTopic(@Param('token') token: string) {
    if (!token) throw new NotFoundException('Ungültiger Link.');

    const topic = await this.topicRepo
      .createQueryBuilder('topic')
      .where('topic.quickToken = :token', { token })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC')
      .getOne();

    if (!topic) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
    if (!topic.selected) throw new ForbiddenException('Dieses Thema ist derzeit nicht freigegeben.');

    const teacher = await this.userRepo.findOne({ where: { id: topic.ownerId } });
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');

    const { accessPassword: _ap, subscribeKey: _sk, quickToken: _qt, ...safeTopic } = topic;
    return {
      teacherEmail: teacher.email,
      topic: safeTopic,
    };
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
    // Kommt der Durchlauf über einen Themen-Link, ist der Token die Quelle der
    // Wahrheit: Lehrkraft und Linkname stammen dann aus dem Link selbst und
    // nicht aus dem, was der Browser mitschickt.
    let link: TopicLink | null = null;
    if (body.linkToken) {
      link = await this.linkRepo.findOne({ where: { token: body.linkToken } });
      if (!link) throw new NotFoundException('Dieser Link ist ungültig oder wurde zurückgezogen.');
    }

    const teacher = link
      ? await this.userRepo.findOne({ where: { id: link.ownerId } })
      : await this.userRepo.findOne({
          where: [{ email: body.teacherEmail, role: 'teacher' }, { email: body.teacherEmail, role: 'admin' }],
        });
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
