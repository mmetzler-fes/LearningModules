import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { PlantTemplate } from '../core/entities/plant-template.entity';
import { User } from '../core/entities/user.entity';

/** Größe einer Anlage samt Tabelle und Kette – reichlich für 200 Elemente. */
const MAX_JSON = 400_000;
const MAX_PER_OWNER = 200;

/** Bibliothek der Anlagen (SPS-Labor): eigene und von Kolleginnen und Kollegen geteilte. */
@Injectable()
export class PlantLibraryService {
  constructor(
    @InjectRepository(PlantTemplate) private readonly repo: Repository<PlantTemplate>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private async teacher(user: any): Promise<User> {
    const u = user?.userId ? await this.users.findOne({ where: { id: user.userId } }) : null;
    if (!u || (u.role !== 'teacher' && u.role !== 'admin')) throw new ForbiddenException('Nur für Lehrkräfte.');
    return u;
  }

  private static check(body: any) {
    const title = String(body?.title ?? '').trim().slice(0, 120);
    if (!title) throw new BadRequestException('Bitte einen Namen angeben.');
    const data = body?.data;
    if (!data || typeof data !== 'object' || !data.plant || !Array.isArray(data.plant.items)) throw new BadRequestException('data.plant fehlt.');
    if (JSON.stringify(data).length > MAX_JSON) throw new BadRequestException('Die Anlage ist zu groß.');
    return { title, description: String(body?.description ?? '').slice(0, 2000), data };
  }

  /** Eigene Anlagen und geteilte der anderen (mit Namen der Lehrkraft). */
  async list(user: any) {
    const me = await this.teacher(user);
    const rows = await this.repo.find({ where: [{ ownerId: me.id }, { shared: true }], order: { title: 'ASC' } });
    const owners = new Map<string, string>();
    for (const id of new Set(rows.filter((r) => r.ownerId !== me.id).map((r) => r.ownerId))) {
      const u = await this.users.findOne({ where: { id } });
      owners.set(id, u?.displayName || u?.email || 'Kollegin/Kollege');
    }
    return rows.map((r) => ({
      id: r.id, title: r.title, description: r.description, data: r.data, shared: r.shared, own: r.ownerId === me.id,
      owner: r.ownerId === me.id ? null : owners.get(r.ownerId) || null, updatedAt: r.updatedAt,
    }));
  }

  /** Neu ablegen oder (mit id, eigene) überschreiben. */
  async save(user: any, body: any) {
    const me = await this.teacher(user);
    const { title, description, data } = PlantLibraryService.check(body);
    if (body?.id) {
      const row = await this.repo.findOne({ where: { id: String(body.id) } });
      if (!row) throw new NotFoundException('Nicht gefunden.');
      if (row.ownerId !== me.id) throw new ForbiddenException('Nur eigene Anlagen lassen sich ändern.');
      Object.assign(row, { title, description, data, ...(typeof body.shared === 'boolean' ? { shared: body.shared } : {}) });
      await this.repo.save(row);
      return { success: true, id: row.id };
    }
    if ((await this.repo.count({ where: { ownerId: me.id } })) >= MAX_PER_OWNER) throw new BadRequestException('Die Bibliothek ist voll (200 Anlagen).');
    const row = this.repo.create({ id: crypto.randomUUID(), ownerId: me.id, title, description, data, shared: !!body?.shared });
    await this.repo.save(row);
    return { success: true, id: row.id };
  }

  /** Teilen ein/aus (nur eigene). */
  async share(user: any, id: string, shared: boolean) {
    const me = await this.teacher(user);
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Nicht gefunden.');
    if (row.ownerId !== me.id) throw new ForbiddenException('Nur eigene Anlagen lassen sich teilen.');
    row.shared = !!shared;
    await this.repo.save(row);
    return { success: true };
  }

  async remove(user: any, id: string) {
    const me = await this.teacher(user);
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Nicht gefunden.');
    if (row.ownerId !== me.id) throw new ForbiddenException('Nur eigene Anlagen lassen sich löschen.');
    await this.repo.remove(row);
    return { success: true };
  }
}
