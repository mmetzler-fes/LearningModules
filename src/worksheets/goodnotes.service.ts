import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NextcloudService } from '../nextcloud/nextcloud.service';
import { safeFolderName } from '../nextcloud/nextcloud-api';
import { DocNumberingService } from './doc-numbering.service';
import { TemplatesService } from './templates.service';
import { WorksheetsService } from './worksheets.service';
import { settingsAt } from './numbering';
import { renderQr } from '../core/share/link-url';

/** Ordner in der Nextcloud der Lehrkraft. */
export const GOODNOTES_FOLDER = 'GoodNotes';
/** Steigt, wenn sich der Aufbau des Hefts ändert – dann wird neu gerendert. */
const LAYOUT = 'gn2'; // gn2: Quiz-Adresse und QR-Code als Verweis
const CACHE_DAYS = 60;

export interface Heft {
  file: Buffer;
  /** Dateiname, z. B. „Variablen und Datentypen (Stand 2026-11-14).pdf“ */
  name: string;
  /** Datum des jüngsten Inhalts (JJJJ-MM-TT) */
  stand: string;
  cached: boolean;
  warnings: string[];
}

/** Dokumente eines Lernthemas, die ins Heft gehören: in Reihenfolge, ohne Klassenarbeiten und Gesperrtes. */
export function heftDocuments(modules: LearningModule[], allowed?: Set<string> | null): LearningModule[] {
  return [...modules]
    .filter((m) => m.type === 'document' && !m.parentId && m.moduleSelected !== false && (m.content as any)?.spec
      && String((m.content as any)?.kind || 'arbeitsblatt') !== 'klassenarbeit' && (!allowed || allowed.has(m.id)))
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const deDay = (iso: string) => iso.split('-').reverse().join('.');

/**
 * „📓 Für GoodNotes“: ein PDF je Lernthema – Titelseite, verlinktes
 * Inhaltsverzeichnis, PDF-Lesezeichen, nach jedem Blatt eine Karo-Seite,
 * Quizze zum Ausfüllen. Für Schüler ohne, für die Lehrkraft zusätzlich mit
 * Lösungen. Gerendert wird nur, wenn sich der Inhalt geändert hat (Hash über
 * Dokumente, Quizze des Lernthemas, Nummerierung und Vorlage); sonst kommt
 * die Datei aus dem Zwischenspeicher.
 */
@Injectable()
export class GoodnotesService {
  private readonly logger = new Logger('GoodNotes');
  private readonly dir = path.join(process.cwd(), 'data', 'goodnotes');
  /** Gleichzeitige Anfragen (eine Klasse lädt gleichzeitig) warten auf dasselbe Rendern. */
  private readonly running = new Map<string, Promise<{ file: Buffer; warnings: string[] }>>();

  constructor(
    private readonly worksheets: WorksheetsService,
    private readonly numbering: DocNumberingService,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @Optional() private readonly templates?: TemplatesService,
    @Optional() private readonly nextcloud?: NextcloudService,
  ) {}

  /**
   * Heft eines Lernthemas. `ownerId`: die Lehrkraft, der es gehört (beim
   * Schülerweg vorher geprüft). `allowed`: nur diese Module (Link der Schüler).
   */
  async heft(ownerId: string, topicId: string, opts: { solution?: boolean; allowed?: Set<string> | null; base?: string } = {}): Promise<Heft> {
    const topic = await this.topicRepo.findOne({ where: { id: topicId }, relations: ['modules'] });
    if (!topic) throw new NotFoundException('Lernthema nicht gefunden.');
    if (topic.ownerId !== ownerId) throw new ForbiddenException('Das Lernthema gehört dir nicht.');
    const docs = heftDocuments(topic.modules || [], opts.allowed);
    if (!docs.length) throw new BadRequestException('In diesem Lernthema gibt es keine Dokumente für ein Heft.');
    const user = { userId: ownerId };
    const n = await this.numbering.numberingFor(ownerId);
    const nodeId = docs.map((d) => n.docs.get(d.id)?.nodeId).find(Boolean) || null;
    const nodes = await this.nodeRepo.find({ where: { ownerId } });
    const settings = nodeId ? settingsAt(nodes, nodeId) : ({} as any);
    const tpl = this.templates ? await this.templates.resolve(ownerId, nodeId, 'skript', nodes) : null;

    // Stand: jüngste Änderung an den Dokumenten oder Quizzen des Lernthemas.
    const all = topic.modules || [];
    const newest = new Date(Math.max(...all.map((m) => new Date(m.updatedAt as any).getTime() || 0), new Date(topic.updatedAt as any).getTime() || 0));
    const stand = isoDay(newest);
    const solution = !!opts.solution;
    const hash = crypto.createHash('sha256').update(JSON.stringify({
      v: LAYOUT, solution, title: topic.title, stand,
      docs: docs.map((d) => [d.id, d.title, d.content, n.docs.get(d.id) ? [n.docs.get(d.id)!.pfad, n.docs.get(d.id)!.slug, n.docs.get(d.id)!.course] : null]),
      quizzes: all.filter((m) => m.type !== 'document').map((m) => [m.id, new Date(m.updatedAt as any).getTime() || 0]),
      tpl: tpl ? [tpl.id, new Date(tpl.updatedAt as any).getTime() || 0] : null,
      kurs: settings.kurs || '', autor: settings.autor || '', base: opts.base || '',
    })).digest('hex');

    const base = safeFolderName(topic.title, 'Lernthema');
    const name = `${base}${solution ? ' – Lösung' : ''} (Stand ${stand}).pdf`;
    const cachePath = path.join(this.dir, `${hash}.pdf`);
    const cachedFile = await fs.readFile(cachePath).catch(() => null);
    if (cachedFile) {
      void fs.utimes(cachePath, new Date(), new Date()).catch(() => undefined);
      return { file: cachedFile, name, stand, cached: true, warnings: [] };
    }

    let job = this.running.get(hash);
    if (!job) {
      job = (async () => {
        const kurs = settings.kurs || '';
        const { file, warnings } = await this.worksheets.renderSheets(user, docs, solution ? 'loesung_pdf' : 'pdf', {
          quizzes: 'print', numbering: n, template: tpl?.data ?? null, karoPage: true, base: opts.base,
          course: { kurs, autor: settings.autor || '', ...(settings.meta ? { meta: settings.meta } : {}) },
          skript: { titel: topic.title, kopfzeile: [kurs, topic.title, `Stand ${deDay(stand)}`].filter(Boolean).join(' – ') },
        });
        const buf = Buffer.isBuffer(file) ? file : Buffer.from(file as any);
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(cachePath, buf);
        void this.prune();
        return { file: buf, warnings };
      })().finally(() => this.running.delete(hash));
      this.running.set(hash, job);
    }
    const { file, warnings } = await job;
    return { file, name, stand, cached: false, warnings };
  }

  /**
   * Für die Lehrkraft: Schüler- und Lösungsheft, beide auch in die Nextcloud
   * (GoodNotes/<Lernthema> (Stand …).pdf). Ältere Stände desselben Lernthemas
   * dort werden ersetzt.
   */
  async forTeacher(ownerId: string, topicId: string, base?: string) {
    const student = await this.heft(ownerId, topicId, { base });
    const teacher = await this.heft(ownerId, topicId, { solution: true, base });
    let nextcloud: { folder: string; files: string[] } | null = null;
    let nextcloudError: string | null = null;
    if (this.nextcloud && (await this.nextcloud.isReady(ownerId).catch(() => false))) {
      try {
        nextcloud = await this.toNextcloud(ownerId, topicId, [student, teacher]);
      } catch (e: any) {
        nextcloudError = e?.message || 'Ablage in der Nextcloud fehlgeschlagen.';
        this.logger.warn(`Nextcloud ${ownerId}: ${nextcloudError}`);
      }
    }
    return { student, teacher, nextcloud, nextcloudError };
  }

  /**
   * Feste Adresse des Schülerhefts (ohne Lösungen) mit QR-Code: zum Zeigen am
   * Beamer oder Weitergeben. Läuft über den Quick-Link des Lernthemas – ohne ihn
   * gibt es keine Adresse (url: null).
   */
  async studentLink(ownerId: string, topicId: string, base: string) {
    const topic = await this.topicRepo.findOne({ where: { id: topicId }, select: ['id', 'ownerId'] });
    if (!topic) throw new NotFoundException('Lernthema nicht gefunden.');
    if (topic.ownerId !== ownerId) throw new ForbiddenException('Das Lernthema gehört dir nicht.');
    const token = await this.worksheets.quickTokenFor(ownerId, topicId);
    if (!token) return { url: null, qr: null };
    const url = `${base}/api/public/goodnotes/${encodeURIComponent(token)}/${encodeURIComponent(topicId)}`;
    return { url, qr: await renderQr(url) };
  }

  private async toNextcloud(ownerId: string, topicId: string, hefte: Heft[]) {
    const { nc } = await this.nextcloud!.connection(ownerId);
    const folder = [GOODNOTES_FOLDER];
    await nc.ensureFolder(folder);
    const entries = await nc.list(folder).catch(() => [] as any[]);
    const present = new Set(entries.map((e: any) => String(e.name || e.path?.split('/').pop() || '')));
    for (const h of hefte) {
      // Ältere Stände dieses Hefts entfernen (gleicher Name bis „(Stand “).
      const prefix = h.name.slice(0, h.name.lastIndexOf(' (Stand ') + 8);
      for (const old of present) {
        if (old !== h.name && old.startsWith(prefix) && old.endsWith('.pdf')) await nc.remove([...folder, old]).catch(() => undefined);
      }
      if (!present.has(h.name)) await nc.put([...folder, h.name], h.file, 'application/pdf');
    }
    return { folder: folder.join('/'), files: hefte.map((h) => h.name), topicId };
  }

  /** Zwischenspeicher: Hefte, die lange niemand abgerufen hat, entfernen. */
  private async prune() {
    const limit = Date.now() - CACHE_DAYS * 86400e3;
    for (const f of await fs.readdir(this.dir).catch(() => [] as string[])) {
      const p = path.join(this.dir, f);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.mtimeMs < limit) await fs.unlink(p).catch(() => undefined);
    }
  }
}
