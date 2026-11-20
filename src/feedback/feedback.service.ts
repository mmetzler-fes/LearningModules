import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Feedback } from '../core/entities/feedback.entity';
import { User } from '../core/entities/user.entity';

const MAX_TEXT = 5000;
const MAX_IMAGE = 8 * 1024 * 1024; // data:-Adresse
const PER_HOUR = 30;

/** 💬 Feedback: jeder darf melden (auch Schüler ohne Konto), lesen und ordnen nur der Admin. */
@Injectable()
export class FeedbackService {
  private readonly recent = new Map<string, number[]>();

  constructor(
    @InjectRepository(Feedback) private readonly repo: Repository<Feedback>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private limit(key: string) {
    const now = Date.now();
    const list = (this.recent.get(key) || []).filter((t) => now - t < 3600_000);
    if (list.length >= PER_HOUR) throw new BadRequestException('Zu viele Meldungen in kurzer Zeit – bitte später noch einmal.');
    list.push(now);
    this.recent.set(key, list);
  }

  async create(body: any, user: any, ip: string) {
    const text = String(body?.text || '').trim().slice(0, MAX_TEXT);
    let image = typeof body?.image === 'string' && body.image ? body.image : null;
    if (!text && !image) throw new BadRequestException('Bitte beschreiben, was passiert ist.');
    if (image && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE)) {
      throw new BadRequestException('Das Bild ist zu groß oder kein PNG/JPEG.');
    }
    this.limit(user?.userId || ip || 'anon');
    const u = user?.userId ? await this.users.findOne({ where: { id: user.userId } }) : null;
    const who = String(body?.reporter || '').trim().slice(0, 120);
    const reporter = u ? `${u.displayName || u.email} (${u.role === 'admin' ? 'Admin' : 'Lehrkraft'})` : who ? `${who} (Schüler)` : 'Gast';
    const ctx = body?.context && typeof body.context === 'object' ? body.context : {};
    const context = JSON.parse(JSON.stringify(ctx, (_k, v) => (typeof v === 'string' ? v.slice(0, 500) : v)).slice(0, 4000) || '{}');
    const row = await this.repo.save(this.repo.create({
      id: crypto.randomUUID(), text, image, context, userId: u?.id || null, reporter, priority: 0, status: 'open', adminNote: null,
    }));
    return { success: true, id: row.id };
  }

  private async admin(user: any) {
    if (user?.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  async list(user: any) {
    await this.admin(user);
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    return rows
      .map(({ image, ...r }) => ({ ...r, hasImage: !!image }))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || b.priority - a.priority);
  }

  async image(user: any, id: string) {
    await this.admin(user);
    const row = await this.repo.findOne({ where: { id } });
    const m = row?.image ? /^data:(image\/[a-z]+);base64,(.*)$/.exec(row.image) : null;
    if (!m) throw new NotFoundException('Kein Bild.');
    return { type: m[1], data: Buffer.from(m[2], 'base64') };
  }

  async update(user: any, id: string, body: any) {
    await this.admin(user);
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Meldung nicht gefunden.');
    if (body?.priority !== undefined) row.priority = Math.max(0, Math.min(3, Math.round(Number(body.priority) || 0)));
    if (body?.status !== undefined) row.status = body.status === 'done' ? 'done' : 'open';
    if (body?.adminNote !== undefined) row.adminNote = String(body.adminNote || '').slice(0, 2000) || null;
    await this.repo.save(row);
    return { success: true };
  }

  async remove(user: any, id: string) {
    await this.admin(user);
    await this.repo.delete({ id });
    return { success: true };
  }
}
