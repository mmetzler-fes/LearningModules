import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, BadRequestException } from '@nestjs/common';
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
  /** Abzug am 1.1. in Prozent des Kontostands. */
  yearlyDecayPercent: number;
  /** Geschenk an alle aktiven Konten am 1.1. – nach dem Abzug. */
  yearlyBonus: number;
  /** Höchstzahl an Personen, an die ein Buyer eine Kopie zur Nutzung weitergibt. */
  buyerShareMax: number;
}

export const DEFAULT_POINTS_SETTINGS: PointsSettings = {
  startPoints: 200,
  yearlyDecayPercent: 10,
  yearlyBonus: 100,
  buyerShareMax: 10,
};

const SETTINGS_KEY = 'points_settings';
const LAST_YEARLY_KEY = 'points_last_yearly';

/**
 * Punktekonten für den Shop.
 *
 * Der Gedanke: Wer teilt, bekommt Punkte; wer nimmt, gibt welche ab. Damit
 * genug im Umlauf ist und Horten sich nicht lohnt, verliert jedes Konto am
 * 1.1. einen Anteil und bekommt danach einen festen Betrag geschenkt.
 *
 * Ein Konto wird erst beim ersten Zugriff mit dem Startguthaben eröffnet
 * (`points` ist bis dahin null). So muss das Anlegen eines Benutzers nichts
 * vom Shop wissen, und auch Konten aus der Zeit vor dem Shop bekommen ihr
 * Startguthaben.
 */
@Injectable()
export class PointsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PointsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(PointsEntry) private readonly entryRepo: Repository<PointsEntry>,
  ) {}

  // ---- Einstellungen ----

  async getSettings(): Promise<PointsSettings> {
    const entry = await this.configRepo.findOne({ where: { key: SETTINGS_KEY } });
    return { ...DEFAULT_POINTS_SETTINGS, ...(entry?.value || {}) };
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
    if (input.yearlyDecayPercent !== undefined) {
      next.yearlyDecayPercent = intIn(input.yearlyDecayPercent, 0, 100, 'Jährlicher Abzug');
    }
    if (input.yearlyBonus !== undefined) next.yearlyBonus = intIn(input.yearlyBonus, 0, 100000, 'Jahresgeschenk');
    if (input.buyerShareMax !== undefined) {
      next.buyerShareMax = intIn(input.buyerShareMax, 0, 1000, 'Weitergabe durch Käufer');
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
   * Bucht `delta` Punkte. Ins Minus geht es nie – die Prüfung steht hier und
   * nicht beim Aufrufer, damit kein Weg daran vorbeiführt.
   */
  async book(
    manager: EntityManager | undefined,
    userId: string,
    delta: number,
    reason: PointsReason,
    note?: string,
  ): Promise<number> {
    const users = manager ? manager.getRepository(User) : this.userRepo;
    const user = await this.open(userId, manager);
    const next = (user.points ?? 0) + delta;
    if (next < 0) throw new BadRequestException('Nicht genug Punkte auf dem Konto.');
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

  // ---- Jahreswechsel ----

  onApplicationBootstrap() {
    this.runYearlyIfDue().catch((err) => this.logger.error('Jahreswechsel der Punkte fehlgeschlagen', err));
    // Läuft der Server über Neujahr durch, greift die Prüfung spätestens
    // sechs Stunden später; sonst beim nächsten Start.
    this.timer = setInterval(
      () => this.runYearlyIfDue().catch((err) => this.logger.error('Jahreswechsel der Punkte fehlgeschlagen', err)),
      6 * 60 * 60 * 1000,
    );
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Holt jeden verpassten 1.1. nach: erst der prozentuale Abzug (abgerundet),
   * dann das Geschenk. Beim allerersten Lauf wird nur das Jahr vermerkt –
   * rückwirkend wird nichts abgezogen.
   */
  async runYearlyIfDue(now = new Date()) {
    const year = now.getFullYear();
    const entry = await this.configRepo.findOne({ where: { key: LAST_YEARLY_KEY } });
    const last = typeof entry?.value === 'number' ? entry.value : null;

    if (last === null) {
      await this.configRepo.save(this.configRepo.create({ key: LAST_YEARLY_KEY, value: year }));
      return 0;
    }
    if (last >= year) return 0;

    const settings = await this.getSettings();
    // Deaktivierte Konten ruhen: Sie verlieren nichts und bekommen nichts.
    const users = await this.userRepo.find({ where: { active: true } });
    for (let y = last + 1; y <= year; y++) {
      for (const u of users) {
        const current = await this.balance(u.id);
        const decay = Math.floor((current * settings.yearlyDecayPercent) / 100);
        if (decay > 0) await this.book(undefined, u.id, -decay, 'yearly-decay', `Jahreswechsel ${y}`);
        if (settings.yearlyBonus > 0) {
          await this.book(undefined, u.id, settings.yearlyBonus, 'yearly-bonus', `Jahreswechsel ${y}`);
        }
      }
      this.logger.log(`Jahreswechsel ${y}: ${users.length} Punktekonten angepasst`);
    }
    await this.configRepo.save(this.configRepo.create({ key: LAST_YEARLY_KEY, value: year }));
    return users.length;
  }
}
