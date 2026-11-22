/**
 * Mappen auflösen (einmalig, Admin): Aus jedem Lernthema mit mehreren Dokumenten werden Lernthemen
 * mit je einem Dokument (one-document.ts). Die Gruppierung bleibt als Abschnitt erhalten:
 *
 *   - Mappe in einem Book oder Bereich → neuer Abschnitt mit ihrem Namen, darin die Lernthemen.
 *   - Mappe in einem Abschnitt → der Abschnitt wird ein Bereich, die Mappe darin ein Abschnitt
 *     (Abschnitte enthalten keine Abschnitte, notebook-rules.ts). Lernthemen, die schon einzeln dort
 *     lagen, bleiben direkt im Bereich.
 *   - Unsortiert oder zu tief verschachtelt → die Lernthemen stehen einfach hintereinander.
 *
 * Das erste Dokument bleibt im bisherigen Lernthema (es heißt dann wie sein Dokument) – damit bleiben
 * Ergebnisse, Links und Klassenarbeiten daran hängen. Jedes weitere Dokument zieht mit seinen
 * eingebetteten Quizzen in ein eigenes Lernthema, Quizze ohne Dokument in „‹Mappe› – Quizze“.
 * Mit den Modulen ziehen Ergebnisse, Stift-Arbeiten und Entwürfe um. Die neuen Lernthemen erben
 * Freigabe, Tags, Mitarbeit, Nutzungsrechte, Bewertungen und ihren Platz bei allen, die die Mappe
 * eingeordnet haben, in der Planung und im Klassennotizbuch (je Lernthema ein Eintrag, Klassenarbeiten
 * bleiben ein Link). Der Quick-Link (Token samt Klassen) geht an den Abschnitt – gedruckte QR-Codes
 * zeigen dann alle Dokumente der früheren Mappe.
 *
 * Vor dem Ausführen entsteht eine Kopie der Datenbank (data/vor-mappen-….sqlite); jede Mappe läuft in
 * einer eigenen Transaktion.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import * as path from 'path';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { PlanNode } from '../core/entities/plan-node.entity';
import { TopicLink, LinkTopicSelection } from '../core/entities/topic-link.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { ClassNotebookPlace } from '../core/entities/class-notebook-place.entity';
import { ClassNotebookNode } from '../core/entities/class-notebook-node.entity';
import { Result } from '../core/entities/result.entity';
import { DocumentWork } from '../core/entities/document-work.entity';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { ContentFeedback } from '../core/entities/content-feedback.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { FederationCopy } from '../core/entities/federation-copy.entity';
import { User } from '../core/entities/user.entity';
import { MAX_NODE_DEPTH, nodeDepth } from '../notebooks/notebook-rules';
import { docChanged } from '../core/events/doc-changes';
import { groupByDocument, isRootDoc } from './one-document';

export type MappeMode = 'new-section' | 'section-to-area' | 'flat';

export interface MappePart {
  title: string;
  /** Module (samt Untermodulen), die in dieses Lernthema gehören. */
  moduleIds: string[];
  /** Nur Quizze ohne Dokument. */
  quizzes?: boolean;
}

export interface MappePlanItem {
  topicId: string;
  ownerId: string;
  ownerName: string;
  title: string;
  /** Ort im Notizbuch der Eigentümerin, z. B. „Elektrische Antriebe › DC-Motor › Gleichstrommotor“. */
  path: string;
  mode: MappeMode;
  /** Abschnitt, der zum Bereich wird (section-to-area). */
  convertNodeId: string | null;
  /** Knoten, in dem der neue Abschnitt entsteht. */
  parentNodeId: string | null;
  /** parts[0] bleibt im bisherigen Lernthema. */
  parts: MappePart[];
  notes: string[];
  skipped?: string;
}

const CHUNK = 400;

