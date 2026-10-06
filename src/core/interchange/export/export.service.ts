import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';
import { User } from '../../entities/user.entity';
import { TopicsService } from '../../../topics/topics.service';
import { MasterKeyService } from '../../crypto/master-key.service';
import { H5pService } from '../h5p/h5p.service';
import { exportMoodleXml } from '../moodle/moodle-export';

/**
 * Export von Themen.
 *
 * Grundsatz: Unverschlüsselt verlässt nur Material die App, das der
 * Exportierende selbst verfasst hat (Creator). Alles andere – auch die
 * Sicherung eines ganzen Themas mit gekauften Modulen – geht nur
 * verschlüsselt mit dem Masterkey und lässt sich nur in einer App mit
 * demselben Masterkey wieder einlesen, und auch dort nur vom Exportierenden.
 */
@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly topics: TopicsService,
    private readonly masterKey: MasterKeyService,
    private readonly h5p: H5pService,
  ) {}

  /** Eigene Module (samt Untermodulen) aus einer Liste. */
  private ownModules(modules: LearningModule[], userId: string) {
    const direct = new Set(modules.filter((m) => m.creatorId === userId).map((m) => m.id));
    return modules.filter((m) => direct.has(m.id) || (!!m.parentId && direct.has(m.parentId)));
  }

  /** Was der Export-Dialog vorab wissen muss. */
  async info(topicId: string, user: any) {
    const topic = await this.topics.findOneFor(topicId, user, 'read');
    const roots = (topic.modules || []).filter((m) => !m.parentId);
    const own = roots.filter((m) => m.creatorId === user.userId).length;
    return {
      title: topic.title,
      ownModules: own,
      foreignModules: roots.length - own,
      canExportEncrypted: topic.ownerId === user.userId,
    };
  }

  private async plainSource(topicId: string, user: any) {
    const topic = await this.topics.findOneFor(topicId, user, 'read');
    const modules = this.ownModules(topic.modules || [], user.userId).sort((a, b) => a.orderIndex - b.orderIndex);
    if (modules.length === 0) {
      throw new ForbiddenException(
        'Unverschlüsselt exportieren lassen sich nur selbst verfasste Module – dieses Thema enthält keine. Bitte verschlüsselt exportieren.',
      );
    }
    return { topic, modules };
  }

  /** JSON nur mit den eigenen Modulen. */
  async exportJson(topicId: string, user: any) {
    const { topic, modules } = await this.plainSource(topicId, user);
    return {
      topic: {
        title: topic.title,
        description: topic.description,
        modules: modules.map((m) => ({
          id: m.id,
          parentId: m.parentId || null,
          type: m.type,
          title: m.title,
          description: m.description,
          content: m.content,
          orderIndex: m.orderIndex,
          moduleSelected: m.moduleSelected,
        })),
      },
    };
  }

  /** Moodle-XML (Fragensammlung) nur mit den eigenen, aktiven Modulen. */
  async exportMoodle(topicId: string, user: any) {
    const { topic, modules } = await this.plainSource(topicId, user);
    const active = modules.filter((m) => !m.parentId && m.moduleSelected !== false);
    return { title: topic.title, ...exportMoodleXml(topic.title, active) };
  }

  /** H5P nur mit den eigenen Modulen. */
  async exportH5p(topicId: string, user: any) {
    const { topic, modules } = await this.plainSource(topicId, user);
    return { title: topic.title, ...this.h5p.generateH5p(topic, modules) };
  }

  /**
   * Das ganze Thema verschlüsselt – nur für den Eigentümer. Creator jedes
   * Moduls und die Herkunft kommen mit, damit ein Re-Import die Rechte
   * unverändert herstellt.
   */
  async exportEncrypted(topicId: string, user: any) {
    const topic = await this.topicRepo.findOne({ where: { id: topicId }, relations: ['modules'] });
    if (!topic) throw new NotFoundException('Thema nicht gefunden.');
    if (topic.ownerId !== user.userId) throw new ForbiddenException('Verschlüsselt exportieren kann nur, wem das Thema gehört.');
    const data = {
      exporterId: user.userId,
      exporterEmail: user.email,
      topic: {
        title: topic.title,
        description: topic.description,
        permissions: topic.permissions,
        copiedFromId: topic.copiedFromId,
        copiedFromOwnerId: topic.copiedFromOwnerId,
        copiedFromAuthor: topic.copiedFromAuthor,
        copiedFromTitle: topic.copiedFromTitle,
      },
      modules: (topic.modules || []).map((m) => {
        const { topic: _t, subModules: _s, parent: _p, topicId: _tid, tagIds: _tags, ...rest } = m as any;
        return rest;
      }),
    };
    return { title: topic.title, buffer: this.masterKey.encrypt('topic', data) };
  }

  /**
   * Verschlüsselten Themen-Export wieder einlesen. Nur der Exportierende
   * (oder ein Konto, in das seines zusammengeführt wurde) darf das – sonst
   * wäre die Datei ein Weg am Shop vorbei.
   */
  async importEncrypted(buffer: Buffer, user: any, targetTopicId?: string) {
    const data = this.masterKey.decrypt(buffer, 'topic');
    const me = await this.userRepo.findOne({ where: { id: user.userId } });
    const mine = new Set([user.userId, ...((me && me.formerIds) || [])]);
    if (!mine.has(data?.exporterId)) {
      throw new ForbiddenException('Diesen Export kann nur die Person einlesen, die ihn erstellt hat.');
    }

    let topic: LearningTopic;
    if (targetTopicId) {
      topic = await this.topics.findOneFor(targetTopicId, user, 'owner');
    } else {
      const t = data.topic || {};
      topic = await this.topicRepo.save(
        this.topicRepo.create({
          id: crypto.randomUUID(),
          title: t.title || 'Importiertes Thema',
          description: t.description || '',
          ownerId: user.userId,
          permissions: t.permissions || { visibleTo: 'school' },
          copiedFromId: t.copiedFromId || null,
          copiedFromOwnerId: t.copiedFromOwnerId || null,
          copiedFromAuthor: t.copiedFromAuthor || null,
          copiedFromTitle: t.copiedFromTitle || null,
        }),
      );
    }

    const modules = this.rebuild(data.modules || [], topic.id, (m) =>
      // Module, die der Exportierende selbst verfasst hat, gehören jetzt dem
      // aktuellen Konto (nach einem Zusammenführen ist das eine neue ID).
      m.creatorId && mine.has(m.creatorId) ? user.userId : m.creatorId || null,
    );
    if (modules.length) await this.moduleRepo.save(modules);
    return { success: true, topicId: topic.id, topicTitle: topic.title, importedCount: modules.filter((m) => !m.parentId).length };
  }

  /** Neue IDs vergeben und die Eltern-Verweise mitziehen. */
  rebuild(raw: any[], topicId: string, creatorOf: (m: any) => string | null): LearningModule[] {
    const idMap = new Map<string, string>();
    for (const m of raw) if (m && m.id) idMap.set(String(m.id), crypto.randomUUID());
    return raw.map((m) => {
      const { id, topic: _t, subModules: _s, parent: _p, createdAt: _c, updatedAt: _u, ...rest } = m;
      return Object.assign(new LearningModule(), {
        ...rest,
        id: (id && idMap.get(String(id))) || crypto.randomUUID(),
        topicId,
        parentId: m.parentId ? idMap.get(String(m.parentId)) || null : null,
        creatorId: creatorOf(m),
        tagIds: null,
      });
    });
  }
}
