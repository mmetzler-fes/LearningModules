import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import { School } from '../core/entities/school.entity';
import { LinkCompanionSettings } from '../core/entities/topic-link.entity';
import { parseNextcloudShare } from '../core/share/nextcloud-upload';
import {
  CATEGORY_KEYS, COMPANION_CATEGORIES, CompanionConfig, CompanionSettings, DEFAULT_COMMENTS, DEFAULT_SETTINGS,
  MAX_COMMENT_LENGTH, MAX_COMMENTS_PER_CATEGORY,
} from './companion.defaults';

const MAX_SECONDS = 600;
const MAX_JOKERS = 10;

/** Ganze Zahl im Bereich, sonst null (= Vorgabe übernehmen). */
function optionalInt(value: any, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * Lernbegleiter (Eule) und Tusch für die Quiz-Arena.
 *
 * Es gilt die Reihenfolge Grundausstattung → Schule → Lehrkraft → Link:
 * Kommentare werden zusammengelegt, Einstellungen überschreibt jeweils die
 * spätere Stufe. So pflegt der Schuladmin eine gemeinsame Basis, und jede
 * Lehrkraft macht daraus ihren eigenen Begleiter.
 */
@Injectable()
export class CompanionService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(School) private readonly schoolRepo: Repository<School>,
  ) {}

  // ---- Eingaben prüfen ----

  /** Kommentare je Lage: nur bekannte Lagen, getrimmt, ohne Doppelte, begrenzt. */
  private cleanComments(raw: any): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const key of CATEGORY_KEYS) {
      const list = Array.isArray(raw[key]) ? raw[key] : [];
      const seen = new Set<string>();
      const clean: string[] = [];
      for (const item of list) {
        const text = String(item ?? '').trim().slice(0, MAX_COMMENT_LENGTH);
        if (!text || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        clean.push(text);
        if (clean.length >= MAX_COMMENTS_PER_CATEGORY) break;
      }
      if (clean.length) out[key] = clean;
    }
    return out;
  }

  /**
   * Tusch-Adresse: eine Nextcloud-Freigabe (wird zum direkten Download) oder
   * ein anderer https-Link. Leer = Vorgabe übernehmen.
   */
  private cleanSoundUrl(raw: any): string | null {
    const url = String(raw ?? '').trim();
    if (!url) return null;
    if (!/^https:\/\/\S+$/i.test(url)) {
      throw new BadRequestException('Der Tusch braucht einen https-Link, am besten eine Nextcloud-Freigabe.');
    }
    return url.slice(0, 1000);
  }

  private cleanConfig(body: any): CompanionConfig {
    const penaltyStart = optionalInt(body?.penaltyStart, 0, MAX_SECONDS);
    let penaltyMax = optionalInt(body?.penaltyMax, 0, MAX_SECONDS);
    if (penaltyStart !== null && penaltyMax !== null && penaltyMax < penaltyStart) penaltyMax = penaltyStart;
    return {
      comments: this.cleanComments(body?.comments),
      jokerMax: optionalInt(body?.jokerMax, 0, MAX_JOKERS),
      penaltyStart,
      penaltyMax,
      soundUrl: this.cleanSoundUrl(body?.soundUrl),
    };
  }

  /** Einstellungen eines Links: nur Joker und Zeitstrafe. */
  cleanLinkSettings(body: any): LinkCompanionSettings | null {
    if (!body || typeof body !== 'object') return null;
    const c = this.cleanConfig({ ...body, comments: {}, soundUrl: '' });
    const out: LinkCompanionSettings = {
      jokerMax: c.jokerMax ?? null,
      penaltyStart: c.penaltyStart ?? null,
      penaltyMax: c.penaltyMax ?? null,
    };
    return Object.values(out).some((v) => v !== null) ? out : null;
  }

  // ---- Zusammenführen ----

  private mergeSettings(...layers: Array<Record<string, any> | null | undefined>): CompanionSettings {
    const out: CompanionSettings = { ...DEFAULT_SETTINGS };
    for (const layer of layers) {
      if (!layer) continue;
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof CompanionSettings>) {
        const v = (layer as any)[key];
        if (v !== null && v !== undefined && Number.isFinite(Number(v))) out[key] = Number(v);
      }
    }
    if (out.penaltyMax < out.penaltyStart) out.penaltyMax = out.penaltyStart;
    return out;
  }

  private mergeComments(...layers: Array<CompanionConfig | null | undefined>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const key of CATEGORY_KEYS) {
      const all = [...(DEFAULT_COMMENTS as any)[key]];
      for (const layer of layers) all.push(...((layer?.comments as any)?.[key] || []));
      out[key] = [...new Set(all)];
    }
    return out;
  }

  /**
   * Nextcloud-Freigaben liefern unter /download die Datei selbst. Andere
   * https-Links bleiben, wie sie sind.
   */
  playableSoundUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      const share = parseNextcloudShare(url);
      return `${share.base}/s/${share.token}/download`;
    } catch {
      return url;
    }
  }

  private async schoolOf(user: User | null): Promise<School | null> {
    if (!user?.schoolId) return null;
    return this.schoolRepo.findOne({ where: { id: user.schoolId } });
  }

  /**
   * Was beim Schüler ankommt: alle Kommentare, die Einstellungen nach allen
   * Stufen und der abspielbare Tusch (null = eingebaute Fanfare).
   */
  async effectiveFor(ownerId: string, link?: LinkCompanionSettings | null) {
    const owner = await this.userRepo.findOne({ where: { id: ownerId } });
    const school = await this.schoolOf(owner);
    const schoolCfg: CompanionConfig | null = school?.companionConfig || null;
    const ownCfg: CompanionConfig | null = owner?.companionConfig || null;
    return {
      comments: this.mergeComments(schoolCfg, ownCfg),
      settings: this.mergeSettings(schoolCfg, ownCfg, link),
      soundUrl: this.playableSoundUrl(ownCfg?.soundUrl || schoolCfg?.soundUrl || null),
    };
  }

  // ---- Verwaltung ----

  /** Alles für die Seite "Lernbegleiter": Grundausstattung, Schule, eigene Ergänzungen. */
  async overview(reqUser: any) {
    const me = await this.userRepo.findOne({ where: { id: reqUser.userId } });
    if (!me) throw new NotFoundException('Konto nicht gefunden.');
    const school = await this.schoolOf(me);
    const schoolCfg: CompanionConfig | null = school?.companionConfig || null;
    const ownCfg: CompanionConfig | null = me.companionConfig || null;
    return {
      categories: COMPANION_CATEGORIES,
      defaults: { comments: DEFAULT_COMMENTS, settings: DEFAULT_SETTINGS },
      school: school ? { id: school.id, name: school.name, config: schoolCfg || {} } : null,
      mine: ownCfg || {},
      // Was ohne eigene Angabe gälte – für die Platzhalter im Formular.
      inherited: this.mergeSettings(schoolCfg),
      effective: await this.effectiveFor(me.id),
      isSchoolAdmin: !!reqUser.isSchoolAdmin && !!school,
    };
  }

  async saveMine(reqUser: any, body: any) {
    const me = await this.userRepo.findOne({ where: { id: reqUser.userId } });
    if (!me) throw new NotFoundException('Konto nicht gefunden.');
    me.companionConfig = this.cleanConfig(body);
    await this.userRepo.save(me);
    return this.overview(reqUser);
  }

  private async ownSchoolAsAdmin(reqUser: any): Promise<School> {
    if (!reqUser.isSchoolAdmin || !reqUser.schoolId) {
      throw new ForbiddenException('Die Vorgaben der Schule pflegt der Schuladmin.');
    }
    const school = await this.schoolRepo.findOne({ where: { id: reqUser.schoolId } });
    if (!school) throw new NotFoundException('Schule nicht gefunden.');
    return school;
  }

  async saveSchool(reqUser: any, body: any) {
    const school = await this.ownSchoolAsAdmin(reqUser);
    school.companionConfig = this.cleanConfig(body);
    await this.schoolRepo.save(school);
    return this.overview(reqUser);
  }

  /**
   * Ergänzungen der Kolleginnen und Kollegen, damit der Schuladmin gute
   * Kommentare für die ganze Schule übernehmen kann. Nur Kommentare, die
   * nicht schon zur Grundausstattung oder zur Schule gehören.
   */
  async colleagues(reqUser: any) {
    const school = await this.ownSchoolAsAdmin(reqUser);
    const schoolCfg: CompanionConfig = school.companionConfig || {};
    const known = this.mergeComments(schoolCfg);
    const teachers = await this.userRepo.find({ where: { schoolId: school.id } });
    const out: Array<{ id: string; name: string; comments: Record<string, string[]> }> = [];
    for (const t of teachers) {
      const own = (t.companionConfig as CompanionConfig | null)?.comments || {};
      const fresh: Record<string, string[]> = {};
      for (const key of CATEGORY_KEYS) {
        const list = ((own as any)[key] || []).filter((c: string) => !known[key].includes(c));
        if (list.length) fresh[key] = list;
      }
      if (Object.keys(fresh).length) out.push({ id: t.id, name: t.displayName || t.email, comments: fresh });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return out;
  }
}
