import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';

@Injectable()
export class TopicsService {
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  async findAll(user: any) {
    const qb = this.topicRepo.createQueryBuilder('topic');
    
    // Multi-tenant (School) isolation
    if (user.role !== 'admin') {
      qb.where('topic.schoolId = :schoolId', { schoolId: user.schoolId });
    }

    return qb.leftJoinAndSelect('topic.modules', 'modules').orderBy('modules.orderIndex', 'ASC').addOrderBy('topic.id', 'ASC').getMany();
  }

  async findOne(id: string, user: any) {
    const qb = this.topicRepo.createQueryBuilder('topic')
      .where('topic.id = :id', { id })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC');
      
    const topic = await qb.getOne();

    if (!topic) throw new NotFoundException('Thema nicht gefunden');

    // Security check: School isolation
    if (user.role !== 'admin' && topic.schoolId !== user.schoolId) {
      throw new ForbiddenException('Keine Berechtigung für dieses Thema');
    }

    return topic;
  }

  async create(user: any, topicData: Partial<LearningTopic>) {
    const topic = this.topicRepo.create({
      ...topicData,
      ownerId: user.userId,
      schoolId: user.schoolId,
    });
    return this.topicRepo.save(topic);
  }

  async addModule(topicId: string, user: any, moduleData: Partial<LearningModule>) {
    const topic = await this.findOne(topicId, user);
    const module = this.moduleRepo.create({
      ...moduleData,
      topicId: topic.id,
      orderIndex: topic.modules ? topic.modules.length : 0,
    });
    return this.moduleRepo.save(module);
  }

  async remove(id: string, user: any) {
    const topic = await this.findOne(id, user);
    if (topic.modules && topic.modules.length > 0) {
      await this.moduleRepo.remove(topic.modules);
    }
    await this.topicRepo.remove(topic);
    return { success: true };
  }

  async update(id: string, user: any, updateData: Partial<LearningTopic>) {
    const topic = await this.findOne(id, user);
    Object.assign(topic, updateData);
    return this.topicRepo.save(topic);
  }

  async removeModule(topicId: string, moduleId: string, user: any) {
    const topic = await this.findOne(topicId, user);
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    await this.moduleRepo.remove(module);
    return { success: true };
  }

  async toggleModule(topicId: string, moduleId: string, selected: boolean, user: any) {
    const topic = await this.findOne(topicId, user);
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    module.moduleSelected = selected;
    await this.moduleRepo.save(module);
    return { success: true };
  }

  async bulkToggleModules(topicId: string, moduleIds: string[], selected: boolean, user: any) {
    const topic = await this.findOne(topicId, user);
    const modulesToUpdate = topic.modules.filter(m => moduleIds.includes(m.id));
    for (const m of modulesToUpdate) {
      m.moduleSelected = selected;
    }
    if (modulesToUpdate.length > 0) {
      await this.moduleRepo.save(modulesToUpdate);
    }
    return { success: true };
  }

  async reorderModules(topicId: string, moduleIds: string[], user: any) {
    const topic = await this.findOne(topicId, user);
    const updates = [];
    for (let i = 0; i < moduleIds.length; i++) {
      const module = topic.modules.find(m => m.id === moduleIds[i]);
      if (module) {
        module.orderIndex = i;
        updates.push(module);
      }
    }
    if (updates.length > 0) {
      await this.moduleRepo.save(updates);
    }
    return { success: true };
  }
}
