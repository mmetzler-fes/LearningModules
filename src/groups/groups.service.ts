import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { User } from '../core/entities/user.entity';
import * as crypto from 'crypto';

/** Präfix, mit dem eine Gruppe in den Freigabelisten eines Themas steht. */
export const GROUP_PREFIX = 'group:';

/** Macht aus einer Gruppen-ID den Eintrag, wie er in sharedAccess steht. */
export const groupRef = (id: string) => `${GROUP_PREFIX}${id}`;

/** Die Gruppen-ID aus einem Eintrag, oder null bei einer Einzelperson. */
export const groupIdOf = (entry: string): string | null =>
  typeof entry === 'string' && entry.startsWith(GROUP_PREFIX)
    ? entry.slice(GROUP_PREFIX.length)
    : null;

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  // ---- Mitgliedschaft auflösen ----

  /**
   * Die Gruppen-IDs eines Benutzers.
   *
   * Wird einmal pro Anfrage geladen (in der JWT-Strategie) und danach nur
   * noch aus `user.groupIds` gelesen. Damit bleibt `accessLevel()` synchron
   * und ohne Datenbankzugriff – sonst bräuchte jede einzelne Zugriffsprüfung
   * eine eigene Abfrage.
   *
   * Bewusst nicht im Token: Eine Änderung der Besetzung muss sofort wirken,
   * nicht erst nach dem nächsten Login. Entzug, der erst morgen greift, wäre
   * kein Entzug.
   */
  async groupIdsFor(userId: string): Promise<string[]> {
    if (!userId) return [];
    const groups = await this.groupRepo.find();
    return groups
      .filter((g) => Array.isArray(g.memberIds) && g.memberIds.includes(userId))
      .map((g) => g.id);
  }

  /**
   * Ein Benutzerobjekt für Zugriffsprüfungen außerhalb einer Anfrage – etwa
   * für den Eigentümer eines Themen-Links, wenn ein Schüler startet. Dort
   * gibt es kein `req.user`, die Gruppen müssen aber trotzdem zählen.
   */
  async asUser(userId: string, role = 'teacher') {
    return { userId, role, groupIds: await this.groupIdsFor(userId) };
  }

  // ---- Verwaltung (nur Admin) ----

  async findAll() {
    const groups = await this.groupRepo.find();
    groups.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return groups.map((g) => ({ ...g, memberIds: g.memberIds || [] }));
  }

  async create(name: string, description?: string, memberIds?: string[]) {
    const clean = (name || '').trim();
    if (!clean) throw new BadRequestException('Die Gruppe braucht einen Namen, z. B. "Fachschaft Informatik".');
    await this.requireFreeName(clean);

    const group = this.groupRepo.create({
      id: crypto.randomUUID(),
      name: clean,
      description: (description || '').trim() || null,
      memberIds: await this.cleanMembers(memberIds),
    });
    return this.groupRepo.save(group);
  }

  async update(id: string, body: { name?: string; description?: string; memberIds?: string[] }) {
    const group = await this.groupRepo.findOne({ where: { id } });
    if (!group) throw new NotFoundException('Gruppe nicht gefunden.');

    if (body.name !== undefined) {
      const clean = String(body.name).trim();
      if (!clean) throw new BadRequestException('Die Gruppe braucht einen Namen.');
      if (clean.toLowerCase() !== group.name.toLowerCase()) await this.requireFreeName(clean);
      group.name = clean;
    }
    if (body.description !== undefined) group.description = String(body.description).trim() || null;
    if (body.memberIds !== undefined) group.memberIds = await this.cleanMembers(body.memberIds);

    return this.groupRepo.save(group);
  }

  /**
   * Löscht die Gruppe. Die Freigaben, die auf sie zeigen, räumt der Aufrufer
   * auf – hier fehlt der Zugriff auf die Themen, und ein Verweis ins Leere
   * wäre in `accessLevel()` zwar harmlos (niemand ist Mitglied), stünde aber
   * für immer als toter Eintrag in der Liste.
   */
  async remove(id: string) {
    const group = await this.groupRepo.findOne({ where: { id } });
    if (!group) throw new NotFoundException('Gruppe nicht gefunden.');
    await this.groupRepo.remove(group);
    return { success: true };
  }

  /** Nur vorhandene Lehrkräfte und Admins, ohne Doppelungen. */
  private async cleanMembers(memberIds?: string[]): Promise<string[]> {
    const wanted = Array.isArray(memberIds) ? [...new Set(memberIds.map(String).filter(Boolean))] : [];
    if (wanted.length === 0) return [];
    const users = await this.userRepo.find();
    const valid = new Set(users.filter((u) => u.role === 'teacher' || u.role === 'admin').map((u) => u.id));
    return wanted.filter((id) => valid.has(id));
  }

  private async requireFreeName(name: string) {
    const all = await this.groupRepo.find();
    if (all.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException(`Es gibt bereits eine Gruppe "${name}".`);
    }
  }
}