/** Pure Planung für eine Mappe – ohne Datenbank prüfbar. */
export function planMappe(
  topic: { id: string; title: string; ownerId: string; syncSource?: string | null },
  modules: Array<{ id: string; type?: string | null; parentId?: string | null; title?: string; orderIndex?: number; content?: any }>,
  place: { nodeId: string | null } | null,
  nodes: Array<{ id: string; kind: string; title: string; parentId: string | null }>,
): Omit<MappePlanItem, 'ownerName' | 'notes'> & { notes: string[] } | null {
  const sorted = [...modules].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  if (sorted.filter((m) => isRootDoc(m)).length < 2) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const names: string[] = [];
  for (let n = place?.nodeId ? byId.get(place.nodeId) : undefined, guard = 0; n && guard < 20; n = n.parentId ? byId.get(n.parentId) : undefined, guard++) names.unshift(n.title);
  const node = place?.nodeId ? byId.get(place.nodeId) || null : null;
  const fits = !!node && nodeDepth(nodes, node.id) + 1 <= MAX_NODE_DEPTH;
  const mode: MappeMode = !node || !fits ? 'flat' : node.kind === 'section' ? 'section-to-area' : 'new-section';
  const { groups, loose } = groupByDocument(sorted);
  const parts: MappePart[] = groups.map((g) => ({ title: (g.find((m) => isRootDoc(m))?.title || topic.title).slice(0, 200), moduleIds: g.map((m) => m.id) }));
  if (loose.length) parts.push({ title: `${topic.title} – Quizze`.slice(0, 200), moduleIds: loose.map((m) => m.id), quizzes: true });
  const notes: string[] = [];
  if (!node) notes.push('Unsortiert: die Lernthemen stehen hintereinander, ohne Abschnitt.');
  else if (!fits) notes.push('Zu tief verschachtelt für einen weiteren Abschnitt: die Lernthemen stehen hintereinander.');
  return {
    topicId: topic.id, ownerId: topic.ownerId, title: topic.title, path: names.join(' › ') || 'Unsortiert', mode,
    convertNodeId: mode === 'section-to-area' ? node!.id : null,
    parentNodeId: mode === 'flat' ? null : node!.id,
    parts, notes,
    ...(topic.syncSource ? { skipped: 'Kommt von einem verbundenen Server – wird dort aufgelöst.' } : {}),
  };
}

@Injectable()
export class MappenMigrationService {
  private readonly logger = new Logger('Mappen');

  constructor(private readonly ds: DataSource) {}

  /** Was „Ausführen“ täte – nichts wird geändert. */
  async preview() {
    const items = await this.plan(this.ds.manager);
    return { count: items.filter((i) => !i.skipped).length, items };
  }

  async run() {
    const backup = await this.backupCopy();
    const items = await this.plan(this.ds.manager);
    const done: string[] = [];
    const failed: string[] = [];
    for (const item of items) {
      if (item.skipped) continue;
      try {
        await this.ds.transaction((m) => this.apply(m, item));
        done.push(item.title);
      } catch (err) {
        this.logger.error(`„${item.title}“: ${(err as Error).message}`);
        failed.push(`${item.title}: ${(err as Error).message}`);
      }
    }
    for (const owner of new Set(items.map((i) => i.ownerId))) docChanged(owner);
    this.logger.log(`${done.length} Mappen aufgelöst, ${failed.length} mit Fehler. Sicherung: ${backup}`);
    return { done: done.length, failed, backup, items };
  }

  /** Kopie der Datenbank neben der Datenbank – vor jeder Änderung. */
  private async backupCopy(): Promise<string> {
    const db = String((this.ds.options as any).database || '');
    if (!db || db === ':memory:') return '(Speicher-Datenbank, keine Kopie)';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(path.dirname(path.resolve(process.cwd(), db)), `vor-mappen-${stamp}.sqlite`);
    await this.ds.query('VACUUM INTO ?', [file]);
    return file;
  }

