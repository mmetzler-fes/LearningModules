import { Controller, Get, Post, Body, Param, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { LearningTopic } from '../entities/learning-topic.entity';
import { LearningModule } from '../entities/learning-module.entity';
import { Result } from '../entities/result.entity';
import * as crypto from 'crypto';

@Controller('public')
export class PublicController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
  ) {}

  /**
   * GET /public/teachers/:email/topics
   * Returns all public and password-protected topics of a teacher.
   * Students use this to browse available quizzes.
   */
  @Get('teachers/:email/topics')
  async getTeacherTopics(@Param('email') email: string) {
    const teacher = await this.userRepo.findOne({ where: { email, role: 'teacher' } });
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');

    const topics = await this.topicRepo
      .createQueryBuilder('topic')
      .where('topic.ownerId = :ownerId', { ownerId: teacher.id })
      .andWhere('topic.visibility != :locked', { locked: 'locked' })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC')
      .getMany();

    // Strip access passwords from response
    return topics.map(({ accessPassword, ...topic }) => ({
      ...topic,
      hasPassword: !!accessPassword && topic.visibility === 'password',
    }));
  }

  /**
   * POST /public/teachers/:email/topics/:id/verify-password
   * Verifies the access password for a password-protected topic.
   * Returns modules if password is correct.
   */
  @Post('teachers/:email/topics/:id/verify-password')
  async verifyTopicPassword(
    @Param('email') email: string,
    @Param('id') topicId: string,
    @Body() body: { password: string },
  ) {
    const teacher = await this.userRepo.findOne({ where: { email, role: 'teacher' } });
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');

    const topic = await this.topicRepo
      .createQueryBuilder('topic')
      .where('topic.id = :id', { id: topicId })
      .andWhere('topic.ownerId = :ownerId', { ownerId: teacher.id })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC')
      .getOne();

    if (!topic) throw new NotFoundException('Thema nicht gefunden.');
    if (topic.visibility === 'locked') throw new ForbiddenException('Dieses Thema ist gesperrt.');
    if (topic.visibility === 'password') {
      if (!body.password || body.password !== topic.accessPassword) {
        throw new ForbiddenException('Falsches Passwort.');
      }
    }

    const { accessPassword, ...safeTopic } = topic;
    return safeTopic;
  }

  /**
   * POST /public/results
   * Submits a quiz result for a student (no account required).
   */
  @Post('results')
  async submitResult(
    @Body() body: {
      teacherEmail: string;
      studentName: string;
      topicId: string;
      moduleId: string;
      score: number;
      maxScore: number;
      payload?: any;
    },
  ) {
    const teacher = await this.userRepo.findOne({ where: { email: body.teacherEmail, role: 'teacher' } });
    if (!teacher) throw new NotFoundException('Lehrer nicht gefunden.');

    const result = this.resultRepo.create({
      id: crypto.randomUUID(),
      studentName: body.studentName,
      teacherId: teacher.id,
      topicId: body.topicId,
      moduleId: body.moduleId,
      score: body.score,
      maxScore: body.maxScore,
      payload: body.payload || null,
    });
    const saved = await this.resultRepo.save(result);
    return { success: true, id: saved.id };
  }
}
