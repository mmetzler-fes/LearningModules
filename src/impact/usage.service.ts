import { Injectable, Logger, OnApplicationBootstrap, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { UsageCount } from '../core/entities/usage-count.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Result } from '../core/entities/result.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { matchCopies, moduleIdsOfRun, originsOfRun, periodOf } from './impact-rules';

/** Vom Admin einstellbar (Administration → Shop & Sicherheit). */
export interface ImpactSettings {
  /** Hinweis zum Teilen ab so vielen Übernahmen ohne eigenes Angebot; 0 = aus. */
  shareHintAfter: number;
}

export const DEFAULT_IMPACT_SETTINGS: ImpactSettings = { shareHintAfter: 5 };

const SETTINGS_KEY = 'impact_settings';
/** Einmalige Übernahme der Bestände (Herkunft alter Kopien, Zähler aus alten Ergebnissen). */
const BACKFILL_KEY = 'impact_backfill_v1';

/**
 * Zählt, wie oft Inhalte im Unterricht bearbeitet werden – je Original,
 * Lehrkraft, Klasse und Monat (UsageCount). Aufgerufen beim Speichern eines
 * Schülerergebnisses; ein Fehler hier darf nie ein Ergebnis kosten.
 */
@Injectable()
export class UsageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectRepository(UsageCount) private readonly usageRepo: Repository<UsageCount>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
  ) {}

  // ---- Einstellungen ----

  async getSettings(): Promise<ImpactSettings> {
    const saved = (await this.configRepo.findOne({ where: { key: SETTINGS_KEY } }))?.value || {};
    const out = { ...DEFAULT_IMPACT_SETTINGS };
    if (Number.isInteger(saved.shareHintAfter)) out.shareHintAfter = saved.shareHintAfter;
    return out;
  }

  async saveSettings(input: Partial<ImpactSettings>): Promise<ImpactSettings> {
    const next = await this.getSettings();
    if (input.shareHintAfter !== undefined) {
      const n = Number(input.shareHintAfter);
      if (!Number.isInteger(n) || n < 0 || n > 1000) {
        throw new BadRequestException('Hinweis zum Teilen: bitte eine ganze Zahl zwischen 0 und 1000.');
      }
      next.shareHintAfter = n;
    }
    await this.configRepo.save(this.configRepo.create({ key: SETTINGS_KEY, value: next }));
    return next;
  }

  // ---- Zählen ----

  /** Einen Durchlauf zählen: je bearbeitetem Original eine Bearbeitung. */
  async recordRun(run: { teacherId?: string | null; classId?: string | null; details: unknown; at?: Date }) {
    if (!run.teacherId) return;
    const origins = await this.originsOf(moduleIdsOfRun(run.details));
    const period = periodOf(run.at || new Date());
    for (const originId of origins) await this.bump(originId, run.teacherId, run.classId || '', period, 1);
  }

  /** Wie recordRun, aber ohne dass ein Fehler nach außen dringt. */
  async recordRunSafely(run: { teacherId?: string | null; classId?: string | null; details: unknown; at?: Date }) {
    try {
      await this.recordRun(run);
    } catch (err) {
      this.logger.warn(`Nutzung nicht gezählt: ${(err as Error).message}`);
    }
  }

  private async originsOf(moduleIds: string[]): Promise<string[]> {
    if (!moduleIds.length) return [];
    const mods = await this.findModules(moduleIds);
    const parentIds = mods.map((m) => m.parentId).filter((p) => p && !mods.some((m) => m.id === p)) as string[];
    const parents = parentIds.length ? await this.findModules(parentIds) : [];
    return originsOfRun(moduleIds, [...mods, ...parents]);
  }

  private async findModules(ids: string[]) {
    const out: LearningModule[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      out.push(...(await this.moduleRepo.find({ where: { id: In(ids.slice(i, i + 500)) }, select: ['id', 'originId', 'parentId'] })));
    }
    return out;
  }

  private async bump(originId: string, teacherId: string, classId: string, period: string, runs: number) {
    await this.usageRepo.query(
      `INSERT INTO usage_counts (id, originId, teacherId, classId, period, runs, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT (originId, teacherId, classId, period) DO UPDATE SET runs = runs + excluded.runs, updatedAt = datetime('now')`,
      [crypto.randomUUID(), originId, teacherId, classId, period, runs],
    );
  }

  /** Zähler für diese Originale. */
  async countsFor(originIds: string[]): Promise<UsageCount[]> {
    const ids = [...new Set(originIds)];
    const out: UsageCount[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      out.push(...(await this.usageRepo.find({ where: { originId: In(ids.slice(i, i + 500)) } })));
    }
    return out;
  }

  // ---- Bestände übernehmen ----

  async onApplicationBootstrap() {
    try {
      if (await this.configRepo.findOne({ where: { key: BACKFILL_KEY } })) return;
      const linked = await this.linkOldCopies();
      const counted = await this.countOldResults();
      await this.configRepo.save(this.configRepo.create({ key: BACKFILL_KEY, value: { at: new Date().toISOString(), linked, counted } }));
      if (linked || counted) this.logger.log(`Wirkung übernommen: ${linked} Module alter Kopien zugeordnet, ${counted} Ergebnisse gezählt`);
    } catch (err) {
      this.logger.error(`Übernahme der Wirkung fehlgeschlagen: ${(err as Error).message}`);
    }
  }

  /**
   * Kopien aus der Zeit vor `originId`: Über `copiedFromId` des Lernthemas
   * die Module des Originals suchen und zuordnen (matchCopies).
   */
  private async linkOldCopies(): Promise<number> {
    const copies = await this.topicRepo.find({ where: { copiedFromId: Not(IsNull()) } });
    let linked = 0;
    for (const copy of copies) {
      const [mine, source] = await Promise.all([
        this.moduleRepo.find({ where: { topicId: copy.id } }),
        this.moduleRepo.find({ where: { topicId: copy.copiedFromId as string } }),
      ]);
      if (!source.length) continue;
      const srcById = new Map(source.map((m) => [m.id, m]));
      const changed: LearningModule[] = [];
      for (const [copyId, srcId] of matchCopies(source, mine)) {
        const m = mine.find((x) => x.id === copyId)!;
        if (m.originId) continue;
        m.originId = srcById.get(srcId)!.originId || srcId;
        changed.push(m);
      }
      if (changed.length) await this.moduleRepo.save(changed);
      linked += changed.length;
    }
    return linked;
  }

  /** Zähler aus den bisherigen Schülerergebnissen. */
  private async countOldResults(): Promise<number> {
    const total = await this.resultRepo.count();
    const acc = new Map<string, { originId: string; teacherId: string; classId: string; period: string; runs: number }>();
    let counted = 0;
    for (let skip = 0; skip < total; skip += 500) {
      const rows = await this.resultRepo.find({
        select: ['id', 'teacherId', 'classId', 'createdAt', 'payload'], order: { createdAt: 'ASC' }, skip, take: 500,
      });
      for (const r of rows) {
        if (!r.teacherId) continue;
        const origins = await this.originsOf(moduleIdsOfRun(r.payload?.details));
        if (!origins.length) continue;
        counted++;
        const period = periodOf(new Date(r.createdAt));
        for (const originId of origins) {
          const key = [originId, r.teacherId, r.classId || '', period].join('|');
          const e = acc.get(key) || { originId, teacherId: r.teacherId, classId: r.classId || '', period, runs: 0 };
          e.runs++;
          acc.set(key, e);
        }
      }
    }
    for (const e of acc.values()) await this.bump(e.originId, e.teacherId, e.classId, e.period, e.runs);
    return counted;
  }
}
