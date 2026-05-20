import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Result } from '../core/entities/result.entity';

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
  ) {}

  async findAll(user: any) {
    const qb = this.resultRepo.createQueryBuilder('result');

    // Teachers see only results for their own topics
    if (user.role === 'teacher') {
      qb.where('result.teacherId = :teacherId', { teacherId: user.userId });
    }
    // Admins see all results

    const results = await qb.orderBy('result.createdAt', 'DESC').getMany();

    return results.map(r => ({
      id: r.id,
      studentName: r.studentName,
      username: r.studentName, // Fallback for frontend
      topicId: r.topicId,
      topicTitle: r.payload?.topicTitle || 'Unbekanntes Thema',
      score: r.score,
      totalQuestions: r.maxScore,
      percentage: r.payload?.percentage || 0,
      timestamp: r.createdAt.toISOString(),
      details: r.payload?.details || [],
      ipAddress: r.ipAddress || null,
    }));
  }

  async deleteOne(id: string, user: any) {
    const result = await this.resultRepo.findOne({ where: { id } });
    if (!result) return { success: false };
    if (user.role === 'teacher' && result.teacherId !== user.userId) return { success: false };
    await this.resultRepo.delete({ id });
    return { success: true };
  }

  async deleteAll(user: any) {
    if (user.role === 'teacher') {
      await this.resultRepo.delete({ teacherId: user.userId });
    } else {
      await this.resultRepo.clear();
    }
    return { success: true };
  }
}
