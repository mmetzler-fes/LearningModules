import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { DrawingSource } from '../core/entities/drawing-source.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NextcloudService } from '../nextcloud/nextcloud.service';
import { WorksheetRendererClient } from '../worksheets/renderer.client';

/** Höchstens so oft je Lehrkraft und Ordner in die Nextcloud schauen. */
const SYNC_EVERY_MS = 20_000;

/**
 * Link auf eine Datei über diesen Server als Pfad (/api/nextcloud/…): Die
 * volle Adresse kennt der Server hinter einem Proxy oft nur als http://, und
 * Dokumente nehmen als Bildquelle nur https:// oder /api/ an.
 */
export function appPath(url: string): string {
  const m = /^https?:\/\/[^/]+(\/api\/.*)$/i.exec(String(url || ''));
  return m ? m[1] : url;
}

/** `<svgUrl>` bzw. `<svgUrl>?v=<n>` – auch mitten in HTML oder JSON. */
const versioned = (url: string) => new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?v=\\d+)?(?=["'\\\\\\s)<>]|$)`, 'g');

/**
 * Zeichnungen mit Quelle (LibreOffice Draw) – Ablage beim Import und Abgleich
 * mit der Nextcloud. Siehe docs/zeichnungen.md.
 */
@Injectable()
export class DrawingsService {
  private readonly logger = new Logger('Zeichnungen');
  private readonly lastSync = new Map<string, number>();
  /** Je Lehrkraft und Lernthema eins nach dem anderen (Ablegen, Abgleich) – sonst wählen zwei Importe denselben Dateinamen. */
  private readonly locks = new Map<string, Promise<unknown>>();

  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(key) || Promise.resolve();
    const run = before.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  constructor(
    @InjectRepository(DrawingSource) private readonly repo: Repository<DrawingSource>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    private readonly nextcloud: NextcloudService,
    private readonly renderer: WorksheetRendererClient,
  ) {}

  /** Darf die Lehrkraft Zeichnungen mit Quelle anlegen (eigenes Thema, Nextcloud verbunden)? */
  async canStore(user: any, topicId: string | undefined): Promise<boolean> {
    if (!topicId || !(await this.nextcloud.isReady(user.userId))) return false;
    const topic = await this.topicRepo.findOne({ where: { id: topicId }, select: ['id', 'ownerId'] });
    return !!topic && topic.ownerId === user.userId;
  }

  /**
   * Zeichnungen aus dem .odt-Import ablegen: je Zeichnung .odg + .svg im
   * Ordner des Themas. Ergebnis: Name im Dokument → { url, source }.
   */
  storeImported(user: any, topicId: string, docName: string,
    drawings: Map<string, { svg: Buffer; odg?: Buffer; widthMm: number }>) {
    return this.locked(`${user.userId}|${topicId}`, () => this.storeImportedNow(user, topicId, docName, drawings));
  }

  private async storeImportedNow(user: any, topicId: string, docName: string,
    drawings: Map<string, { svg: Buffer; odg?: Buffer; widthMm: number }>) {
    const out = new Map<string, { url: string; source: string }>();
    const stem = (docName || 'Zeichnung').replace(/\.[^.]+$/, '').slice(0, 60);
    const names = [...drawings].filter(([, d]) => d.odg).map(([name]) => name);
    const stored = await this.nextcloud.storeDrawings(user, topicId, names.map((name, i) => {
      const d = drawings.get(name)!;
      return { stem: `${stem}-Zeichnung-${i + 1}`, svg: d.svg, odg: d.odg! };
    }));
    for (const [i, name] of names.entries()) {
      const s = stored[i];
      const svgUrl = appPath(s.svgUrl);
      const odgUrl = appPath(s.odgUrl);
      await this.repo.save(this.repo.create({
        id: crypto.randomUUID(), ownerId: user.userId, topicId, folder: s.folder, odgName: s.odgName,
        svgName: s.svgName, svgUrl, odgUrl, etag: s.etag, version: 1,
      }));
      out.set(name, { url: svgUrl, source: odgUrl });
    }
    return out;
  }

  /** Zeichnungen mit Quelle in einem Lernthema – für die Übersicht am Dokument. */
  async list(user: any, topicId: string) {
    const rows = await this.repo.find({ where: { ownerId: user.userId, topicId }, order: { createdAt: 'ASC' } });
    return rows.map(({ id, folder, odgName, svgName, svgUrl, odgUrl, version, updatedAt }) => ({ id, folder, odgName, svgName, svgUrl, odgUrl, version, updatedAt }));
  }

  /**
   * Abgleich: Hat sich eine .odg in der Nextcloud geändert, wird ihr SVG neu
   * gezeichnet und die Links in den eigenen Modulen bekommen eine neue Fassung.
   * Mit `topicId` nur die Zeichnungen dieses Themas. `force` ohne Wartezeit.
   */
  async sync(user: any, topicId?: string, force = false) {
    const where: any = { ownerId: user.userId };
    if (topicId) where.topicId = topicId;
    const rows = await this.repo.find({ where });
    const result = { checked: 0, updated: [] as string[], failed: [] as string[] };
    if (!rows.length || !(await this.nextcloud.isReady(user.userId))) return result;
    const byTopic = new Map<string, DrawingSource[]>();
    for (const r of rows) byTopic.set(r.topicId || '', [...(byTopic.get(r.topicId || '') || []), r]);
    for (const [topic, list] of byTopic) {
      await this.locked(`${user.userId}|${topic}`, () => this.syncTopic(user, list, force, result));
    }
    return result;
  }

  /** Abgleich der Zeichnungen eines Lernthemas (unter der Sperre). */
  private async syncTopic(user: any, list: DrawingSource[], force: boolean, result: { checked: number; updated: string[]; failed: string[] }) {
    const byFolder = new Map<string, DrawingSource[]>();
    for (const r of list) byFolder.set(r.folder, [...(byFolder.get(r.folder) || []), r]);
    for (const [folder, rows] of byFolder) {
      const key = `${user.userId}|${folder}`;
      if (!force && Date.now() - (this.lastSync.get(key) || 0) < SYNC_EVERY_MS) continue;
      this.lastSync.set(key, Date.now());
      const entries = await this.nextcloud.drawingFolder(user.userId, folder);
      for (const stale of rows) {
        // Frisch lesen: Ein Abgleich direkt davor kann die Zeile schon aktualisiert haben.
        const row = (await this.repo.findOne({ where: { id: stale.id } })) || stale;
        result.checked++;
        const entry = entries.find((e) => e.name === row.odgName);
        const tag = entry ? entry.etag || entry.modified : '';
        if (!entry || !tag || tag === row.etag) continue;
        try {
          await this.redraw(user, row, tag);
          result.updated.push(row.odgName);
        } catch (err: any) {
          result.failed.push(`${row.odgName}: ${err?.message || err}`);
        }
      }
    }
  }

  /** .odg holen, neu zeichnen lassen, SVG ersetzen, Links in den Modulen auffrischen. */
  private async redraw(user: any, row: DrawingSource, tag: string) {
    const file = await this.nextcloud.readOwnFile(user.userId, row.folder, row.odgName);
    if (!file) throw new NotFoundException('Die .odg ist nicht mehr da.');
    const drawn = await this.renderer.renderDrawing(file.data);
    await this.nextcloud.writeOwnFile(user.userId, row.folder, row.svgName, drawn.svg, 'image/svg+xml');
    row.version += 1;
    row.etag = tag;
    await this.repo.save(row);
    await this.bumpLinks(user.userId, row.svgUrl, row.version);
  }

  /** In allen eigenen Modulen den Link des SVG auf die neue Fassung setzen (?v=). */
  private async bumpLinks(ownerId: string, svgUrl: string, version: number) {
    const topics = await this.topicRepo.find({ where: { ownerId }, select: ['id'] });
    if (!topics.length) return 0;
    const modules = await this.moduleRepo.find({ where: { topicId: In(topics.map((t) => t.id)) } });
    let changed = 0;
    for (const m of modules) {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? null);
      if (!text || !text.includes(svgUrl)) continue;
      const next = text.replace(versioned(svgUrl), `${svgUrl}?v=${version}`);
      if (next === text) continue;
      m.content = typeof m.content === 'string' ? next : JSON.parse(next);
      await this.moduleRepo.save(m);
      changed++;
    }
    return changed;
  }

  /**
   * Geänderte .odg von Hand hochladen (ohne Sync-Client): ersetzt die Datei
   * in der Nextcloud und zeichnet gleich neu.
   */
  async upload(user: any, id: string, odg: Buffer) {
    const found = await this.repo.findOne({ where: { id, ownerId: user.userId } });
    if (!found) throw new NotFoundException('Zeichnung nicht gefunden.');
    return this.locked(`${user.userId}|${found.topicId || ''}`, () => this.uploadNow(user, id, odg));
  }

  private async uploadNow(user: any, id: string, odg: Buffer) {
    const row = await this.repo.findOne({ where: { id, ownerId: user.userId } });
    if (!row) throw new NotFoundException('Zeichnung nicht gefunden.');
    if (!odg?.length || odg.subarray(0, 2).toString('latin1') !== 'PK') throw new BadRequestException('Das ist keine .odg-Datei.');
    const etag = await this.nextcloud.writeOwnFile(user.userId, row.folder, row.odgName, odg, 'application/vnd.oasis.opendocument.graphics');
    await this.redraw(user, row, etag || `upload-${Date.now()}`);
    return { success: true, version: row.version };
  }
}