  async plan(m: EntityManager): Promise<MappePlanItem[]> {
    const topics = await m.find(LearningTopic, { where: { classId: IsNull() } });
    const docTopics = new Set(
      (await m.find(LearningModule, { select: ['topicId', 'type', 'parentId'] }))
        .filter((x) => isRootDoc(x)).map((x) => x.topicId)
        .filter((id, i, all) => all.indexOf(id) !== i),
    );
    const candidates = topics.filter((t) => docTopics.has(t.id));
    if (!candidates.length) return [];
    const users = new Map((await m.find(User, { select: ['id', 'displayName', 'email'] })).map((u) => [u.id, u.displayName || u.email || u.id]));
    const owners = [...new Set(candidates.map((t) => t.ownerId))];
    const nodes = await m.find(NotebookNode, { where: { ownerId: In(owners) } });
    const places = await m.find(NotebookPlacement, { where: { topicId: In(candidates.map((t) => t.id)) } });
    const links = await m.find(TopicLink);
    const items: Array<MappePlanItem & { sort: string }> = [];
    for (const t of candidates) {
      const mods = await m.find(LearningModule, { where: { topicId: t.id } });
      const place = places.find((p) => p.topicId === t.id && p.ownerId === t.ownerId) || null;
      const planned = planMappe(t, mods, place, nodes.filter((n) => n.ownerId === t.ownerId));
      if (!planned) continue;
      const notes = planned.notes;
      const quick = links.find((l) => l.quickTopicId === t.id && !l.classId && l.ownerId === t.ownerId);
      if (quick?.token && planned.mode !== 'flat') notes.push('Quick-Link (Token und Klassen) geht an den Abschnitt.');
      const classLinks = quick ? links.filter((l) => l.templateId === quick.id && l.classId) : [];
      const exams = classLinks.filter((l) => (l.modes || []).includes('exam')).length;
      if (classLinks.length) notes.push(`${classLinks.length} Klassennotizbuch-Eintr${classLinks.length === 1 ? 'ag' : 'äge'}: je Lernthema ein eigener Eintrag dahinter${exams ? ` (${exams} Klassenarbeit${exams === 1 ? '' : 'en'} bleib${exams === 1 ? 't' : 'en'} ein Link mit allen Lernthemen)` : ''}.`);
      const others = links.filter((l) => l !== quick && !classLinks.includes(l) && (l.selection || []).some((s) => s?.topicId === t.id)).length;
      if (others) notes.push(`${others} weitere Freigabe${others === 1 ? '' : 'n'}/Link${others === 1 ? '' : 's'}: bekommen die neuen Lernthemen dazu.`);
      const legacy = await m.count(TopicQuickLink, { where: { topicId: t.id } });
      if (legacy) notes.push(`${legacy} alte${legacy === 1 ? 'r' : ''} Quick-Link${legacy === 1 ? '' : 's'} (/?q=…) zeig${legacy === 1 ? 't' : 'en'} danach nur das erste Dokument.`);
      const offers = await m.count(ShopOffer, { where: { topicId: t.id } });
      if (offers) notes.push(`Shop: ${offers} Angebot${offers === 1 ? '' : 'e'} umfass${offers === 1 ? 't' : 'en'} danach alle Module der früheren Mappe.`);
      const grants = await m.count(UseGrant, { where: { topicId: t.id } });
      if (grants) notes.push(`${grants} Nutzungsrecht${grants === 1 ? '' : 'e'}: gelten auch für die neuen Lernthemen.`);
      const fed = (await m.find(FederationCopy)).filter((f) => (f.topicIds || []).includes(t.id)).length;
      if (fed) notes.push(`${fed} Kopie${fed === 1 ? '' : 'n'} auf verbundenen Servern bleiben, wie sie sind.`);
      items.push({ ...planned, ownerName: String(users.get(t.ownerId) || t.ownerId), notes, sort: `${t.ownerId}|${planned.path}|${String(place?.orderIndex ?? 0).padStart(6, '0')}` });
    }
    items.sort((a, b) => a.sort.localeCompare(b.sort));
    return items.map(({ sort: _s, ...i }) => i);
  }

