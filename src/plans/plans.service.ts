import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { PlanNode } from '../core/entities/plan-node.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { NotebooksService } from '../notebooks/notebooks.service';
import { reorder } from '../classbook/classbook-tree';
import {
  PLAN_KINDS, PlanKind, canHoldTopic, expandPlan, includeError, placeError, planMoveError, planOf, planSubtree, plansIncluding,
} from './plan-rules';

type AddItem = { type?: string; id?: string };

/**
 * Planungsebene (docs/planung.md): Pläne je Bildungsgang und Beruf, in Ordnern,
 * mit Bereichen, Abschnitten, Teilplänen und Verweisen auf Lernthemen des
 * Notizbuchs. Aus dem Notizbuch übernommene Bereiche wachsen mit.
 */
@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(PlanNode) private readonly nodeRepo: Repository<PlanNode>,
    @InjectRepository(PlanEntry) private readonly entryRepo: Repository<PlanEntry>,
    @InjectRepository(NotebookNode) private readonly nbNodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly nbPlaceRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    private readonly notebooks: NotebooksService,
  ) {}

  private nodesOf(user: any) {
    return this.nodeRepo.find({ where: { ownerId: user.userId } });
  }

  private entriesOf(user: any) {
    return this.entryRepo.find({ where: { ownerId: user.userId } });
  }

  private cleanTitle(raw: unknown, fallback = 'Neu'): string {
    const t = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return t || fallback;
  }

  private async ownNode(id: unknown, user: any): Promise<PlanNode> {
    const node = id ? await this.nodeRepo.findOne({ where: { id: String(id) } }) : null;
    if (!node || node.ownerId !== user.userId) throw new NotFoundException('Eintrag nicht gefunden.');
    return node;
  }

  // ---- Lesen ----

  /** Alle Ordner, Pläne und Einträge mit Titeln der Lernthemen und „verwendet in …“ der Teilpläne. */
  async tree(user: any) {
    await this.grow(user);
    const [nodes, entries] = await Promise.all([this.nodesOf(user), this.entriesOf(user)]);
    const topicIds = [...new Set(entries.map((e) => e.topicId))];
    const topics = topicIds.length ? await this.topicRepo.find({ where: { id: In(topicIds) } }) : [];
    const alive = new Set(topics.map((t) => t.id));
    // Im Notizbuch gelöschte Lernthemen verschwinden auch aus den Plänen.
    const gone = entries.filter((e) => !alive.has(e.topicId));
    for (const e of gone) await this.entryRepo.delete({ id: e.id });
    const usedIn: Record<string, Array<{ id: string; title: string }>> = {};
    for (const p of nodes.filter((n) => n.kind === 'plan')) {
      const by = plansIncluding(nodes, p.id).map((x) => ({ id: x.id, title: x.title || '' }));
      if (by.length) usedIn[p.id] = by;
    }
    return {
      nodes: nodes.map(({ id, kind, title, parentId, orderIndex, refId, sourceNodeId }) => ({ id, kind, title, parentId, orderIndex, refId: refId || null, grows: !!sourceNodeId })),
      entries: entries.filter((e) => alive.has(e.topicId)).map(({ id, nodeId, topicId, orderIndex }) => ({ id, nodeId, topicId, orderIndex })),
      topics: topics.map((t) => ({ id: t.id, title: t.title, isOwn: t.ownerId === user.userId })),
      usedIn,
    };
  }

  /** Ausgerollter Plan, wie eine Klasse ihn bekommt (Teilpläne eingesetzt, jedes Lernthema einmal). */
  async expanded(user: any, planId: string) {
    const plan = await this.ownNode(planId, user);
    if (plan.kind !== 'plan') throw new BadRequestException('Das ist kein Plan.');
    return { plan: { id: plan.id, title: plan.title }, items: expandPlan(await this.nodesOf(user), await this.entriesOf(user), plan.id) };
  }

  // ---- Knoten ----

  /** `{ kind, title, parentId, refId? }` – bei `include` ist `refId` der eingebundene Plan. */
  async createNode(user: any, body: { kind?: string; title?: string; parentId?: string | null; refId?: string; index?: number | null }) {
    const kind = String(body?.kind || '') as PlanKind;
    if (!PLAN_KINDS.includes(kind)) throw new BadRequestException('Unbekannte Art.');
    const nodes = await this.nodesOf(user);
    const parentId = body?.parentId ? (await this.ownNode(body.parentId, user)).id : null;
    const why = placeError(nodes, kind, parentId);
    if (why) throw new BadRequestException(why);
    let title = this.cleanTitle(body?.title, kind === 'plan' ? 'Neuer Plan' : kind === 'folder' ? 'Neuer Ordner' : 'Neuer Bereich');
    let refId: string | null = null;
    if (kind === 'include') {
      const ref = await this.ownNode(body?.refId, user);
      if (ref.kind !== 'plan') throw new BadRequestException('Als Teilplan geht nur ein Plan.');
      const err = includeError(nodes, planOf(nodes, parentId)!.id, ref.id);
      if (err) throw new BadRequestException(err);
      refId = ref.id;
      title = body?.title ? title : ref.title;
    }
    const node = await this.nodeRepo.save(this.nodeRepo.create({
      id: crypto.randomUUID(), ownerId: user.userId, kind, title, parentId, orderIndex: 0, refId, sourceNodeId: null, seen: null,
    }));
    await this.placeNode(nodes, node, parentId, body?.index);
    return { id: node.id };
  }

  async renameNode(user: any, id: string, title: unknown) {
    const node = await this.ownNode(id, user);
    node.title = this.cleanTitle(title, node.title);
    await this.nodeRepo.save(node);
    return { success: true };
  }

  /**
   * Löschen. Ordner, Bereich, Abschnitt: Was darin liegt, rückt eine Ebene
   * höher. Plan: mit seinem Inhalt und überall, wo er als Teilplan steht.
   * Lernthemen bleiben im Notizbuch immer, wie sie sind.
   */
  async deleteNode(user: any, id: string) {
    const node = await this.ownNode(id, user);
    const nodes = await this.nodesOf(user);
    const entries = await this.entriesOf(user);
    if (node.kind === 'plan') {
      const usedIn = plansIncluding(nodes, node.id).map((p) => p.title || '');
      const inside = planSubtree(nodes, node.id);
      for (const n of nodes.filter((x) => inside.has(x.id) || (x.kind === 'include' && x.refId === node.id))) await this.nodeRepo.delete({ id: n.id });
      for (const e of entries.filter((x) => inside.has(x.nodeId))) await this.entryRepo.delete({ id: e.id });
      return { success: true, usedIn };
    }
    const up = node.parentId;
    const nodeBase = Math.max(-1, ...nodes.filter((n) => n.parentId === up && n.id !== node.id).map((n) => n.orderIndex)) + 1;
    const kids = nodes.filter((n) => n.parentId === node.id).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const [i, k] of kids.entries()) await this.nodeRepo.update({ id: k.id }, { parentId: up, orderIndex: nodeBase + i });
    const mine = entries.filter((e) => e.nodeId === node.id).sort((a, b) => a.orderIndex - b.orderIndex);
    if (mine.length) {
      // Lernthemen gehen nicht in einen Ordner: Dann verschwinden sie aus dem Plan (im Notizbuch bleiben sie).
      if (!up || !canHoldTopic(nodes.find((n) => n.id === up)?.kind ?? null)) {
        for (const e of mine) await this.entryRepo.delete({ id: e.id });
      } else {
        const have = new Set(entries.filter((e) => e.nodeId === up).map((e) => e.topicId));
        const base = Math.max(-1, ...entries.filter((e) => e.nodeId === up).map((e) => e.orderIndex)) + 1;
        let i = 0;
        for (const e of mine) {
          if (have.has(e.topicId)) await this.entryRepo.delete({ id: e.id });
          else await this.entryRepo.update({ id: e.id }, { nodeId: up, orderIndex: base + i++ });
        }
      }
    }
    await this.nodeRepo.delete({ id: node.id });
    return { success: true, usedIn: [] };
  }

  /** Knoten an `index` unter `parentId` einordnen, die Geschwister rücken nach. */
  private async placeNode(nodes: PlanNode[], node: PlanNode, parentId: string | null, index?: number | null) {
    const siblings = nodes.filter((n) => (n.parentId ?? null) === parentId && n.id !== node.id);
    const order = reorder([...siblings, { ...node, orderIndex: Number.MAX_SAFE_INTEGER }], node.id, index);
    for (const [id, orderIndex] of order) {
      if (id === node.id) await this.nodeRepo.update({ id }, { parentId, orderIndex });
      else if (siblings.find((s) => s.id === id)!.orderIndex !== orderIndex) await this.nodeRepo.update({ id }, { orderIndex });
    }
  }

  private async placeEntry(entries: PlanEntry[], entry: PlanEntry, nodeId: string, index?: number | null) {
    const siblings = entries.filter((e) => e.nodeId === nodeId && e.id !== entry.id);
    const order = reorder([...siblings, { ...entry, orderIndex: Number.MAX_SAFE_INTEGER }], entry.id, index);
    for (const [id, orderIndex] of order) {
      if (id === entry.id) await this.entryRepo.update({ id }, { nodeId, orderIndex });
      else if (siblings.find((s) => s.id === id)!.orderIndex !== orderIndex) await this.entryRepo.update({ id }, { orderIndex });
    }
  }

  /** Verschieben: `{ type: 'node'|'entry', id, parentId, index? }` (F6). */
  async move(user: any, body: { type?: string; id?: string; parentId?: string | null; index?: number | null }) {
    const nodes = await this.nodesOf(user);
    const parentId = body?.parentId ? (await this.ownNode(body.parentId, user)).id : null;
    if (body?.type === 'entry') {
      const entries = await this.entriesOf(user);
      const entry = entries.find((e) => e.id === String(body?.id || ''));
      if (!entry) throw new NotFoundException('Eintrag nicht gefunden.');
      const target = nodes.find((n) => n.id === parentId);
      if (!parentId || !canHoldTopic(target?.kind ?? null)) throw new BadRequestException('Lernthemen gehören in einen Plan, Bereich oder Abschnitt.');
      const plan = planOf(nodes, parentId)!;
      const inPlan = planSubtree(nodes, plan.id);
      if (entries.some((e) => e.id !== entry.id && e.topicId === entry.topicId && inPlan.has(e.nodeId))) {
        throw new BadRequestException('Dieses Lernthema steht in dem Plan schon.');
      }
      await this.placeEntry(entries, entry, parentId, body?.index);
      return { success: true };
    }
    const node = await this.ownNode(body?.id, user);
    const why = planMoveError(nodes, node.id, parentId);
    if (why) throw new BadRequestException(why);
    if (node.kind !== 'folder' && node.kind !== 'plan') {
      // Lernthemen kommen in einem Plan nur einmal vor: Doppelte bleiben am Ziel, wo sie sind.
      const entries = await this.entriesOf(user);
      const from = planOf(nodes, node.id)?.id;
      const to = planOf(nodes, parentId)!.id;
      if (from !== to) {
        const moving = planSubtree(nodes, node.id);
        const there = new Set(entries.filter((e) => planSubtree(nodes, to).has(e.nodeId)).map((e) => e.topicId));
        for (const e of entries.filter((x) => moving.has(x.nodeId) && there.has(x.topicId))) await this.entryRepo.delete({ id: e.id });
      }
    }
    await this.placeNode(nodes, node, parentId, body?.index);
    return { success: true };
  }

  async deleteEntry(user: any, id: string) {
    const entry = await this.entryRepo.findOne({ where: { id: String(id || '') } });
    if (!entry || entry.ownerId !== user.userId) throw new NotFoundException('Eintrag nicht gefunden.');
    await this.entryRepo.delete({ id: entry.id });
    return { success: true };
  }

  // ---- Hinzufügen (F5) ----

  /**
   * Verweise anlegen: `{ parentId, index?, items: [{ type: 'topic'|'nbnode'|'plan', id }] }`.
   * Lernthema → Verweis; Book, Bereich oder Abschnitt des Notizbuchs → derselbe
   * Baum (wächst mit); Plan → Teilplan. Liefert, was dazukam und was schon da war.
   */
  async add(user: any, body: { parentId?: string; index?: number | null; items?: AddItem[] }) {
    const parent = await this.ownNode(body?.parentId, user);
    const items = Array.isArray(body?.items) ? body!.items!.slice(0, 500) : [];
    if (!items.length) throw new BadRequestException('Nichts ausgewählt.');
    if (parent.kind === 'folder' && items.some((i) => i?.type !== 'plan')) {
      throw new BadRequestException('In einen Ordner kommen nur Pläne – bitte einen Plan wählen oder anlegen.');
    }
    let added = 0;
    const present: string[] = [];
    let index = body?.index ?? null;
    for (const item of items) {
      const id = String(item?.id || '');
      if (item?.type === 'topic') {
        const r = await this.addTopic(user, parent.id, id, index);
        if (r) { added++; if (index !== null) index++; } else present.push((await this.topicRepo.findOne({ where: { id } }))?.title || id);
      } else if (item?.type === 'plan') {
        if (parent.kind === 'folder') await this.copyPlanTo(user, id, parent.id);
        else await this.createNode(user, { kind: 'include', parentId: parent.id, refId: id });
        added++;
      } else if (item?.type === 'nbnode') {
        const r = await this.addNotebookNode(user, parent, id);
        added += r.added;
        present.push(...r.present);
      } else throw new BadRequestException('Unbekannte Art.');
    }
    return { added, present };
  }

  /** Lernthema aus dem eigenen Notizbuch? Eigene, erworbene und per Use genutzte, die dort einen Platz haben. */
  private async usableTopic(user: any, topicId: string): Promise<boolean> {
    if (!topicId) return false;
    const own = await this.topicRepo.findOne({ where: { id: topicId } });
    if (!own) return false;
    if (own.ownerId === user.userId) return true;
    return !!(await this.nbPlaceRepo.findOne({ where: { ownerId: user.userId, topicId } }));
  }

  /** Verweis anlegen; null, wenn das Lernthema in diesem Plan schon steht. */
  private async addTopic(user: any, nodeId: string, topicId: string, index: number | null): Promise<string | null> {
    const nodes = await this.nodesOf(user);
    const node = nodes.find((n) => n.id === nodeId);
    if (!canHoldTopic(node?.kind ?? null)) throw new BadRequestException('Lernthemen gehören in einen Plan, Bereich oder Abschnitt.');
    if (!(await this.usableTopic(user, topicId))) throw new NotFoundException('Lernthema nicht gefunden.');
    const entries = await this.entriesOf(user);
    const inPlan = planSubtree(nodes, planOf(nodes, nodeId)!.id);
    if (entries.some((e) => e.topicId === topicId && inPlan.has(e.nodeId))) return null;
    const entry = await this.entryRepo.save(this.entryRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, nodeId, topicId, orderIndex: 0 }));
    await this.placeEntry(entries, entry, nodeId, index);
    return entry.id;
  }

  /** Einen Plan als Kopie in einen Ordner (F5 von Plan zu Ordner): Bereiche, Teilpläne, Verweise. */
  private async copyPlanTo(user: any, planId: string, folderId: string) {
    const nodes = await this.nodesOf(user);
    const src = nodes.find((n) => n.id === planId && n.kind === 'plan');
    if (!src) throw new NotFoundException('Plan nicht gefunden.');
    const entries = await this.entriesOf(user);
    const copy = async (from: PlanNode, parentId: string | null) => {
      const made = await this.nodeRepo.save(this.nodeRepo.create({
        ...from, id: crypto.randomUUID(), parentId, title: from.id === src.id ? `${from.title} (Kopie)` : from.title,
        seen: from.seen ? [...from.seen] : null, createdAt: undefined as any, updatedAt: undefined as any,
      }));
      for (const e of entries.filter((x) => x.nodeId === from.id)) {
        await this.entryRepo.save(this.entryRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, nodeId: made.id, topicId: e.topicId, orderIndex: e.orderIndex }));
      }
      for (const k of nodes.filter((x) => x.parentId === from.id)) await copy(k, made.id);
      return made;
    };
    const made = await copy(src, folderId);
    await this.placeNode(await this.nodesOf(user), made, folderId, null);
  }

  /**
   * Book, Bereich oder Abschnitt des Notizbuchs als Baum übernehmen. In einen
   * Abschnitt hinein (der keine Bereiche aufnimmt) kommen nur seine Lernthemen.
   */
  private async addNotebookNode(user: any, parent: PlanNode, sourceId: string): Promise<{ added: number; present: string[] }> {
    if (sourceId.startsWith('offer:')) {
      const { included, title } = await this.notebooks.topicsOfNode(sourceId, user);
      const target = parent.kind === 'section' ? parent.id : await this.mirror(user, parent.id, sourceId, title, 'area');
      return this.addTopics(user, target, included);
    }
    const nbNodes = await this.nbNodeRepo.find({ where: { ownerId: user.userId } });
    const src = nbNodes.find((n) => n.id === sourceId);
    if (!src) throw new NotFoundException('Bereich nicht gefunden.');
    if (parent.kind === 'section') return this.addTopics(user, parent.id, await this.topicsBelow(user, nbNodes, src.id));
    const nodeId = await this.mirror(user, parent.id, src.id, src.title, src.kind === 'section' ? 'section' : 'area');
    return this.fill(user, nodeId, src.id, nbNodes, true);
  }

  private async addTopics(user: any, nodeId: string, topicIds: string[]) {
    let added = 0;
    const present: string[] = [];
    for (const t of topicIds) {
      if (await this.addTopic(user, nodeId, t, null)) added++;
      else present.push((await this.topicRepo.findOne({ where: { id: t } }))?.title || t);
    }
    return { added, present };
  }

  /** Lernthemen direkt in einem Notizbuch-Knoten, erworbene Bereiche darin aufgelöst. */
  private async topicsIn(user: any, nbNodeId: string): Promise<string[]> {
    const places = (await this.nbPlaceRepo.find({ where: { ownerId: user.userId, nodeId: nbNodeId } })).sort((a, b) => a.orderIndex - b.orderIndex);
    const out: string[] = [];
    for (const p of places) {
      if (!p.topicId.startsWith('offer:')) out.push(p.topicId);
      else out.push(...(await this.notebooks.topicsOfNode(p.topicId, user).catch(() => ({ included: [] as string[] }))).included);
    }
    return out;
  }

  private async topicsBelow(user: any, nbNodes: NotebookNode[], rootId: string): Promise<string[]> {
    const out = await this.topicsIn(user, rootId);
    for (const k of nbNodes.filter((n) => n.parentId === rootId).sort((a, b) => a.orderIndex - b.orderIndex)) out.push(...(await this.topicsBelow(user, nbNodes, k.id)));
    return out;
  }

  /** Plan-Knoten zum Notizbuch-Knoten: schon im selben Elternteil übernommen → der; sonst neu (wächst mit). */
  private async mirror(user: any, parentId: string, sourceId: string, title: string, kind: 'area' | 'section'): Promise<string> {
    const nodes = await this.nodesOf(user);
    const found = nodes.find((n) => n.parentId === parentId && n.sourceNodeId === sourceId);
    if (found) return found.id;
    const why = placeError(nodes, kind, parentId);
    if (why) return parentId; // zu tief oder im Abschnitt: Inhalt kommt ins Elternteil
    const made = await this.nodeRepo.save(this.nodeRepo.create({
      id: crypto.randomUUID(), ownerId: user.userId, kind, title, parentId, orderIndex: 0, refId: null, sourceNodeId: sourceId, seen: [],
    }));
    await this.placeNode(nodes, made, parentId, null);
    return made.id;
  }

  /**
   * Inhalt eines übernommenen Knotens: Unterknoten (rekursiv) und Lernthemen,
   * die noch nicht übernommen sind. `all` beim Übernehmen, sonst (Nachwachsen)
   * nur, was noch nie da war – Entferntes kommt nicht wieder.
   */
  private async fill(user: any, nodeId: string, sourceId: string, nbNodes: NotebookNode[], all: boolean): Promise<{ added: number; present: string[] }> {
    const node = await this.nodeRepo.findOne({ where: { id: nodeId } });
    const tracked = !!node && node.sourceNodeId === sourceId;
    const seen = new Set<string>(tracked ? node!.seen || [] : []);
    let added = 0;
    const present: string[] = [];
    for (const kid of nbNodes.filter((n) => n.parentId === sourceId).sort((a, b) => a.orderIndex - b.orderIndex)) {
      if (seen.has(kid.id) && !all) continue;
      seen.add(kid.id);
      const kidId = await this.mirror(user, nodeId, kid.id, kid.title, kid.kind === 'section' ? 'section' : 'area');
      const r = await this.fill(user, kidId, kid.id, nbNodes, all);
      added += r.added;
      present.push(...r.present);
    }
    for (const topicId of await this.topicsIn(user, sourceId)) {
      if (seen.has(topicId) && !all) continue;
      seen.add(topicId);
      if (await this.addTopic(user, nodeId, topicId, null).catch(() => null)) added++;
      else if (all) present.push((await this.topicRepo.findOne({ where: { id: topicId } }))?.title || topicId);
    }
    if (tracked) await this.nodeRepo.update({ id: nodeId }, { seen: [...seen] as any });
    return { added, present };
  }

  /** Neues aus dem Notizbuch in übernommene Bereiche nachziehen (beim Öffnen der Planung). */
  private async grow(user: any): Promise<number> {
    const growing = (await this.nodesOf(user)).filter((n) => n.sourceNodeId && n.seen && !n.sourceNodeId.startsWith('offer:'));
    if (!growing.length) return 0;
    const nbNodes = await this.nbNodeRepo.find({ where: { ownerId: user.userId } });
    const alive = new Set(nbNodes.map((n) => n.id));
    let added = 0;
    for (const n of growing) {
      if (!alive.has(n.sourceNodeId!)) continue;
      // Noch da? Ein inzwischen übergeordneter Spiegel kann ihn beim Nachwachsen schon erfasst haben.
      if (!(await this.nodeRepo.findOne({ where: { id: n.id } }))) continue;
      added += (await this.fill(user, n.id, n.sourceNodeId!, nbNodes, false)).added;
    }
    return added;
  }
}
