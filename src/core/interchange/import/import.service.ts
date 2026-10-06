import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';
import { convertMoodleXml, MoodleImportResult } from '../moodle/moodle-import';

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
    // KI-Antworten werden oft samt Markdown-Rahmen gespeichert: ```json … ```
    // und eventuell Text davor oder danach ("Teil 1 von 3 …"). Dann zählt
    // nur der Codeblock bzw. das JSON-Objekt darin.
    const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/i.exec(jsonString);
    const start = jsonString.indexOf('{');
    const body = fenced ? fenced[1] : start > 0 ? jsonString.slice(start) : jsonString;
    const candidates = [body, body.slice(0, body.lastIndexOf('}') + 1)];
    for (const candidate of candidates) {
      try { importData = JSON.parse(candidate); break; } catch (_) { /* nächster Versuch */ }
    }
    if (importData === undefined) {
      // KIs brechen lange Antworten gern mitten im JSON ab – das verdient
      // einen Hinweis, der weiterhilft.
      if (ImportService.openBraces(body) > 0) {
        throw new BadRequestException(
          'Die Datei ist unvollständig – sie endet mitten im JSON. Vermutlich wurde die KI-Antwort abgeschnitten; '
          + 'den Prompt mit weniger Modulen pro Antwort erneut erzeugen.',
        );
      }
      throw new BadRequestException('Ungültiges JSON-Format');
    }
    return this.importTopicData(importData, user, targetTopicId);
  }

  /**
   * Moodle-XML (Fragensammlung): Fragen umsetzen, dann wie ein JSON-Thema
   * anlegen. Übersprungenes und Vereinfachtes kommt im Ergebnis mit.
   */
  async importMoodleXml(xml: string, fileName: string, user: any, targetTopicId?: string) {
    let converted: MoodleImportResult;
    try {
      converted = convertMoodleXml(xml, fileName.replace(/\.xml$/i, '') || 'Moodle-Import');
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (converted.modules.length === 0) {
      const why = converted.skipped.length ? ` Übersprungen: ${converted.skipped.join('; ')}` : '';
      throw new BadRequestException(`Keine übernehmbaren Fragen in der Datei.${why}`);
    }
    const result = await this.importTopicData(
      { topic: { title: converted.title, description: 'Aus Moodle importiert.', modules: converted.modules } },
      user,
      targetTopicId,
    );
    return { ...result, skipped: converted.skipped, notes: converted.notes };
  }

  private async importTopicData(importData: any, user: any, targetTopicId?: string) {
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
      // Nur ins eigene Thema – auch Admins, denn die Module bekämen sonst
      // ein fremdes Thema als Heimat.
      if (existing.ownerId !== user.userId) {
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

    // Neue IDs, und Untermodule zeigen weiter auf ihr (neues) Elternmodul.
    const idMap = new Map<string, string>();
    for (const m of importModules) if (m && m.id) idMap.set(String(m.id), crypto.randomUUID());

    const newModules = importModules.map((m: any) => {
      const { id, topic: _topic, subModules: _sub, parent: _parent, creatorId: _creator, createdAt: _c, updatedAt: _u, ...moduleData } = m;
      const mod = Object.assign(new LearningModule(), {
        ...moduleData,
        id: (id && idMap.get(String(id))) || crypto.randomUUID(),
        parentId: m.parentId ? idMap.get(String(m.parentId)) || null : null,
        topicId: savedTopic.id,
        moduleSelected: true,
        // Was als offene Datei hereinkommt, ist neues Material in dieser App:
        // Creator ist, wer es importiert.
        creatorId: user.userId,
        // Tags stammen aus dem Quellkonto und existieren hier nicht. Sie
        // mitzuschleppen hiesse, unauffloesbare IDs am Modul zu hinterlassen.
        tagIds: null,
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
      topicTitle: savedTopic.title,
      importedCount: newModules.filter((m: any) => !m.parentId).length,
    };
  }

  /** Noch offene { bzw. [ am Textende (außerhalb von Strings) – > 0 heißt abgeschnitten. */
  private static openBraces(text: string): number {
    let depth = 0;
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
    }
    return depth + (inString ? 1 : 0);
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
