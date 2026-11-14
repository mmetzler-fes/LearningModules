import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ShortLink } from '../core/entities/short-link.entity';
import { renderQr } from '../core/share/link-url';

/** Ohne Verwechsler (0/o, 1/l/i) – der Code wird auch abgetippt. */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const CODE_LENGTH = 6;
/** Grenze gegen Missbrauch als Datenablage; LibreSpice-Schaltungen bleiben weit darunter. */
export const MAX_URL_LENGTH = 32000;
export const CODE_PATTERN = /^[a-z0-9]{4,16}$/;

export function newCode(length = CODE_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/** Ziel prüfen: nur http(s), nicht auf einen anderen Kurzlink dieses Servers (Schleife). */
export function checkTarget(raw: unknown, base: string): string {
  const url = String(raw ?? '').trim();
  if (!url) throw new BadRequestException('Bitte die lange Adresse angeben.');
  if (url.length > MAX_URL_LENGTH) throw new BadRequestException(`Die Adresse ist zu lang (höchstens ${MAX_URL_LENGTH} Zeichen).`);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new BadRequestException('Das ist keine gültige Adresse (sie beginnt mit https://).'); }
  if (!/^https?:$/.test(parsed.protocol)) throw new BadRequestException('Nur Adressen mit http:// oder https:// sind möglich.');
  try {
    const own = new URL(base);
    if (parsed.host === own.host && /^\/k\//.test(parsed.pathname)) throw new BadRequestException('Das ist schon ein Kurzlink.');
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
  }
  return url;
}

const cleanTitle = (t: unknown) => (String(t ?? '').trim().slice(0, 200) || null);

@Injectable()
export class ShortLinksService {
  constructor(@InjectRepository(ShortLink) private readonly repo: Repository<ShortLink>) {}

  private view(l: ShortLink, base: string) {
    return {
      id: l.id, code: l.code, url: l.url, title: l.title, hits: l.hits,
      lastUsedAt: l.lastUsedAt, createdAt: l.createdAt, short: `${base}/k/${l.code}`,
    };
  }

  async list(ownerId: string, base: string) {
    const rows = await this.repo.find({ where: { ownerId }, order: { createdAt: 'DESC' } });
    return rows.map((l) => this.view(l, base));
  }

  /** Neuer Kurzlink; dieselbe Adresse derselben Lehrkraft bekommt den vorhandenen. */
  async create(ownerId: string, body: { url?: string; title?: string }, base: string) {
    const url = checkTarget(body?.url, base);
    const title = cleanTitle(body?.title);
    let link = await this.repo.findOne({ where: { ownerId, url } });
    if (link) {
      if (title && title !== link.title) { link.title = title; link = await this.repo.save(link); }
      return this.withQr(this.view(link, base), true);
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = newCode(attempt < 5 ? CODE_LENGTH : CODE_LENGTH + 2);
      if (await this.repo.findOne({ where: { code } })) continue;
      link = await this.repo.save(this.repo.create({ id: crypto.randomUUID(), code, ownerId, url, title, hits: 0, lastUsedAt: null }));
      return this.withQr(this.view(link, base), false);
    }
    throw new BadRequestException('Kein freier Code gefunden – bitte noch einmal versuchen.');
  }

  /** Ziel oder Bezeichnung ändern – der Kurzlink bleibt derselbe. */
  async update(ownerId: string, id: string, body: { url?: string; title?: string }, base: string) {
    const link = await this.own(ownerId, id);
    if (body?.url !== undefined) link.url = checkTarget(body.url, base);
    if (body?.title !== undefined) link.title = cleanTitle(body.title);
    return this.view(await this.repo.save(link), base);
  }

  async qr(ownerId: string, id: string, base: string) {
    return this.withQr(this.view(await this.own(ownerId, id), base), true);
  }

  async remove(ownerId: string, id: string) {
    await this.repo.delete({ id: (await this.own(ownerId, id)).id });
    return { success: true };
  }

  /** Für die Weiterleitung: Ziel zum Code, zählt den Aufruf. */
  async resolve(code: string): Promise<string | null> {
    const c = String(code || '').toLowerCase();
    if (!CODE_PATTERN.test(c)) return null;
    const link = await this.repo.findOne({ where: { code: c } });
    if (!link) return null;
    await this.repo.update({ id: link.id }, { hits: () => 'hits + 1', lastUsedAt: new Date() });
    return link.url;
  }

  private async own(ownerId: string, id: string) {
    const link = await this.repo.findOne({ where: { id, ownerId } });
    if (!link) throw new NotFoundException('Kurzlink nicht gefunden.');
    return link;
  }

  private async withQr<T extends { short: string }>(v: T, existing: boolean) {
    return { ...v, existing, qr: await renderQr(v.short) };
  }
}