  /** Eine Mappe auflösen (in einer Transaktion). */
  async apply(m: EntityManager, item: MappePlanItem) {
    const M = await m.findOneBy(LearningTopic, { id: item.topicId });
    if (!M) throw new Error('Lernthema nicht mehr vorhanden');
    const mods = await m.find(LearningModule, { where: { topicId: M.id } });
    // Seit der Vorschau geändert? Dann zählt der aktuelle Stand.
    const fresh = planMappe(M, mods, await m.findOneBy(NotebookPlacement, { ownerId: M.ownerId, topicId: M.id }), await m.find(NotebookNode, { where: { ownerId: M.ownerId } }));
    if (!fresh) return;
    const { parts, mode } = fresh;
    const owner = M.ownerId;
    const mappeTitle = M.title;

    // 1. Abschnitt (und ggf. Abschnitt → Bereich)
    let section: NotebookNode | null = null;
    if (mode !== 'flat') {
      if (fresh.convertNodeId) await m.update(NotebookNode, { id: fresh.convertNodeId }, { kind: 'area' });
      const kids = await m.find(NotebookNode, { where: { ownerId: owner, parentId: fresh.parentNodeId! } });
      section = await m.save(m.create(NotebookNode, {
        id: crypto.randomUUID(), ownerId: owner, kind: 'section', title: mappeTitle.slice(0, 120), parentId: fresh.parentNodeId,
        orderIndex: Math.max(-1, ...kids.map((k) => k.orderIndex)) + 1, tagIds: null, docSettings: null,
      }));
    }

    // 2. Neue Lernthemen
    const created: Array<{ topic: LearningTopic; ids: Set<string> }> = [];
    for (const part of parts.slice(1)) {
      const topic = await m.save(m.create(LearningTopic, {
        id: crypto.randomUUID(), title: part.title, description: '', ownerId: owner,
        selected: M.selected, teacherOnly: M.teacherOnly, visibility: M.visibility || 'locked',
        permissions: M.permissions ?? null, sharedWith: M.sharedWith ?? null, sharedAccess: M.sharedAccess ?? null,
        tagIds: M.tagIds ?? null, categoryIds: M.categoryIds ?? null, classId: null,
        copiedFromId: M.copiedFromId ?? null, copiedFromOwnerId: M.copiedFromOwnerId ?? null,
        copiedFromAuthor: M.copiedFromAuthor ?? null, copiedFromTitle: M.copiedFromTitle ?? null,
      } as Partial<LearningTopic>));
      created.push({ topic, ids: new Set(part.moduleIds) });
    }
    const newIds = created.map((c) => c.topic.id);
    const moved = new Set(created.flatMap((c) => [...c.ids]));

    // 3. Module, Ergebnisse, Stift-Arbeiten, Entwürfe
    const homeOf = (id: string) => created.find((c) => c.ids.has(id))?.topic.id ?? M.id;
    const roots = mods.filter((x) => !x.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const x of mods) x.topicId = homeOf(x.id);
    // Reihenfolge je Lernthema ohne Lücken, wie bisher untereinander.
    const counter = new Map<string, number>();
    for (const x of roots) {
      const k = counter.get(x.topicId) ?? 0;
      counter.set(x.topicId, k + 1);
      x.orderIndex = k;
    }
    await m.save(mods);
    for (const c of created) {
      const ids = [...c.ids];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await m.update(Result, { moduleId: In(slice) }, { topicId: c.topic.id });
        await m.update(DocumentWork, { moduleId: In(slice) }, { topicId: c.topic.id });
        await m.update(ModuleDraft, { moduleId: In(slice) }, { topicId: c.topic.id });
      }
    }
    M.title = parts[0].title;
    await m.save(M);

    // 4. Notizbuch: Eigentümerin in den Abschnitt bzw. dahinter, alle anderen dahinter
    for (const p of await m.find(NotebookPlacement, { where: { topicId: M.id } })) {
      if (section && p.ownerId === owner) {
        p.nodeId = section.id;
        p.orderIndex = 0;
        await m.save(p);
        for (const [k, t] of newIds.entries()) {
          await m.save(m.create(NotebookPlacement, { id: crypto.randomUUID(), ownerId: owner, topicId: t, nodeId: section.id, orderIndex: k + 1, inheritedTagIds: p.inheritedTagIds ?? null }));
        }
        continue;
      }
      // Nur wer Rechte an den neuen hat: die Eigentümerin selbst oder mit Nutzungsrecht (siehe 6.)
      await this.insertAfter(m, p, newIds);
    }

