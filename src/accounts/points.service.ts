import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PointsEntry } from '../core/entities/points-entry.entity';

/**
 * Was vom früheren Punktekonto bleibt: die Buchungen, zum Nachlesen.
 *
 * Bis Oktober 2026 kosteten Angebote im Shop Punkte, die an die Creator
 * gingen. Das passte nicht – Punkte ließen sich für nichts einsetzen, und
 * das eigentliche Ziel, mehr zu teilen, erreicht die sichtbare Wirkung besser
 * (docs/nutzung-und-bewertung.md). Seitdem ist alles frei; es wird nichts
 * mehr gebucht.
 */
@Injectable()
export class PointsService {
  constructor(@InjectRepository(PointsEntry) private readonly entryRepo: Repository<PointsEntry>) {}

  async ledger(userId: string, limit = 200) {
    return this.entryRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
