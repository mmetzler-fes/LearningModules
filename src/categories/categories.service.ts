import { Injectable, Logger, OnApplicationBootstrap, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Category, CategoryFacet } from '../core/entities/category.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Tag } from '../core/entities/tag.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { subtreeIds } from '../notebooks/notebook-rules';
import {
  cannotAddUnder, cleanIds, cleanLabel, effectiveOf, seedRows, selectable, siblingWithLabel, VocabFiles,
} from './category-rules';

/**
 * Kategorien: Fach (bis 3 Ebenen) und Bildungsstufe (bis 2), einheitlich für
 * alle (docs/kategorien.md).
 *
 * Ebene 1 kommt aus den OpenEduHub-Vokabularen, darunter eine gemeinsame
 * Ergänzung, beides mit der App ausgeliefert (src/categories/vocab) und bei
 * jedem Start übernommen. Lehrkräfte schlagen weitere Unterbegriffe vor und
 * können sie sofort selbst nutzen; der Admin bestätigt, benennt um, führt
 * zusammen oder blendet aus.
 */
@Injectable()
export class CategoriesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CategoriesService.name);
  private cache: Category[] | null = null;

  constructor(
    @InjectRepository(Category) private readonly repo: Repository<Category>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(Tag) private readonly tagRepo: Repository<Tag>,
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
  ) {}

  // ---- Ausgelieferte Listen übernehmen ----

  async onApplicationBootstrap() {
    try {
      const n = await this.seed();
      if (n) this.logger.log(`Kategorien: ${n} aus den ausgelieferten Listen übernommen`);
    } catch (err) {
      this.logger.error(`Kategorien nicht übernommen: ${(err as Error).message}`);
    }
  }

  private readVocab(): VocabFiles {
    const dir = path.join(__dirname, 'vocab');
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { discipline: read('oeh-discipline.json'), context: read('oeh-educational-context.json'), shared: read('lm-shared.json') };
  }

  /**
   * Neue Einträge anlegen, bestehende angleichen (Name, Oberbegriff,
   * Reihenfolge). Den Status behält der Server – was der Admin ausgeblendet
   * hat, bleibt ausgeblendet. Liefert die Zahl der Änderungen.
   */
  async seed(): Promise<number> {
    const rows = seedRows(this.readVocab());
    const existing = new Map((await this.repo.find()).map((c) => [c.id, c]));
    const changed: Category[] = [];
    for (const r of rows) {
      const c = existing.get(r.id);
      if (!c) {
        changed.push(this.repo.create({ id: r.id, facet: r.facet, parentId: r.parentId, label: r.label, source: r.source, uri: r.uri, orderIndex: r.orderIndex, status: r.retired ? 'hidden' : 'active' }));
        continue;
      }
      const next = { facet: r.facet, parentId: r.parentId, label: r.label, source: r.source, uri: r.uri, orderIndex: r.orderIndex };
      const differs = (Object.keys(next) as Array<keyof typeof next>).some((k) => (c as any)[k] !== next[k]);
      if (differs || (r.retired && c.status !== 'hidden')) {
        Object.assign(c, next);
        if (r.retired) c.status = 'hidden';
        changed.push(c);
      }
    }
    for (let i = 0; i < changed.length; i += 200) await this.repo.save(changed.slice(i, i + 200));
    this.cache = null;
    return changed.length;
  }

  // ---- Lesen ----

  async all(): Promise<Category[]> {
    if (!this.cache) this.cache = await this.repo.find({ order: { orderIndex: 'ASC', label: 'ASC' } });
    return this.cache;
  }

  async byId(): Promise<Map<string, Category>> {
    return new Map((await this.all()).map((c) => [c.id, c]));
  }

  /**
   * Was eine Lehrkraft sieht: alle aktiven, ihre eigenen Vorschläge, und
   * – damit Zuordnungen lesbar bleiben – ausgeblendete und fremde Vorschläge
   * als nicht wählbar. Admins sehen dazu, wer was vorgeschlagen hat.
   */
  async listFor(user: any) {
    const isAdmin = user?.role === 'admin';
    return (await this.all()).map((c) => ({
      id: c.id,
      facet: c.facet,
      parentId: c.parentId,
      label: c.label,
      source: c.source,
      status: c.status,
      mine: c.status === 'proposed' && c.proposedBy === user.userId,
      selectable: selectable(c, user.userId),
      ...(isAdmin ? { proposedBy: c.proposedBy, uri: c.uri } : {}),
    }));
  }

  /** Auswahl eines Benutzers bereinigen (siehe cleanIds). */
  async clean(input: unknown, user: any, previous: string[] | null = null): Promise<string[] | null> {
    const ids = cleanIds(input, await this.byId(), user.userId, previous);
    return ids.length ? ids : null;
  }

  /** Tag → seine Kategorien, für die Tags dieser Lernthemen. */
  async tagCategories(topics: Array<{ tagIds?: string[] | null }>): Promise<Map<string, string[]>> {
    const ids = [...new Set(topics.flatMap((t) => t.tagIds || []))];
    if (!ids.length) return new Map();
    const tags = await this.tagRepo.find({ where: { id: In(ids) }, select: ['id', 'categoryIds'] });
    return new Map(tags.filter((t) => t.categoryIds?.length).map((t) => [t.id, t.categoryIds as string[]]));
  }

  /** Kategorien je Lernthema: eigene und die seiner Tags. */
  async effectiveFor(topics: Array<{ id: string; categoryIds?: string[] | null; tagIds?: string[] | null }>): Promise<Map<string, string[]>> {
    const tagCats = await this.tagCategories(topics);
    return new Map(topics.map((t) => [t.id, effectiveOf(t.categoryIds, t.tagIds, tagCats)]));
  }

  // ---- Vorschlagen und Pflegen ----

  /**
   * Neuer Unterbegriff. Von einer Lehrkraft: ein Vorschlag, den sie sofort
   * verwenden kann. Vom Admin: gleich für alle. Gibt es unter demselben
   * Oberbegriff schon einen gleichnamigen, kommt dieser zurück.
   */
  async propose(user: any, body: any) {
    const label = cleanLabel(body?.label);
    if (!label) throw new BadRequestException('Bitte einen Namen mit höchstens 60 Zeichen.');
    const all = await this.all();
    const byId = new Map(all.map((c) => [c.id, c]));
    const isAdmin = user?.role === 'admin';
    const parentId = body?.parentId ? String(body.parentId) : null;

    let facet: CategoryFacet;
    if (parentId) {
      const parent = byId.get(parentId);
      if (parent && !isAdmin && !selectable(parent, user.userId)) throw new NotFoundException('Oberbegriff nicht gefunden.');
      const why = cannotAddUnder(parent, byId);
      if (why) throw new BadRequestException(why);
      facet = parent!.facet;
    } else {
      // Eine neue oberste Ebene legt nur der Admin an – sonst zerfiele die gemeinsame Einordnung.
      if (!isAdmin) throw new ForbiddenException('Neue Fächer oder Stufen der obersten Ebene legt der Admin an. Bitte einen Oberbegriff wählen.');
      facet = body?.facet === 'stage' ? 'stage' : 'subject';
    }

    const twin = siblingWithLabel(parentId as string, label, all.filter((c) => c.facet === facet));
    if (twin && (twin.status === 'active' || twin.proposedBy === user.userId || isAdmin)) {
      return { success: true, existing: true, category: twin };
    }

    const siblings = all.filter((c) => c.parentId === parentId && c.facet === facet);
    const category = await this.repo.save(this.repo.create({
      id: `local:${crypto.randomUUID()}`,
      facet,
      parentId,
      label,
      source: 'local',
      uri: null,
      status: isAdmin ? 'active' : 'proposed',
      proposedBy: isAdmin ? null : user.userId,
      orderIndex: siblings.reduce((n, c) => Math.max(n, c.orderIndex), -1) + 1,
    }));
    this.cache = null;
    return { success: true, category };
  }

  private requireAdmin(user: any) {
    if (user?.role !== 'admin') throw new ForbiddenException('Nur für Admins.');
  }

  private async get(id: string): Promise<Category> {
    const c = (await this.byId()).get(id);
    if (!c) throw new NotFoundException('Kategorie nicht gefunden.');
    return c;
  }

  /** Umbenennen (nur hier ergänzte) und Status: `{ label?, status?: 'active' | 'hidden' }`. */
  async update(id: string, user: any, body: any) {
    this.requireAdmin(user);
    const c = await this.get(id);
    if (body?.label !== undefined) {
      if (c.source !== 'local') throw new BadRequestException('Ausgelieferte Kategorien behalten ihren Namen, damit sie auf allen Servern gleich sind – ausblenden geht.');
      const label = cleanLabel(body.label);
      if (!label) throw new BadRequestException('Bitte einen Namen mit höchstens 60 Zeichen.');
      c.label = label;
    }
    if (body?.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'hidden') throw new BadRequestException('Unbekannter Status.');
      c.status = body.status;
      if (c.status === 'active') c.proposedBy = null;
    }
    await this.repo.save(c);
    this.cache = null;
    return { success: true, category: c };
  }

  /**
   * Vorschlag ablehnen bzw. eigene Ergänzung löschen: Was damit eingeordnet
   * war, gilt danach als eingeordnet unter dem Oberbegriff.
   */
  async remove(id: string, user: any) {
    const c = await this.get(id);
    const own = c.status === 'proposed' && c.proposedBy === user.userId;
    if (!own) this.requireAdmin(user);
    if (c.source !== 'local') throw new BadRequestException('Ausgelieferte Kategorien lassen sich nur ausblenden.');
    const kids = (await this.all()).filter((x) => x.parentId === c.id);
    if (kids.length) throw new BadRequestException('Darunter gibt es noch Begriffe – bitte erst diese zusammenführen oder löschen.');
    const moved = await this.reassign(c.id, c.parentId);
    await this.repo.delete({ id: c.id });
    this.cache = null;
    return { success: true, moved };
  }

  /** `id` in `into` aufgehen lassen: Zuordnungen wandern, `id` verschwindet (ausgelieferte: ausgeblendet). */
  async merge(id: string, user: any, intoId: string) {
    this.requireAdmin(user);
    const c = await this.get(id);
    const into = await this.get(String(intoId || ''));
    if (c.id === into.id) throw new BadRequestException('Bitte eine andere Kategorie wählen.');
    if (c.facet !== into.facet) throw new BadRequestException('Fach und Bildungsstufe lassen sich nicht zusammenführen.');
    const all = await this.all();
    if (all.some((x) => x.parentId === c.id)) throw new BadRequestException('Darunter gibt es noch Begriffe – bitte erst diese zusammenführen.');
    const moved = await this.reassign(c.id, into.id);
    if (c.source === 'local') await this.repo.delete({ id: c.id });
    else await this.repo.save(Object.assign(c, { status: 'hidden' }));
    this.cache = null;
    return { success: true, moved };
  }

  /** Überall, wo `from` zugeordnet ist, stattdessen `to` (oder nichts). */
  private async reassign(from: string, to: string | null): Promise<number> {
    const swap = (ids: string[] | null) => {
      const next = [...new Set((ids || []).map((x) => (x === from ? to : x)).filter(Boolean) as string[])];
      return next.length ? next : null;
    };
    let n = 0;
    const pattern = Like(`%"${from.replace(/[%_]/g, '')}"%`);
    for (const repo of [this.topicRepo, this.tagRepo, this.offerRepo] as Repository<any>[]) {
      const rows = (await repo.find({ where: { categoryIds: pattern } })).filter((r: any) => (r.categoryIds || []).includes(from));
      for (const r of rows) r.categoryIds = swap(r.categoryIds);
      if (rows.length) await repo.save(rows);
      n += rows.length;
    }
    return n;
  }

  // ---- Einordnen ----

  /**
   * Alle eigenen Lernthemen in einem Book, Bereich oder Abschnitt einordnen.
   * `mode` add: Kategorien dazunehmen, remove: wegnehmen.
   */
  async applyToNode(nodeId: string, user: any, body: any) {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId } });
    if (!node || node.ownerId !== user.userId) throw new NotFoundException('Book, Bereich oder Abschnitt nicht gefunden.');
    const mode = body?.mode === 'remove' ? 'remove' : 'add';
    const ids = mode === 'add' ? (await this.clean(body?.categoryIds, user)) || [] : (Array.isArray(body?.categoryIds) ? body.categoryIds.map(String) : []);
    if (!ids.length) throw new BadRequestException('Bitte mindestens eine Kategorie wählen.');
    const [nodes, places] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: user.userId } }),
      this.placeRepo.find({ where: { ownerId: user.userId } }),
    ]);
    const inside = subtreeIds(nodes, node.id);
    const topicIds = places.filter((p) => p.nodeId && inside.has(p.nodeId)).map((p) => p.topicId);
    const topics = topicIds.length ? await this.topicRepo.find({ where: { id: In(topicIds), ownerId: user.userId } }) : [];
    for (const t of topics) {
      const cur = new Set(t.categoryIds || []);
      for (const id of ids) mode === 'add' ? cur.add(id) : cur.delete(id);
      t.categoryIds = cur.size ? [...cur] : null;
    }
    if (topics.length) await this.topicRepo.save(topics);
    return { success: true, topics: topics.length };
  }

  /** Für die Admin-Übersicht: wie oft jede Kategorie direkt zugeordnet ist. */
  async usage(user: any): Promise<Record<string, number>> {
    this.requireAdmin(user);
    const out: Record<string, number> = {};
    for (const repo of [this.topicRepo, this.tagRepo, this.offerRepo] as Repository<any>[]) {
      const rows = await repo.find({ select: ['id', 'categoryIds'] as any });
      for (const r of rows) for (const id of r.categoryIds || []) out[id] = (out[id] || 0) + 1;
    }
    return out;
  }

}
