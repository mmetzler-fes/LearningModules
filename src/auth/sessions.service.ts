import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AuthSession } from '../core/entities/auth-session.entity';

/** „Angemeldet bleiben“: so lange nach der letzten Nutzung. */
export const REMEMBER_DAYS = 90;
/** Ohne Häkchen: ein Schultag. */
export const SHORT_HOURS = 12;
/** „Zuletzt aktiv“ höchstens so oft schreiben – nicht bei jedem Klick. */
const SEEN_EVERY_MS = 10 * 60 * 1000;

export const sessionEnd = (now: Date, remember: boolean) =>
  new Date(now.getTime() + (remember ? REMEMBER_DAYS * 24 : SHORT_HOURS) * 3600 * 1000);

/**
 * Anmeldungen je Gerät (docs: Anmeldung): anlegen, prüfen, verlängern,
 * auflisten, beenden. Beenden heißt löschen – das Token dazu gilt dann nicht mehr.
 */
@Injectable()
export class SessionsService {
  constructor(@InjectRepository(AuthSession) private readonly repo: Repository<AuthSession>) {}

  async open(userId: string, remember: boolean, label: string): Promise<AuthSession> {
    const now = new Date();
    // Abgelaufene Anmeldungen dieses Kontos dabei wegräumen.
    await this.repo.delete({ userId, expiresAt: LessThan(now) });
    return this.repo.save(this.repo.create({
      id: crypto.randomUUID(), userId, remember, label: label || 'Gerät', lastSeenAt: now, expiresAt: sessionEnd(now, remember),
    }));
  }

  /** Die Anmeldung, wenn sie zu `userId` gehört und noch gilt – sonst null. */
  async valid(sid: string, userId: string): Promise<AuthSession | null> {
    const s = await this.repo.findOne({ where: { id: sid } });
    const now = new Date();
    if (!s || s.userId !== userId || new Date(s.expiresAt) <= now) return null;
    if (now.getTime() - new Date(s.lastSeenAt).getTime() > SEEN_EVERY_MS) {
      await this.repo.update({ id: s.id }, { lastSeenAt: now });
    }
    return s;
  }

  /** „Angemeldet bleiben“ ab jetzt wieder 90 Tage; null, wenn sie nicht mehr gilt. */
  async extend(sid: string, userId: string): Promise<AuthSession | null> {
    const s = await this.valid(sid, userId);
    if (!s || !s.remember) return s;
    const now = new Date();
    s.lastSeenAt = now;
    s.expiresAt = sessionEnd(now, true);
    return this.repo.save(s);
  }

  async list(userId: string) {
    const now = new Date();
    return (await this.repo.find({ where: { userId } }))
      .filter((s) => new Date(s.expiresAt) > now)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
  }

  async end(userId: string, sid: string) {
    await this.repo.delete({ id: sid, userId });
  }

  /** Alle Anmeldungen des Kontos beenden – auf Wunsch außer `keep` (diesem Gerät). */
  async endAll(userId: string, keep: string | null = null) {
    await this.repo.delete(keep ? { userId, id: Not(keep) } : { userId });
  }
}