    // 5. Planung
    for (const e of await m.find(PlanEntry, { where: { topicId: M.id } })) {
      const after = (await m.find(PlanEntry, { where: { ownerId: e.ownerId, nodeId: e.nodeId } })).filter((x) => x.orderIndex > e.orderIndex);
      for (const x of after) x.orderIndex += newIds.length;
      if (after.length) await m.save(after);
      for (const [k, t] of newIds.entries()) await m.save(m.create(PlanEntry, { id: crypto.randomUUID(), ownerId: e.ownerId, nodeId: e.nodeId, topicId: t, orderIndex: e.orderIndex + 1 + k }));
    }
    // Übernommene Bereiche (Planung, Klassennotizbuch) sollen das Neue nicht noch einmal nachziehen.
    const seenAdd = [...newIds, ...(section ? [section.id] : [])];
    for (const repo of [PlanNode, ClassNotebookNode] as const) {
      const rows = (await m.find(repo as any)).filter((n: any) => Array.isArray(n.seen) && n.seen.includes(M.id)) as any[];
      for (const n of rows) n.seen = [...new Set([...n.seen, ...seenAdd])];
      if (rows.length) await m.save(rows);
    }

    // 6. Nutzungsrechte, Bewertungen, Shop
    for (const g of await m.find(UseGrant, { where: { topicId: M.id } })) {
      for (const t of newIds) await m.save(m.create(UseGrant, { ...g, id: crypto.randomUUID(), topicId: t, pricePaid: 0, paidTo: null }));
    }
    for (const f of await m.find(ContentFeedback, { where: { topicId: M.id } })) {
      for (const t of newIds) await m.save(m.create(ContentFeedback, { ...f, id: crypto.randomUUID(), topicId: t }));
    }
    for (const o of await m.find(ShopOffer, { where: { topicId: M.id, scopeType: 'topic' as any } })) {
      if ((o as any).kind !== 'creator') continue;
      o.scopeType = 'modules';
      o.moduleIds = roots.map((r) => r.id);
      o.title = o.title || mappeTitle;
      o.topicId = '';
      await m.save(o);
    }

