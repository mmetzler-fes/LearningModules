import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';
import { convertMoodleXml, MoodleImportResult } from '../moodle/moodle-import';
import { loadBrowserModule } from '../../browser-module';
import { NextcloudService, mapNcRefs } from '../../../nextcloud/nextcloud.service';

/** Lesen des Importtexts – dieselbe Logik wie die Vorabprüfung im Browser. */
interface JsonText {
  extractJson(text: string): { ok: boolean; data?: any; truncated?: boolean };
}
const jsonText = () => loadBrowserModule<JsonText>('json-text.js');

/**
 * Kleine Abweichungen, die KIs trotz Beispiel gern machen, auf das Format
 * der Editoren bringen: Reihenfolge mit bloßen Texten, Memory-Paare als
 * [a, b], Kreuzworträtsel mit "word"/"hint" statt "answer"/"clue",
 * Drag and Drop mit unbekannter Darstellung.
 * Alles andere bleibt unverändert.
 */
export function normalizeImportedContent(type: string, content: any): any {
  if (!content || typeof content !== 'object') return content;
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  if (type === 'sorting' && Array.isArray(content.items)) {
    content.items = content.items.map((it: any) => (it && typeof it === 'object' ? it : { text: str(it), imageUrl: '' }));
  }
  if (type === 'memory' && Array.isArray(content.pairs)) {
    content.pairs = content.pairs.map((p: any) => {
      if (Array.isArray(p)) return { aText: str(p[0]), aImage: '', bText: str(p[1]), bImage: '' };
      if (p && typeof p === 'object' && !('aText' in p) && !('aImage' in p) && ('a' in p || 'b' in p)) {
        return { aText: str(p.a), aImage: '', bText: str(p.b), bImage: '' };
      }
      return p;
    });
  }
  if (type === 'crossword' && Array.isArray(content.words)) {
    content.words = content.words.map((w: any) => (w && typeof w === 'object'
      ? { ...w, answer: str(w.answer ?? w.word ?? w.solution), clue: str(w.clue ?? w.hint ?? w.question), imageUrl: str(w.imageUrl) }
      : w));
    if (typeof content.seed !== 'number') content.seed = Number(content.seed) || 0;
  }
  if (type === 'dragAndDrop') {
    // Paare nur mit "pairs"; Bild und "Text verbergen" an Zonen und Elementen.
    content.layout = content.layout === 'pairs' ? 'pairs' : '';
    const withImage = (o: any) => {
      if (!o || typeof o !== 'object') return o;
      const imageUrl = str(o.imageUrl);
      return { ...o, imageUrl, hideText: !!imageUrl && (o.hideText === true || o.hideText === 'true') };
    };
    if (Array.isArray(content.dropZones)) content.dropZones = content.dropZones.map(withImage);
    if (Array.isArray(content.draggables)) content.draggables = content.draggables.map(withImage);
  }
  return content;
}

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
    @Optional() private readonly nextcloud?: NextcloudService,
  ) {}

  async importTopicFromJson(jsonString: string, user: any, targetTopicId?: string) {
    // KI-Antworten samt Markdown-Rahmen und Text davor/danach: json-text.js
    const parsed = jsonText().extractJson(jsonString);
    if (!parsed.ok) {
      // KIs brechen lange Antworten gern mitten im JSON ab – das verdient
      // einen Hinweis, der weiterhilft.
      if (parsed.truncated) {
        throw new BadRequestException(
          'Die Datei ist unvollständig – sie endet mitten im JSON. Vermutlich wurde die KI-Antwort abgeschnitten; '
          + 'den Prompt mit weniger Modulen pro Antwort erneut erzeugen.',
        );
      }
      throw new BadRequestException('Ungültiges JSON-Format');
    }
    return this.importTopicData(parsed.data, user, targetTopicId);
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

  /** Ein bereits gelesenes Thema im Format des JSON-Exports einspielen. */
  async importTopicData(importData: any, user: any, targetTopicId?: string) {
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
        originId: null,
        // Tags stammen aus dem Quellkonto und existieren hier nicht. Sie
        // mitzuschleppen hiesse, unauffloesbare IDs am Modul zu hinterlassen.
        tagIds: null,
      });

      if (mod.type === 'dragAndDrop' && mod.content) {
        this.syncDragAndDropMapping(mod.content);
      }
      mod.content = normalizeImportedContent(mod.type, mod.content);
      return mod;
    });

    const notes = await this.resolveNextcloudRefs(newModules, user);
    await this.moduleRepo.save(newModules);

    return {
      success: true,
      topicId: savedTopic.id,
      topicTitle: savedTopic.title,
      importedCount: newModules.filter((m: any) => !m.parentId).length,
      ...(notes.length ? { notes } : {}),
    };
  }

  /**
   * Bilder aus dem KI-Prompt ("nc:<Ordner>/<Datei>") in Lese-URLs der eigenen
   * Nextcloud verwandeln. Was sich nicht finden lässt, bleibt leer – ein
   * kaputter Verweis im Modul hilft niemandem. Ergebnis: Hinweise für den Bericht.
   */
  private async resolveNextcloudRefs(modules: any[], user: any): Promise<string[]> {
    const refs = new Set<string>();
    for (const m of modules) mapNcRefs(m.content, (r) => { refs.add(r); return r; });
    if (!refs.size) return [];
    const ready = !!this.nextcloud && (await this.nextcloud.isReady(user.userId));
    const urls = ready ? await this.nextcloud!.resolveRefs(user.userId, [...refs]) : new Map<string, string | null>();
    const missing = [...refs].filter((r) => !urls.get(r));
    for (const m of modules) m.content = mapNcRefs(m.content, (r) => urls.get(r) || '');
    if (!missing.length) return [];
    return [ready
      ? `Bilder nicht in deiner Nextcloud gefunden, Feld bleibt leer: ${missing.map((r) => r.slice(3)).join(', ')}`
      : `Die Datei verweist auf ${missing.length} Bild${missing.length === 1 ? '' : 'er'} in einer Nextcloud – verbinde deine Nextcloud im Home-Menü (☁️ Nextcloud) und importiere erneut.`];
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
