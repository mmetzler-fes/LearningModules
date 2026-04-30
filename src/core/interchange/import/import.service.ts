import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  async importTopicFromJson(jsonString: string, user: any, targetTopicId?: string) {
    let importData: any;
    try {
      importData = JSON.parse(jsonString);
    } catch (e) {
      throw new BadRequestException('Ungültiges JSON-Format');
    }

    let importModules = [];
    let topicTitle = 'Importiertes Thema';
    let topicDesc = '';

    if (importData.topic) {
      importModules = importData.topic.modules || [];
      topicTitle = importData.topic.title || topicTitle;
      topicDesc = importData.topic.description || '';
    } else if (importData.modules && Array.isArray(importData.modules)) {
      importModules = importData.modules;
    }

    if (importModules.length === 0) {
      throw new BadRequestException('Keine Module in der Datei gefunden');
    }

    let savedTopic: LearningTopic;
    if (targetTopicId) {
      // Add modules to existing topic
      const existing = await this.topicRepo.findOne({ where: { id: targetTopicId } });
      if (!existing) throw new NotFoundException('Thema nicht gefunden');
      if (user.role === 'teacher' && existing.ownerId !== user.userId) {
        throw new ForbiddenException('Kein Zugriff auf dieses Thema');
      }
      savedTopic = existing;
    } else {
      // Create new topic
      savedTopic = await this.topicRepo.save(this.topicRepo.create({
        id: crypto.randomUUID(),
        title: topicTitle,
        description: topicDesc,
        ownerId: user.userId,
        permissions: { visibleTo: 'school' },
      }));
    }

    const newModules = importModules.map((m: any) => {
      const { id: _id, topic: _topic, subModules: _sub, parent: _parent, ...moduleData } = m;
      const mod = Object.assign(new LearningModule(), {
        ...moduleData,
        id: crypto.randomUUID(),
        topicId: savedTopic.id,
        moduleSelected: true,
      });

      if (mod.type === 'dragAndDrop' && mod.content) {
        this.syncDragAndDropMapping(mod.content);
      }
      return mod;
    });

    await this.moduleRepo.save(newModules);

    return {
      success: true,
      topicId: savedTopic.id,
      importedCount: newModules.length,
    };
  }

  private syncDragAndDropMapping(content: any) {
    const zones = Array.isArray(content.dropZones) ? content.dropZones : [];
    const drags = Array.isArray(content.draggables) ? content.draggables : [];

    drags.forEach((d: any) => {
      if (d.correctZone && d.text) {
        const z = zones.find((zz: any) => zz.label === d.correctZone);
        if (z && !z.correctDraggable) z.correctDraggable = d.text;
      }
    });

    zones.forEach((z: any) => {
      if (z.correctDraggable && z.label) {
        const d = drags.find((dd: any) => dd.text === z.correctDraggable);
        if (d && !d.correctZone) d.correctZone = z.label;
      }
    });
  }
}