    // 7. Links
    await this.relink(m, M, owner, created, moved, section, mappeTitle);
  }

  /** Platz `p` behalten, die neuen Lernthemen direkt dahinter (gleicher Knoten, gleiche Lehrkraft). */
  private async insertAfter(m: EntityManager, p: NotebookPlacement, newIds: string[]) {
    const after = (await m.find(NotebookPlacement, { where: { ownerId: p.ownerId } }))
      .filter((x) => (x.nodeId ?? null) === (p.nodeId ?? null) && x.orderIndex > p.orderIndex);
    for (const x of after) x.orderIndex += newIds.length;
    if (after.length) await m.save(after);
    for (const [k, t] of newIds.entries()) {
      await m.save(m.create(NotebookPlacement, { id: crypto.randomUUID(), ownerId: p.ownerId, topicId: t, nodeId: p.nodeId ?? null, orderIndex: p.orderIndex + 1 + k, inheritedTagIds: p.inheritedTagIds ?? null }));
    }
  }

  private async relink(m: EntityManager, M: LearningTopic, owner: string, created: Array<{ topic: LearningTopic; ids: Set<string> }>, moved: Set<string>,
    section: NotebookNode | null, mappeTitle: string) {
    const links = await m.find(TopicLink);
    const quick = links.find((l) => l.quickTopicId === M.id && !l.classId && l.ownerId === owner) || null;
    const perTopic = quick ? links.filter((l) => l.templateId === quick.id && l.classId && !(l.modes || []).includes('exam')) : [];
    const handled = new Set<TopicLink>([...(quick ? [quick] : []), ...perTopic]);

    /** Auswahl eines Links: die neuen Lernthemen hinter dem Eintrag der Mappe. */
    const expand = (sel: LinkTopicSelection[]): LinkTopicSelection[] => {
      const out: LinkTopicSelection[] = [];
      for (const s of sel || []) {
        if (s?.topicId !== M.id) { out.push(s); continue; }
        if (s.all) { out.push(s, ...created.map((c) => ({ topicId: c.topic.id, all: true }))); continue; }
        const ids = s.moduleIds || [];
        out.push({ ...s, moduleIds: ids.filter((id) => !moved.has(id)) });
        for (const c of created) {
          const mine = ids.filter((id) => c.ids.has(id));
          if (mine.length) out.push({ topicId: c.topic.id, all: false, moduleIds: mine });
        }
      }
      return out;
    };

    // Freigaben, Klassenarbeiten, Links anderer Lehrkräfte: dieselbe Auswahl über alle Lernthemen.
    for (const l of links) {
      if (handled.has(l) || !(l.selection || []).some((s) => s?.topicId === M.id)) continue;
      l.selection = expand(l.selection);
      await m.save(l);
    }

    // Klassennotizbuch: je Lernthema ein eigener Eintrag, direkt hinter dem der Mappe.
    const rules = new Map<string, TopicLink>();
    const ruleFor = async (t: LearningTopic) => {
      if (rules.has(t.id)) return rules.get(t.id)!;
      const r = await m.save(m.create(TopicLink, {
        id: crypto.randomUUID(), name: t.title, ownerId: owner, token: null, examToken: null, contestHostToken: null, active: true,
        modes: quick!.modes, selection: [{ topicId: t.id, all: true }], accessPassword: quick!.accessPassword, singleAttempt: quick!.singleAttempt,
        tagIds: quick!.tagIds, companionSettings: quick!.companionSettings, contestSettings: quick!.contestSettings,
        classId: null, templateId: null, quickTopicId: t.id, quickNodeId: null, startView: quick!.startView, examStartView: quick!.examStartView,
      } as Partial<TopicLink>));
      rules.set(t.id, r);
      return r;
    };
    for (const L of perTopic) {
      const entry = (L.selection || []).find((s) => s?.topicId === M.id);
      const copies: TopicLink[] = [];
      for (const c of created) {
        const sel: LinkTopicSelection = !entry || entry.all
          ? { topicId: c.topic.id, all: true }
          : { topicId: c.topic.id, all: false, moduleIds: (entry.moduleIds || []).filter((id) => c.ids.has(id)) };
        const r = await ruleFor(c.topic);
        copies.push(await m.save(m.create(TopicLink, {
          ...L, id: crypto.randomUUID(), name: c.topic.title, token: null, examToken: null, contestHostToken: null,
          templateId: r.id, quickTopicId: null, quickNodeId: null, selection: [sel],
          releasedModuleIds: (L.releasedModuleIds || []).filter((id) => c.ids.has(id)),
          solutionModuleIds: (L.solutionModuleIds || []).filter((id) => c.ids.has(id)),
          createdAt: undefined, updatedAt: undefined,
        } as any)));
      }
      if (entry && !entry.all) {
        L.selection = (L.selection || []).map((s) => (s === entry ? { ...s, moduleIds: (s.moduleIds || []).filter((id) => !moved.has(id)) } : s));
        await m.save(L);
      }
      const place = await m.findOneBy(ClassNotebookPlace, { id: L.id });
      if (!place) continue;
      const after = (await m.find(ClassNotebookPlace, { where: { classId: place.classId } }))
        .filter((x) => (x.nodeId ?? null) === (place.nodeId ?? null) && x.orderIndex > place.orderIndex);
      for (const x of after) x.orderIndex += copies.length;
      if (after.length) await m.save(after);
      for (const [k, c] of copies.entries()) {
        await m.save(m.create(ClassNotebookPlace, { id: c.id, classId: place.classId, nodeId: place.nodeId ?? null, orderIndex: place.orderIndex + 1 + k, hidden: false, shareToken: null }));
      }
    }

    // Quick-Link → Abschnitt: Token und Klassen wandern an eine Regel des Abschnitts.
    if (quick?.token && section) {
      const token = quick.token;
      const classIds = quick.classIds;
      quick.token = null;
      quick.classIds = null;
      await m.save(quick);
      await m.save(m.create(TopicLink, {
        ...quick, id: crypto.randomUUID(), name: mappeTitle, token, classIds, quickTopicId: null, quickNodeId: section.id, templateId: null, classId: null,
        selection: [{ topicId: M.id, all: true }, ...created.map((c) => ({ topicId: c.topic.id, all: true }))],
        createdAt: undefined, updatedAt: undefined,
      } as any));
    } else if (quick?.token) {
      // Ohne Abschnitt (unsortiert, zu tief): Der Link zeigt weiter alles der früheren Mappe.
      quick.selection = expand(quick.selection);
      await m.save(quick);
    }
  }
}
