import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { PointsEntry, PointsReason } from '../core/entities/points-entry.entity';

/** Vom Admin einstellbar (Administration → Shop & Sicherheit). */
export interface PointsSettings {
  /** Guthaben eines neuen Kontos. */
  startPoints: number;
  /** Höchstzahl an Personen, an die ein Buyer eine Kopie zur Nutzung weitergibt. */
  buyerShareMax: number;
  /**
   * Untergrenze für Einkäufe: Ein Kauf geht, solange der Kontostand danach
   * nicht darunter liegt. null = keine Grenze. Punkte sind vor allem
   * Rückmeldung fürs Teilen – Tauschen soll nicht am Kontostand scheitern.
   */
  minBalance: number | null;
}

export const DEFAULT_POINTS_SETTINGS: PointsSettings = {
  startPoints: 200,
  buyerShareMax: 10,
  minBalance: null,
};

const SETTINGS_KEY = 'points_settings';

/**
 * Punktekonten für den Shop.
 *
 * Der Gedanke: Wer teilt, bekommt Punkte; wer nimmt, gibt welche ab. Punkte
 * sind vor allem Rückmeldung fürs Teilen – Konten dürfen deshalb ins Minus
 * (siehe `minBalance`). Einen Abzug oder ein Geschenk zum Jahreswechsel gibt
 * es nicht mehr (bis Oktober 2026); alte Buchungen dazu bleiben im Konto.
 *
 * Ein Konto wird erst beim ersten Zugriff mit dem Startguthaben eröffnet
 * (`points` ist bis dahin null). So muss das Anlegen eines Benutzers nichts
 * vom Shop wissen, und auch Konten aus der Zeit vor dem Shop bekommen ihr
 * Startguthaben.
 */
@Injectable()
export class PointsService {

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(PointsEntry) private readonly entryRepo: Repository<PointsEntry>,
  ) {}

  // ---- Einstellungen ----

  async getSettings(): Promise<PointsSettings> {
    const entry = await this.configRepo.findOne({ where: { key: SETTINGS_KEY } });
    // Nur bekannte Felder – gespeicherte Altlasten (z. B. der frühere
    // Jahresabzug) sollen nicht wieder auftauchen.
    const saved = entry?.value || {};
    const out = { ...DEFAULT_POINTS_SETTINGS };
    for (const key of Object.keys(out) as (keyof PointsSettings)[]) {
      if (saved[key] !== undefined) (out as any)[key] = saved[key];
    }
    return out;
  }

  async saveSettings(input: Partial<PointsSettings>): Promise<PointsSettings> {
    const current = await this.getSettings();
    const next = { ...current };
    const intIn = (v: any, min: number, max: number, field: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new BadRequestException(`${field}: bitte eine ganze Zahl zwischen ${min} und ${max}.`);
      }
      return n;
    };
    if (input.startPoints !== undefined) next.startPoints = intIn(input.startPoints, 0, 100000, 'Startguthaben');
    if (input.buyerShareMax !== undefined) {
      next.buyerShareMax = intIn(input.buyerShareMax, 0, 1000, 'Weitergabe durch Käufer');
    }
    if (input.minBalance !== undefined) {
      const raw = input.minBalance as any;
      next.minBalance = raw === null || raw === '' ? null : intIn(raw, -1000000, 0, 'Untergrenze');
    }
    await this.configRepo.save(this.configRepo.create({ key: SETTINGS_KEY, value: next }));
    return next;
  }

  // ---- Konto ----

  /** Kontostand; eröffnet das Konto bei Bedarf mit dem Startguthaben. */
  async balance(userId: string, manager?: EntityManager): Promise<number> {
    const user = await this.open(userId, manager);
    return user.points ?? 0;
  }

  /**
   * Lädt den Benutzer und eröffnet sein Konto, falls es noch keins gibt.
   * Läuft bei Bedarf in der Transaktion des Aufrufers.
   */
  async open(userId: string, manager?: EntityManager): Promise<User> {
    const users = manager ? manager.getRepository(User) : this.userRepo;
    const user = await users.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Benutzer nicht gefunden.');
    if (user.points === null || user.points === undefined) {
      const { startPoints } = await this.getSettings();
      user.points = startPoints;
      await users.save(user);
      await this.log(manager, userId, startPoints, startPoints, 'start', 'Startguthaben');
    }
    return user;
  }

  /**
   * Darf ein Konto mit diesem Stand für `price` einkaufen? Ohne Untergrenze
   * immer; sonst darf der Stand danach nicht darunter liegen.
   */
  static canSpend(balance: number, price: number, minBalance: number | null): boolean {
    return minBalance === null || balance - price >= minBalance;
  }

  /**
   * Bucht `delta` Punkte. `floor` ist der niedrigste erlaubte Stand danach:
   * 0, wenn nichts angegeben ist; null erlaubt jeden Stand. Ins Minus geht es
   * also nur, wo der Aufrufer es ausdrücklich zulässt – beim Einkauf (mit der
   * Untergrenze aus den Einstellungen) und bei Erstattungen.
   */
  async book(
    manager: EntityManager | undefined,
    userId: string,
    delta: number,
    reason: PointsReason,
    note?: string,
    floor: number | null = 0,
  ): Promise<number> {
    const users = manager ? manager.getRepository(User) : this.userRepo;
    const user = await this.open(userId, manager);
    const next = (user.points ?? 0) + delta;
    if (delta < 0 && floor !== null && next < floor) throw new BadRequestException('Nicht genug Punkte auf dem Konto.');
    user.points = next;
    await users.save(user);
    await this.log(manager, userId, delta, next, reason, note);
    return next;
  }

  private async log(
    manager: EntityManager | undefined,
    userId: string,
    delta: number,
    balance: number,
    reason: PointsReason,
    note?: string,
  ) {
    const repo = manager ? manager.getRepository(PointsEntry) : this.entryRepo;
    await repo.save(
      repo.create({ id: crypto.randomUUID(), userId, delta, balance, reason, note: note || null }),
    );
  }

  async ledger(userId: string, limit = 100) {
    return this.entryRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
