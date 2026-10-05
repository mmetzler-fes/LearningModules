import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ModuleTiming } from '../core/entities/module-timing.entity';
import { arenaSeconds, MAX_SAMPLE_MS } from './arena-seconds';

/** Modi, deren Bearbeitungszeiten zählen: dort arbeiten Schüler wie in der Arena, nur ohne Uhr. */
const MEASURED_MODES = new Set(['quiz', 'companion']);
const MAX_ROWS_PER_RUN = 500;
/** Kürzer ist kein Lesen und Antworten, sondern Durchklicken. */
const MIN_SAMPLE_MS = 500;

/** Gemessene Bearbeitungszeiten je Modul und die Arena-Zeit daraus. */
@Injectable()
export class TimingsService {
  constructor(@InjectRepository(ModuleTiming) private readonly timingRepo: Repository<ModuleTiming>) {}

  /** Messungen eines Durchlaufs übernehmen (`details[].moduleId`, `details[].ms`). */
  async record(details: unknown, mode: string | undefined) {
    if (!mode || !MEASURED_MODES.has(mode) || !Array.isArray(details)) return;
    const rows = details
      .filter((d) => typeof d?.moduleId === 'string' && d.moduleId && Number.isFinite(d?.ms) && d.ms >= MIN_SAMPLE_MS)
      .slice(0, MAX_ROWS_PER_RUN)
      .map((d) =>
        this.timingRepo.create({
          id: crypto.randomUUID(),
          moduleId: String(d.moduleId).slice(0, 64),
          ms: Math.min(MAX_SAMPLE_MS, Math.round(d.ms)),
          mode,
        }),
      );
    if (rows.length) await this.timingRepo.save(rows);
  }

  /** Modul-ID → { seconds, n }; `seconds` ist `null`, solange es zu wenig Messungen gibt. */
  async arenaSecondsFor(moduleIds: string[]): Promise<Map<string, { seconds: number | null; n: number }>> {
    const ids = [...new Set(moduleIds.filter(Boolean))];
    const out = new Map<string, { seconds: number | null; n: number }>();
    if (ids.length === 0) return out;
    const rows = await this.timingRepo.find({ where: { moduleId: In(ids) }, select: ['moduleId', 'ms'] });
    const samples = new Map<string, number[]>();
    for (const r of rows) {
      if (!samples.has(r.moduleId)) samples.set(r.moduleId, []);
      samples.get(r.moduleId)!.push(r.ms);
    }
    for (const [id, list] of samples) out.set(id, { seconds: arenaSeconds(list), n: list.length });
    return out;
  }
}
