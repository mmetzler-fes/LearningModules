import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WorksheetTemplate } from '../core/entities/worksheet-template.entity';
import { User } from '../core/entities/user.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { WorksheetRendererClient } from './renderer.client';
import { settingsAt } from './numbering';

export type TemplateKind = 'arbeitsblatt' | 'klassenarbeit';
const KINDS: TemplateKind[] = ['arbeitsblatt', 'klassenarbeit'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_NAME = 80;

/** Art der Vorlage zu einem Dokument: Klassenarbeiten eigene, sonst die des Arbeitsblatts. */
export function templateKindOf(docKind: string | undefined): TemplateKind {
  return docKind === 'klassenarbeit' ? 'klassenarbeit' : 'arbeitsblatt';
}

/**
 * Vorlagen für den Druck: eigene der Lehrkraft und die der Schule. Welche
 * gilt: am Ordner gewählt (vererbt) → eigener Standard → Schulstandard →
 * Grundvorlage des Renderers (null).
 */
@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(WorksheetTemplate) private readonly repo: Repository<WorksheetTemplate>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    private readonly renderer: WorksheetRendererClient,
  ) {}

  private async userOf(userId: string) {
    const u = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'schoolId', 'isSchoolAdmin', 'role'] });
    if (!u) throw new NotFoundException('Konto nicht gefunden.');
    return { ...u, mayManageSchool: !!u.schoolId && (!!u.isSchoolAdmin || u.role === 'admin') };
  }

  /** Eigene und Schulvorlagen, ohne die Dateien selbst. */
  async list(userId: string) {
    const u = await this.userOf(userId);
    const rows = await this.repo.find({
      where: [{ ownerId: userId }, ...(u.schoolId ? [{ schoolId: u.schoolId }] : [])],
      select: ['id', 'ownerId', 'schoolId', 'name', 'kind', 'size', 'isDefault', 'inspect', 'updatedAt'],
      order: { name: 'ASC' },
    });
    return {
      mayManageSchool: u.mayManageSchool,
      templates: rows.map((t) => ({
        id: t.id, name: t.name, kind: t.kind, scope: t.ownerId ? 'own' : 'school', isDefault: t.isDefault, size: t.size,
        updatedAt: t.updatedAt, hasTitle: !!t.inspect?.hasTitle, hasContent: !!t.inspect?.hasContent,
      })),
    };
  }

  async upload(userId: string, input: { name?: string; kind?: string; scope?: string; buffer?: Buffer }) {
    const u = await this.userOf(userId);
    const kind = KINDS.includes(input.kind as TemplateKind) ? (input.kind as TemplateKind) : null;
    if (!kind) throw new BadRequestException('Art: arbeitsblatt oder klassenarbeit.');
    if (!input.buffer?.length) throw new BadRequestException('Keine Datei empfangen.');
    if (input.buffer.length > MAX_BYTES) throw new BadRequestException('Die Vorlage ist größer als 5 MB.');
    const school = input.scope === 'school';
    if (school && !u.mayManageSchool) throw new ForbiddenException('Schulvorlagen legt der Schuladmin an.');
    const data = input.buffer.toString('base64');
    const inspect = await this.renderer.inspect(data);
    const name = String(input.name || '').trim().slice(0, MAX_NAME) || (kind === 'klassenarbeit' ? 'Klassenarbeit' : 'Arbeitsblatt');
    const row = await this.repo.save(this.repo.create({
      id: crypto.randomUUID(), ownerId: school ? null : userId, schoolId: school ? u.schoolId : null,
      name, kind, data, size: input.buffer.length, isDefault: false, inspect,
    }));
    const warnings: string[] = [];
    if (!inspect.hasTitle) warnings.push('Kein {{TITEL}} gefunden – die Kopfzeile bleibt ohne Titel.');
    if (!inspect.hasContent) warnings.push('Kein Absatz {{INHALT}} – der Inhalt kommt ans Ende der Vorlage.');
    return { success: true, id: row.id, warnings };
  }

  private async writable(userId: string, id: string) {
    const u = await this.userOf(userId);
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Vorlage nicht gefunden.');
    if (t.ownerId ? t.ownerId !== userId : !(u.mayManageSchool && t.schoolId === u.schoolId)) {
      throw new ForbiddenException('Diese Vorlage kannst du nicht ändern.');
    }
    return t;
  }

  /** Standard für ihre Art in ihrem Bereich (eigene bzw. Schule) – oder wieder aufheben. */
  async setDefault(userId: string, id: string, on: boolean) {
    const t = await this.writable(userId, id);
    if (on) {
      const others = await this.repo.find({ where: t.ownerId ? { ownerId: t.ownerId, kind: t.kind } : { schoolId: t.schoolId!, kind: t.kind } });
      for (const o of others) o.isDefault = o.id === t.id;
      await this.repo.save(others);
    } else {
      t.isDefault = false;
      await this.repo.save(t);
    }
    return { success: true };
  }

  async remove(userId: string, id: string) {
    await this.repo.remove(await this.writable(userId, id));
    return { success: true };
  }

  /** Vorlage zum Lesen (eigene oder der eigenen Schule). */
  async readable(userId: string, id: string) {
    const u = await this.userOf(userId);
    const t = await this.repo.findOne({ where: { id } });
    if (!t || !(t.ownerId === userId || (t.schoolId && t.schoolId === u.schoolId))) throw new NotFoundException('Vorlage nicht gefunden.');
    return t;
  }

  /**
   * Welche Vorlage gilt für ein Dokument dieser Art in diesem Ordner?
   * null = Grundvorlage des Renderers.
   */
  async resolve(userId: string, nodeId: string | null, kind: TemplateKind, nodes?: NotebookNode[]): Promise<WorksheetTemplate | null> {
    const u = await this.userOf(userId);
    const all = nodes || await this.nodeRepo.find({ where: { ownerId: userId } });
    const chosen = settingsAt(all, nodeId).templates?.[kind];
    const candidates = await this.repo.find({ where: [{ ownerId: userId, kind }, ...(u.schoolId ? [{ schoolId: u.schoolId, kind }] : [])] });
    if (chosen) {
      const hit = candidates.find((t) => t.id === chosen);
      if (hit) return hit;
    }
    return candidates.find((t) => t.ownerId === userId && t.isDefault)
      || candidates.find((t) => !t.ownerId && t.isDefault)
      || null;
  }

  /** Mehrere auf einmal (Nextcloud-Abbild): je Ordner und Art zwischengespeichert. */
  resolver(userId: string, nodes: NotebookNode[]) {
    const cache = new Map<string, Promise<WorksheetTemplate | null>>();
    return (nodeId: string | null, kind: TemplateKind) => {
      const key = `${nodeId}|${kind}`;
      if (!cache.has(key)) cache.set(key, this.resolve(userId, nodeId, kind, nodes));
      return cache.get(key)!;
    };
  }

  async byIds(ids: string[]) {
    return ids.length ? this.repo.find({ where: { id: In(ids) } }) : [];
  }
}
