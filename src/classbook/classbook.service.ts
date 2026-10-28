import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ClassNotebook, ClassNotebookItem, ClassNotebookMarker } from '../core/entities/class-notebook.entity';
import { ClassStudent } from '../core/entities/class-student.entity';
import { StudentClass } from '../core/entities/student-class.entity';
import { Result } from '../core/entities/result.entity';
import { DocumentWork } from '../core/entities/document-work.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { ExamAttempt } from '../core/entities/exam-attempt.entity';
import { ClassNotebookNode } from '../core/entities/class-notebook-node.entity';
import { ClassNotebookPlace } from '../core/entities/class-notebook-place.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { canHoldNode, depthOf, nodeMoveError, reorder, dissolve, MAX_CLASS_DEPTH } from './classbook-tree';
import { ClassesService } from '../classes/classes.service';
import { LinksService, PRACTICE_MODES } from '../links/links.service';
import { NotebooksService } from '../notebooks/notebooks.service';
import { issueTicket, readTicket } from '../classes/student-ticket';
import { isTestStudent } from '../classes/test-student';
import { newPin, pinMatches, pinGuard } from '../work/pin';
import { baseUrl, renderQr } from '../core/share/link-url';
import { embeddedQuizIds } from '../core/public/student-view';
import { ContestService } from '../contest/contest.service';
import { ClassbookLive, LiveTarget } from './classbook-live';
import type { Response } from 'express';
import { newClassCode, normalizeClassCode, formatClassCode, endOfDay, firstLoginOpen, loginDecision, unitCells, Unit, DetailLike, classbookTicketKey, examState, toggleSelection, explicitSelection, moduleOn, AvailTopic, SelEntry } from './classbook-rules';

const practiceModes = (link: TopicLink) => PRACTICE_MODES.filter((m) => (link.modes || []).includes(m));

/** Module der Übersicht: je Modul eines, mit seinen Submodulen. */
function unitsOf(modules: LearningModule[]): Array<Unit & { title: string; type: string }> {
  return modules.map((m) => ({
    id: m.id,
    title: m.title || '',
    type: m.type,
    ids: [m.id, ...((m as any).subModules || []).map((s: LearningModule) => s.id)],
  }));
}

/**
 * Klassennotizbuch (docs/klassennotizbuch.md): je Klasse ein Zugang für die
 * Schüler (Klassenbuch-Link, Name und PIN) und eine Übersicht für die
 * Lehrkraft. Zuweisungen sind die Klassenlinks der Klasse, Schülerdaten ihre
 * Ergebnisse und Bearbeitungen – hier liegt nichts davon doppelt.
 */
@Injectable()
export class ClassbookService {
  constructor(
    @InjectRepository(ClassNotebook) private readonly repo: Repository<ClassNotebook>,
    @InjectRepository(ClassStudent) private readonly studentRepo: Repository<ClassStudent>,
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(DocumentWork) private readonly workRepo: Repository<DocumentWork>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(ExamAttempt) private readonly attemptRepo: Repository<ExamAttempt>,
    private readonly classes: ClassesService,
    private readonly links: LinksService,
    private readonly notebooks: NotebooksService,
    private readonly contest: ContestService,
    private readonly live: ClassbookLive,
    @InjectRepository(ClassNotebookNode) private readonly nodeRepo: Repository<ClassNotebookNode>,
    @InjectRepository(ClassNotebookPlace) private readonly placeRepo: Repository<ClassNotebookPlace>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(NotebookNode) private readonly nbNodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly nbPlaceRepo: Repository<NotebookPlacement>,
  ) {}

  /** Notizbuch der Klasse – beim ersten Aufruf angelegt; ältere bekommen hier ihren Klassencode. */
  private async ensure(klasse: StudentClass): Promise<ClassNotebook> {
    const found = await this.repo.findOne({ where: { classId: klasse.id } });
    if (found) {
      if (!found.code) { found.code = await this.freeCode(); await this.repo.save(found); }
      return found;
    }
    return this.repo.save(this.repo.create({
      id: crypto.randomUUID(), classId: klasse.id, ownerId: klasse.ownerId || '',
      token: crypto.randomBytes(12).toString('base64url'), code: await this.freeCode(), firstLoginUntil: null, teacherItems: [],
    }));
  }

  /** Klassencode, den noch kein Klassennotizbuch hat. */
  private async freeCode(): Promise<string> {
    for (;;) {
      const code = newClassCode((n) => crypto.randomInt(n));
      if (!(await this.repo.findOne({ where: { code } }))) return code;
    }
  }

  /** Klassenlinks der Klasse (die Zuweisungen), älteste zuerst. */
  private async classLinks(klasse: StudentClass): Promise<TopicLink[]> {
    const list = await this.linkRepo.find({ where: { classId: klasse.id, ownerId: klasse.ownerId || '' } });
    return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  /**
   * Baum der Klasse: Bereiche/Abschnitte und je Zuweisung ihr Platz. Ohne
   * eingetragenen Platz steht eine Zuweisung oben, hinter den übrigen.
   */
  private async tree(klasse: StudentClass, links: TopicLink[]) {
    const nodes = (await this.nodeRepo.find({ where: { classId: klasse.id } })).sort((a, b) => a.orderIndex - b.orderIndex);
    const places = new Map((await this.placeRepo.find({ where: { classId: klasse.id } })).map((p) => [p.id, p]));
    const known = new Set(nodes.map((n) => n.id));
    const placeOf = (l: TopicLink, i: number) => {
      const p = places.get(l.id);
      return p ? { nodeId: p.nodeId && known.has(p.nodeId) ? p.nodeId : null, order: p.orderIndex, inTree: !p.hidden } : { nodeId: null, order: 100000 + i, inTree: true };
    };
    return {
      nodes: nodes.map(({ id, kind, title, parentId, orderIndex, sourceNodeId }) => ({
        id, kind, title, parentId: parentId && known.has(parentId) ? parentId : null, orderIndex, sourceNodeId: sourceNodeId || null })),
      placeOf: new Map(links.map((l, i) => [l.id, placeOf(l, i)])),
    };
  }

  /** Klasseneigene Lernthemen dieser Klasse (IDs). */
  private async classTopicIds(classId: string) {
    return new Set((await this.topicRepo.find({ where: { classId }, select: ['id'] })).map((t) => t.id));
  }

  private async linkInfo(link: TopicLink) {
    const resolved = await this.links.resolveModules(link);
    return {
      id: link.id,
      name: link.name,
      active: link.active,
      modes: link.modes || [],
      practice: practiceModes(link),
      exam: (link.modes || []).includes('exam'),
      contest: (link.modes || []).includes('contest'),
      topics: resolved.map((r) => ({ id: r.topic.id, title: r.topic.title, units: unitsOf(r.modules).map(({ id, title, type }) => ({ id, title, type })) })),
      resolved,
    };
  }

  // ---- Lehrkraft ----

  async forTeacher(user: any, classId: string, req?: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    // Aus dem Notizbuch übernommene Bereiche: Neues dort kommt ausgeschaltet nach.
    await this.syncMirrors(user, klasse, req).catch(() => undefined);
    const url = `${baseUrl(req)}/?k=${nb.token}`;
    const students = await this.studentRepo.find({ where: { classId }, select: ['id', 'status', 'pinShownAt'] });
    const raw = await this.classLinks(klasse);
    const { nodes, placeOf } = await this.tree(klasse, raw);
    const own = await this.classTopicIds(klasse.id);
    const links = await Promise.all(raw.map(async (l) => {
      const info = await this.linkInfo(l);
      const ownTopic = (l.selection || []).map((e) => e.topicId).find((id) => own.has(id)) || null;
      const avail = await this.available(l, user);
      const selection = (l.selection || []) as SelEntry[];
      return {
        ...info,
        ...placeOf.get(l.id),
        // Klasseneigenes Lernthema (nur in diesem Klassennotizbuch) – sonst Verweis aufs Notizbuch.
        classTopicId: ownTopic,
        notReleased: avail.notReleased,
        // Was die Zuweisung enthalten kann, mit Schalter je Lernthema und Modul.
        available: avail.topics.map((t) => {
          const entry = selection.find((e) => e.topicId === t.topicId);
          // Quizze in einem eingeschalteten Dokument kommen mit ihm (siehe LinksService.resolveModules).
          const viaDoc = new Set(t.modules.filter((m) => moduleOn(entry, m)).flatMap((m) => m.embeds));
          return {
            ...t,
            enabled: !!entry && t.modules.some((m) => moduleOn(entry, m)),
            modules: t.modules.map(({ embeds: _e, ...m }) => ({ ...m, enabled: moduleOn(entry, m) || viaDoc.has(m.id), viaDoc: !moduleOn(entry, m) && viaDoc.has(m.id) })),
          };
        }),
      };
    }));
    return {
      classId,
      className: klasse.name,
      schoolYear: klasse.schoolYear,
      strict: klasse.strict,
      url,
      code: nb.code ? formatClassCode(nb.code) : '',
      qrSvg: await renderQr(url),
      firstLoginUntil: firstLoginOpen(nb.firstLoginUntil) ? nb.firstLoginUntil : null,
      teacherItems: nb.teacherItems || [],
      marker: nb.marker || null,
      live: { online: this.live.online(classId), follow: this.live.isFollowing(classId) },
      nodes,
      students: {
        total: students.length,
        confirmed: students.filter((s) => s.status !== 'pending').length,
        pinSeen: students.filter((s) => s.status !== 'pending' && s.pinShownAt).length,
      },
      links: links.map(({ resolved: _r, ...l }) => l),
    };
  }

  /**
   * Was eine Zuweisung enthalten kann: bei einem Bereich (Regel des Knotens)
   * alle startbaren Lernthemen darin – auch später dazugelegte –, sonst die
   * gewählten; je Lernthema alle Module, die der Lehrkraft zustehen.
   */
  private async available(link: TopicLink, user: any) {
    const rule = link.templateId ? await this.linkRepo.findOne({ where: { id: link.templateId } }) : null;
    const ids: string[] = [];
    let notReleased: string[] = [];
    if (rule?.quickNodeId) {
      const found = await this.notebooks.topicsOfNode(rule.quickNodeId, user).catch(() => ({ included: [] as string[], notReleased: [] as string[] }));
      ids.push(...found.included);
      notReleased = found.notReleased;
    }
    if (rule?.quickTopicId && !ids.includes(rule.quickTopicId)) ids.push(rule.quickTopicId);
    for (const e of [...(rule?.selection || []), ...(link.selection || [])]) if (!ids.includes(e.topicId)) ids.push(e.topicId);
    const resolved = ids.length
      ? await this.links.resolveModules(Object.assign(new TopicLink(), link, { selection: ids.map((topicId) => ({ topicId, all: true })) }))
      : [];
    const topics = resolved.map((r) => ({
      topicId: r.topic.id,
      title: r.topic.title,
      // Eigene Lernthemen lassen sich von hier aus bearbeiten, erworbene nur ansehen.
      canEdit: r.topic.ownerId === user.userId || user.role === 'admin',
      tagIds: r.topic.tagIds || [],
      modules: r.modules.map((m) => ({
        id: m.id, title: m.title || '', type: m.type, tagIds: m.tagIds || [],
        subIds: ((m as any).subModules || []).map((x: LearningModule) => x.id),
        embeds: embeddedQuizIds(m),
      })),
    }));
    return { topics, notReleased };
  }

  private async ownClassLink(user: any, classId: string, linkId: string) {
    await this.classes.ownedClass(classId, user);
    const link = await this.linkRepo.findOne({ where: { id: linkId, classId, ownerId: user.userId } });
    if (!link) throw new NotFoundException('Zuweisung nicht gefunden.');
    return link;
  }

  /** `{ topicId, moduleId?, enabled }` – Lernthema oder Modul dieser Zuweisung ein- oder ausschalten. */
  async setItem(user: any, classId: string, linkId: string, body: { topicId?: string; moduleId?: string; enabled?: boolean }) {
    const link = await this.ownClassLink(user, classId, linkId);
    const { topics } = await this.available(link, user);
    const topicId = String(body?.topicId || '');
    if (!topics.some((t) => t.topicId === topicId)) throw new BadRequestException('Dieses Lernthema gehört nicht zur Zuweisung.');
    link.selection = toggleSelection((link.selection || []) as SelEntry[], topics as AvailTopic[], {
      topicId, moduleId: body?.moduleId ? String(body.moduleId) : undefined, enabled: !!body?.enabled,
    });
    // Eigene Auswahl dieser Klasse – das Nachziehen einer Freigabe überschreibt sie nicht ungefragt.
    link.customized = true;
    await this.linkRepo.save(link);
    return { success: true };
  }

  /**
   * Ganze Zuweisungen ein- oder ausschalten – die eines Bereichs, Abschnitts
   * oder des ganzen Klassennotizbuchs (die Liste stellt die Ansicht zusammen).
   */
  async setLinks(user: any, classId: string, body: { linkIds?: unknown; enabled?: boolean }) {
    const ids = Array.isArray(body?.linkIds) ? body.linkIds.map(String) : [];
    for (const linkId of ids) {
      const link = await this.ownClassLink(user, classId, linkId);
      const { topics } = await this.available(link, user);
      let selection = (link.selection || []) as SelEntry[];
      for (const t of topics) selection = toggleSelection(selection, topics as AvailTopic[], { topicId: t.topicId, enabled: !!body?.enabled });
      link.selection = selection;
      link.customized = true;
      await this.linkRepo.save(link);
    }
    return { success: true, changed: ids.length };
  }

  /**
   * Lernthema oder Knoten des Notizbuchs zuweisen. Die Auswahl wird
   * ausdrücklich: Später ergänzte Module und Lernthemen erscheinen
   * ausgeschaltet. Eine schon vorhandene Zuweisung bleibt, wie sie ist.
   */
  async assign(user: any, classId: string, body: { type?: string; id?: string; nodeId?: string | null }, req?: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const id = String(body?.id || '');
    // Book, Bereich, Abschnitt: als Baum (assignTree).
    if (body?.type === 'node') return this.assignTree(user, klasse, id, await this.nodeOrNull(klasse.id, body?.nodeId), req);
    const rule = await this.linkRepo.findOne({ where: { ownerId: user.userId, classId: IsNull(), quickTopicId: id } });
    const existing = rule ? await this.linkRepo.findOne({ where: { ownerId: user.userId, templateId: rule.id, classId: klasse.id } }) : null;
    if (existing) return { linkId: existing.id, existed: true, notReleased: [] };
    const created: any = await this.links.classLinkForTopic(id, klasse.id, user, req);
    const link = await this.linkRepo.findOne({ where: { id: created.id } });
    if (link) {
      const { topics } = await this.available(link, user);
      link.selection = explicitSelection((link.selection || []) as SelEntry[], topics as AvailTopic[]);
      await this.linkRepo.save(link);
      await this.placeAtEnd(klasse.id, link.id, await this.nodeOrNull(klasse.id, body?.nodeId));
    }
    return { linkId: created.id, existed: false, notReleased: created.notReleased || [] };
  }

  // ---- Baum: Bereiche, Abschnitte, Plätze der Lernthemen ----

  private async nodeOrNull(classId: string, nodeId: unknown) {
    if (!nodeId) return null;
    const node = await this.nodeRepo.findOne({ where: { id: String(nodeId), classId } });
    if (!node) throw new NotFoundException('Bereich nicht gefunden.');
    return node.id;
  }

  private async placeAtEnd(classId: string, linkId: string, nodeId: string | null) {
    const siblings = await this.placeRepo.find({ where: { classId, nodeId: nodeId ?? IsNull() } });
    const orderIndex = Math.max(-1, ...siblings.filter((p) => p.id !== linkId).map((p) => p.orderIndex)) + 1;
    await this.placeRepo.save(this.placeRepo.create({ id: linkId, classId, nodeId, orderIndex }));
  }

  // ---- Bereiche aus dem Notizbuch als Baum ----

  /**
   * Book, Bereich oder Abschnitt des Notizbuchs zuweisen: im Klassennotizbuch
   * entsteht derselbe Baum – der Pfad darüber (ohne Book; ein gleichnamiger
   * Bereich wird mitgenutzt), der Knoten selbst, seine Bereiche und
   * Abschnitte, je Lernthema ein Eintrag. Die Einträge verweisen aufs
   * Notizbuch. Später Dazugekommenes wächst ausgeschaltet nach (syncMirrors).
   */
  private async assignTree(user: any, klasse: StudentClass, sourceId: string, targetId: string | null, req?: any,
    from: { preset?: Map<string, SelEntry>; exclude?: string } = {}) {
    const nbNodes = sourceId.startsWith('offer:') ? [] : await this.nbNodeRepo.find({ where: { ownerId: user.userId } });
    const byId = new Map(nbNodes.map((n) => [n.id, n]));
    let parentId = targetId;
    let title: string;
    let kind: 'area' | 'section' = 'area';
    if (sourceId.startsWith('offer:')) {
      title = (await this.notebooks.topicsOfNode(sourceId, user)).title || 'Erworben';
    } else {
      const src = byId.get(sourceId);
      if (!src) throw new NotFoundException('Bereich nicht gefunden.');
      title = src.title;
      kind = src.kind === 'section' ? 'section' : 'area';
      const path: NotebookNode[] = [];
      for (let n = src.parentId ? byId.get(src.parentId) : undefined; n; n = n.parentId ? byId.get(n.parentId) : undefined) {
        if (n.kind !== 'book') path.unshift(n);
      }
      for (const n of path) parentId = await this.mirrorNode(klasse.id, n.id, n.title, 'area', parentId);
    }
    const existed = (await this.nodeRepo.findOne({ where: { classId: klasse.id, sourceNodeId: sourceId } }))?.seen != null;
    const nodeId = await this.mirrorNode(klasse.id, sourceId, title, kind, parentId);
    const res = await this.fillMirror(user, klasse, nodeId, sourceId, nbNodes, { on: true, req, ...from });
    return { linkId: null, nodeId, existed: existed && !res.added, added: res.added, notReleased: res.notReleased };
  }

  /**
   * Knoten des Klassennotizbuchs zum Notizbuch-Knoten `sourceId`: schon
   * übernommen (irgendwo in der Klasse) → der; sonst ein gleichnamiger,
   * selbst angelegter unter `parentId`; sonst neu. Wo kein Knoten mehr
   * hinpasst (Abschnitt, Tiefe), bleibt es beim Elternteil.
   */
  private async mirrorNode(classId: string, sourceId: string, title: string, kind: 'area' | 'section', parentId: string | null): Promise<string | null> {
    const nodes = await this.nodeRepo.find({ where: { classId } });
    const found = nodes.find((n) => n.sourceNodeId === sourceId);
    if (found) return found.id;
    const parent = parentId ? nodes.find((n) => n.id === parentId) || null : null;
    if (!canHoldNode(parent) || depthOf(nodes, parentId) + 1 > MAX_CLASS_DEPTH) return parentId;
    const same = nodes.find((n) => (n.parentId ?? null) === parentId && !n.sourceNodeId && n.kind === kind && n.title.trim().toLowerCase() === title.trim().toLowerCase());
    if (same) {
      await this.nodeRepo.update({ id: same.id }, { sourceNodeId: sourceId });
      return same.id;
    }
    const orderIndex = Math.max(-1, ...nodes.filter((n) => (n.parentId ?? null) === parentId).map((n) => n.orderIndex)) + 1;
    const made = await this.nodeRepo.save(this.nodeRepo.create({ id: crypto.randomUUID(), classId, kind, title, parentId, orderIndex, sourceNodeId: sourceId, seen: null }));
    return made.id;
  }

  /**
   * Inhalt eines übernommenen Knotens anlegen, was noch nicht übernommen ist:
   * Unterbereiche/Abschnitte (rekursiv) und je freigegebenem Lernthema ein
   * Eintrag. `on`: beim Zuweisen eingeschaltet, beim Nachwachsen aus. Ein
   * Lernthema, das die Klasse schon hat, kommt nicht doppelt.
   */
  private async fillMirror(user: any, klasse: StudentClass, cbNodeId: string | null, sourceId: string, nbNodes: NotebookNode[],
    opts: { on: boolean; req?: any; preset?: Map<string, SelEntry>; exclude?: string }): Promise<{ added: number; notReleased: string[] }> {
    const node = cbNodeId ? await this.nodeRepo.findOne({ where: { id: cbNodeId, classId: klasse.id } }) : null;
    const tracked = !!node && node.sourceNodeId === sourceId;
    const seen = new Set<string>(tracked ? node!.seen || [] : []);
    let added = 0;
    const notReleased: string[] = [];
    // Unterbereiche und Abschnitte, in der Reihenfolge des Notizbuchs.
    const kids = nbNodes.filter((n) => n.parentId === sourceId).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const kid of kids) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      const kidId = await this.mirrorNode(klasse.id, kid.id, kid.title, kid.kind === 'section' ? 'section' : 'area', cbNodeId);
      const r = await this.fillMirror(user, klasse, kidId, kid.id, nbNodes, opts);
      added += r.added;
      notReleased.push(...r.notReleased);
    }
    // Lernthemen direkt in diesem Knoten (ein erworbener Bereich darin: seine Lernthemen).
    const startable = await this.notebooks.topicsOfNode(sourceId, user).catch(() => ({ included: [] as string[], notReleased: [] as string[] }));
    const ok = new Set(startable.included);
    let topicIds: string[];
    if (sourceId.startsWith('offer:')) topicIds = startable.included;
    else {
      const places = (await this.nbPlaceRepo.find({ where: { ownerId: user.userId, nodeId: sourceId } })).sort((a, b) => a.orderIndex - b.orderIndex);
      topicIds = [];
      for (const p of places) {
        if (!p.topicId.startsWith('offer:')) topicIds.push(p.topicId);
        else topicIds.push(...(await this.notebooks.topicsOfNode(p.topicId, user).catch(() => ({ included: [] as string[] }))).included);
      }
    }
    // `exclude`: der Bereichs-Link, der gerade zum Baum wird – seine Lernthemen kommen einzeln.
    const inClass = new Set((await this.classLinks(klasse)).filter((l) => l.id !== opts.exclude).flatMap((l) => (l.selection || []).map((e) => e.topicId)));
    for (const topicId of topicIds) {
      if (seen.has(topicId)) continue;
      // Gesperrte Lernthemen kommen, sobald sie freigegeben sind.
      if (!ok.has(topicId)) continue;
      seen.add(topicId);
      if (inClass.has(topicId)) continue;
      const created: any = await this.links.classLinkForTopic(topicId, klasse.id, user, opts.req);
      const link = await this.linkRepo.findOne({ where: { id: created.id } });
      if (!link) continue;
      const { topics } = await this.available(link, user);
      const was = opts.preset?.get(topicId);
      const off = (link.selection || []).map((e) => ({ topicId: e.topicId, all: false, moduleIds: [] }));
      link.selection = opts.preset
        // Aus einem Bereichs-Link: an und aus wie dort.
        ? (was ? explicitSelection([{ ...was, topicId }], topics as AvailTopic[]) : off)
        : opts.on ? explicitSelection((link.selection || []) as SelEntry[], topics as AvailTopic[]) : off;
      await this.linkRepo.save(link);
      await this.placeAtEnd(klasse.id, link.id, cbNodeId);
      inClass.add(topicId);
      added++;
    }
    notReleased.push(...startable.notReleased);
    if (tracked) await this.nodeRepo.update({ id: node!.id }, { seen: [...seen] as any });
    return { added, notReleased: [...new Set(notReleased)] };
  }

  /**
   * Links auf einen ganzen Bereich (Quick-Link mit Klasse, Zuweisung von vor
   * dem Baum) zum Baum machen – wie „Klassennotizbuch zuweisen“: Bereiche,
   * Abschnitte, je Lernthema ein Eintrag, an und aus wie im Link. Der Link
   * selbst bleibt (QR-Codes, Ergebnisse), steht aber nicht mehr im Baum.
   */
  private async treeFromNodeLinks(user: any, klasse: StudentClass, req?: any) {
    const links = await this.classLinks(klasse);
    const places = new Map((await this.placeRepo.find({ where: { classId: klasse.id } })).map((p) => [p.id, p]));
    for (const link of links) {
      const place = places.get(link.id);
      if (place?.hidden || !link.templateId) continue;
      const rule = await this.linkRepo.findOne({ where: { id: link.templateId } });
      if (!rule?.quickNodeId || rule.ownerId !== user.userId) continue;
      const preset = new Map(((link.selection || []) as SelEntry[]).map((e) => [e.topicId, e]));
      try {
        await this.assignTree(user, klasse, rule.quickNodeId, place?.nodeId ?? null, req, { preset, exclude: link.id });
      } catch {
        continue; // Bereich im Notizbuch gelöscht – der Link bleibt, wie er ist.
      }
      await this.placeRepo.save(this.placeRepo.create({ id: link.id, classId: klasse.id, nodeId: place?.nodeId ?? null, orderIndex: place?.orderIndex ?? 0, hidden: true }));
    }
  }

  /** Übernommene Bereiche nachziehen: Neues aus dem Notizbuch kommt ausgeschaltet dazu. */
  private async syncMirrors(user: any, klasse: StudentClass, req?: any) {
    await this.treeFromNodeLinks(user, klasse, req);
    const growing = (await this.nodeRepo.find({ where: { classId: klasse.id } })).filter((n) => n.sourceNodeId && n.seen);
    if (!growing.length) return;
    const nbNodes = await this.nbNodeRepo.find({ where: { ownerId: user.userId } });
    const known = new Set(nbNodes.map((n) => n.id));
    for (const n of growing) {
      // Im Notizbuch gelöscht: Der Bereich bleibt, wächst aber nicht mehr.
      if (!n.sourceNodeId!.startsWith('offer:') && !known.has(n.sourceNodeId!)) continue;
      await this.fillMirror(user, klasse, n.id, n.sourceNodeId!, nbNodes, { on: false, req });
    }
  }

  /** `{ kind: 'area'|'section', title, parentId? }` */
  async createNode(user: any, classId: string, body: { kind?: string; title?: string; parentId?: string | null }) {
    await this.classes.ownedClass(classId, user);
    const kind = body?.kind === 'section' ? 'section' : 'area';
    const title = String(body?.title || '').trim().slice(0, 200);
    if (!title) throw new BadRequestException('Bitte einen Namen eingeben.');
    const nodes = await this.nodeRepo.find({ where: { classId } });
    const parentId = body?.parentId ? String(body.parentId) : null;
    const parent = parentId ? nodes.find((n) => n.id === parentId) || null : null;
    if (parentId && !parent) throw new NotFoundException('Bereich nicht gefunden.');
    if (!canHoldNode(parent)) throw new BadRequestException('Ein Abschnitt enthält nur Lernthemen.');
    if (depthOf(nodes, parentId) + 1 > MAX_CLASS_DEPTH) throw new BadRequestException(`Höchstens ${MAX_CLASS_DEPTH} Ebenen.`);
    const orderIndex = Math.max(-1, ...nodes.filter((n) => n.parentId === parentId).map((n) => n.orderIndex)) + 1;
    return this.nodeRepo.save(this.nodeRepo.create({ id: crypto.randomUUID(), classId, kind, title, parentId, orderIndex }));
  }

  async renameNode(user: any, classId: string, id: string, title: unknown) {
    await this.classes.ownedClass(classId, user);
    const node = await this.nodeRepo.findOne({ where: { id, classId } });
    if (!node) throw new NotFoundException('Bereich nicht gefunden.');
    const t = String(title || '').trim().slice(0, 200);
    if (!t) throw new BadRequestException('Bitte einen Namen eingeben.');
    node.title = t;
    return this.nodeRepo.save(node);
  }

  /** Bereich/Abschnitt löschen – sein Inhalt rückt eine Ebene höher. */
  async deleteNode(user: any, classId: string, id: string) {
    await this.classes.ownedClass(classId, user);
    const nodes = await this.nodeRepo.find({ where: { classId } });
    if (!nodes.some((n) => n.id === id)) throw new NotFoundException('Bereich nicht gefunden.');
    const places = await this.placeRepo.find({ where: { classId } });
    const moved = dissolve(nodes, places, id);
    for (const n of moved.nodes) await this.nodeRepo.update({ id: n.id }, { parentId: n.parentId, orderIndex: n.orderIndex });
    for (const e of moved.entries) await this.placeRepo.update({ id: e.id }, { nodeId: e.nodeId, orderIndex: e.orderIndex });
    await this.nodeRepo.delete({ id, classId });
    return { success: true };
  }

  /** `{ type: 'node'|'entry', id, parentId, index? }` – Bereich bzw. Lernthema an eine Stelle. */
  async move(user: any, classId: string, body: { type?: string; id?: string; parentId?: string | null; index?: number | null }) {
    const klasse = await this.classes.ownedClass(classId, user);
    const id = String(body?.id || '');
    const parentId = body?.parentId ? String(body.parentId) : null;
    const index = Number.isInteger(body?.index) ? Number(body!.index) : null;
    const nodes = await this.nodeRepo.find({ where: { classId } });
    if (body?.type === 'node') {
      if (!nodes.some((n) => n.id === id)) throw new NotFoundException('Bereich nicht gefunden.');
      const err = nodeMoveError(nodes, id, parentId);
      if (err) throw new BadRequestException(err);
      const order = reorder(nodes.filter((n) => n.parentId === parentId), id, index);
      for (const [nid, orderIndex] of order) await this.nodeRepo.update({ id: nid }, nid === id ? { parentId, orderIndex } : { orderIndex });
      return { success: true };
    }
    const link = await this.linkRepo.findOne({ where: { id, classId: klasse.id } });
    if (!link) throw new NotFoundException('Lernthema nicht gefunden.');
    if (parentId && !nodes.some((n) => n.id === parentId)) throw new NotFoundException('Bereich nicht gefunden.');
    // Zuweisungen ohne Platz (älter als der Baum) bekommen dabei ihren.
    const links = await this.classLinks(klasse);
    const { placeOf } = await this.tree(klasse, links);
    const siblings = links.filter((l) => l.id !== id && placeOf.get(l.id)!.inTree && placeOf.get(l.id)!.nodeId === parentId)
      .map((l) => ({ id: l.id, orderIndex: placeOf.get(l.id)!.order }));
    const order = reorder(siblings, id, index);
    for (const [lid, orderIndex] of order) {
      await this.placeRepo.save(this.placeRepo.create({ id: lid, classId: klasse.id, nodeId: parentId, orderIndex }));
    }
    return { success: true };
  }

  /**
   * Klasseneigenes Lernthema anlegen (nur in diesem Klassennotizbuch): ein
   * Lernthema mit Klassenvermerk und sein Klassenlink. Neue Module darin sind
   * – wie überall im Klassennotizbuch – zunächst ausgeschaltet.
   */
  async createTopic(user: any, classId: string, body: { title?: string; nodeId?: string | null }) {
    const klasse = await this.classes.ownedClass(classId, user);
    const title = String(body?.title || '').trim().slice(0, 200);
    if (!title) throw new BadRequestException('Bitte einen Titel eingeben.');
    const nodeId = await this.nodeOrNull(klasse.id, body?.nodeId);
    const topic = await this.topicRepo.save(this.topicRepo.create({
      id: crypto.randomUUID(), title, ownerId: user.userId, classId: klasse.id, selected: true, visibility: 'locked',
    }));
    const link = await this.linkRepo.save(this.linkRepo.create({
      id: crypto.randomUUID(), name: title, ownerId: user.userId, token: null, examToken: null, contestHostToken: null,
      active: true, modes: ['quiz', 'companion'], selection: [{ topicId: topic.id, all: false, moduleIds: [] }],
      accessPassword: null, singleAttempt: false, tagIds: [], companionSettings: null, contestSettings: null,
      classId: klasse.id, templateId: null, customized: false, quickTopicId: null, quickNodeId: null, classIds: null,
      lastSharedAt: new Date(),
    }));
    await this.placeAtEnd(klasse.id, link.id, nodeId);
    return { topicId: topic.id, linkId: link.id };
  }

  /** Anzeigename einer Zuweisung; beim klasseneigenen Lernthema auch dessen Titel. */
  async renameEntry(user: any, classId: string, linkId: string, title: unknown) {
    const link = await this.ownClassLink(user, classId, linkId);
    const t = String(title || '').trim().slice(0, 200);
    if (!t) throw new BadRequestException('Bitte einen Namen eingeben.');
    link.name = t;
    await this.linkRepo.save(link);
    const own = await this.classTopicIds(classId);
    for (const e of link.selection || []) if (own.has(e.topicId)) await this.topicRepo.update({ id: e.topicId }, { title: t });
    return { success: true };
  }

  /**
   * Zuweisung entfernen; ein klasseneigenes Lernthema samt Modulen löschen.
   * Ergebnisse bleiben (sie tragen ihre Namen selbst).
   */
  async deleteEntry(user: any, classId: string, linkId: string) {
    const link = await this.ownClassLink(user, classId, linkId);
    const own = await this.classTopicIds(classId);
    for (const e of link.selection || []) {
      if (!own.has(e.topicId)) continue;
      await this.moduleRepo.delete({ topicId: e.topicId });
      await this.topicRepo.delete({ id: e.topicId });
    }
    await this.placeRepo.delete({ id: link.id });
    await this.linkRepo.delete({ id: link.id });
    const nb = await this.repo.findOne({ where: { classId } });
    if (nb?.marker?.linkId === link.id) await this.repo.update({ id: nb.id }, { marker: null });
    return { success: true };
  }

  /** 📍 Merker setzen (`{ linkId, topicId, moduleId }`) oder entfernen (`null`/leer). */
  async setMarker(user: any, classId: string, body: Partial<ClassNotebookMarker> | null) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    let marker: ClassNotebookMarker | null = null;
    if (body?.linkId && body.moduleId) {
      const link = await this.ownClassLink(user, classId, String(body.linkId));
      const { topics } = await this.available(link, user);
      const topic = topics.find((t) => t.modules.some((m) => m.id === body.moduleId));
      if (!topic) throw new BadRequestException('Dieses Modul gehört nicht zur Zuweisung.');
      marker = { linkId: link.id, topicId: topic.topicId, moduleId: String(body.moduleId) };
    }
    nb.marker = marker;
    await this.repo.save(nb);
    // 👣 Folgen an: Die Schüler-Geräte springen zum neuen Merker.
    this.live.markerChanged(klasse.id, marker ? { linkId: marker.linkId, moduleId: marker.moduleId, title: '' } : null);
    return { marker };
  }

  /** 📡 Modul bei allen verbundenen Schüler-Geräten öffnen (`{ linkId, moduleId }`). */
  async sendToClass(user: any, classId: string, body: { linkId?: string; moduleId?: string }) {
    const link = await this.ownClassLink(user, classId, String(body?.linkId || ''));
    const { topics } = await this.available(link, user);
    const mod = topics.flatMap((t) => t.modules).find((m) => m.id === body?.moduleId);
    if (!mod) throw new BadRequestException('Dieses Modul gehört nicht zur Zuweisung.');
    const reached = this.live.sendModule(classId, { linkId: link.id, moduleId: mod.id, title: mod.title });
    return { reached };
  }

  /** 👣 Folgen an/aus: Die Schüler-Geräte folgen dem 📍-Merker. */
  async setFollow(user: any, classId: string, on: boolean) {
    const nb = await this.ensure(await this.classes.ownedClass(classId, user));
    const mk = nb.marker ? { linkId: nb.marker.linkId, moduleId: nb.marker.moduleId, title: '' } : null;
    const reached = this.live.setFollow(classId, !!on, mk);
    return { follow: this.live.isFollowing(classId), reached };
  }

  /** Live-Verbindung eines Schüler-Geräts (nach der Anmeldung mit Ausweis). */
  async liveStream(token: string, ticket: unknown, res: Response) {
    const { nb, klasse } = await this.session(token, ticket);
    const mk: LiveTarget | null = nb.marker ? { linkId: nb.marker.linkId, moduleId: nb.marker.moduleId, title: '' } : null;
    this.live.open(klasse.id, res, mk);
  }

  /** Erstanmeldung an (bis Ende des Tages) oder aus. */
  async setFirstLogin(user: any, classId: string, open: boolean) {
    const nb = await this.ensure(await this.classes.ownedClass(classId, user));
    nb.firstLoginUntil = open ? endOfDay() : null;
    await this.repo.save(nb);
    return { firstLoginUntil: nb.firstLoginUntil };
  }

  /** Neuer Klassenbuch-Link – der alte gilt nicht mehr. */
  async renewToken(user: any, classId: string, req?: any) {
    const nb = await this.ensure(await this.classes.ownedClass(classId, user));
    nb.token = crypto.randomBytes(12).toString('base64url');
    nb.code = await this.freeCode();
    await this.repo.save(nb);
    return this.forTeacher(user, classId, req);
  }

  async setTeacherItems(user: any, classId: string, items: unknown) {
    const nb = await this.ensure(await this.classes.ownedClass(classId, user));
    const clean: ClassNotebookItem[] = [];
    for (const it of Array.isArray(items) ? items.slice(0, 200) : []) {
      const type = it?.type === 'node' ? 'node' : it?.type === 'topic' ? 'topic' : null;
      const id = typeof it?.id === 'string' ? it.id.slice(0, 64) : '';
      if (type && id && !clean.some((c) => c.type === type && c.id === id)) clean.push({ type, id });
    }
    nb.teacherItems = clean;
    await this.repo.save(nb);
    return { teacherItems: clean };
  }

  /**
   * Ergebnisübersicht: je Zuweisung (Klassenlink mit Übungsmodus) die Module,
   * je Schüler und Modul erledigt, bester Anteil richtig, Blatt bearbeitet.
   */
  async overview(user: any, classId: string) {
    const klasse = await this.classes.ownedClass(classId, user);
    const students = await this.studentRepo.find({ where: { classId } });
    const links = (await Promise.all((await this.classLinks(klasse)).map((l) => this.linkInfo(l)))).filter((l) => l.practice.length);
    const ids = links.map((l) => l.id);
    const results = ids.length ? await this.resultRepo.find({ where: { classId, linkId: In(ids) }, select: ['id', 'linkId', 'studentId', 'payload'] }) : [];
    const works = await this.workRepo.find({ where: { classId }, select: ['studentId', 'moduleId', 'linkId'] });
    return {
      students: students
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'de'))
        .map((s) => ({ id: s.id, name: s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName, pending: s.status === 'pending' })),
      links: links.map((l) => {
        const units = l.resolved.flatMap((r) => unitsOf(r.modules));
        const cells: Record<string, Record<string, unknown>> = {};
        for (const s of students) {
          const runs = results.filter((r) => r.linkId === l.id && r.studentId === s.id).map((r) => ({ details: (r.payload?.details || []) as DetailLike[] }));
          const mine = new Set(works.filter((w) => w.studentId === s.id && w.linkId === l.id).map((w) => w.moduleId));
          cells[s.id] = unitCells(units, runs, mine);
        }
        return { id: l.id, name: l.name, active: l.active, units: units.map(({ id, title, type }) => ({ id, title, type })), cells };
      }),
    };
  }

  // ---- Schüler ----

  private async byToken(token: string) {
    const nb = token ? await this.repo.findOne({ where: { token } }) : null;
    const klasse = nb ? await this.classes.findById(nb.classId) : null;
    if (!nb || !klasse) throw new NotFoundException('Diesen Klassenbuch-Link gibt es nicht (mehr). Bitte bei der Lehrkraft nachfragen.');
    const owner = klasse.ownerId ? await this.userRepo.findOne({ where: { id: klasse.ownerId } }) : null;
    if (!owner || owner.active === false) throw new ForbiddenException('Dieses Klassennotizbuch ist derzeit gesperrt.');
    return { nb, klasse, owner };
  }

  /** Klassencode (aus der Schüler-App) → Token des Klassenbuch-Links. */
  async byCode(typed: string) {
    const code = normalizeClassCode(typed);
    const nb = code ? await this.repo.findOne({ where: { code } }) : null;
    if (!nb) throw new NotFoundException('Diesen Klassencode gibt es nicht. Bitte genau abschreiben oder bei der Lehrkraft nachfragen.');
    await this.byToken(nb.token); // gesperrt / Klasse weg → wie beim Link
    return { token: nb.token };
  }

  async info(token: string) {
    const { nb, klasse, owner } = await this.byToken(token);
    return { className: klasse.name, teacher: owner.displayName || '', firstLoginOpen: firstLoginOpen(nb.firstLoginUntil) };
  }

  /**
   * Anmeldung mit Name (wie beim Klassenlink) und PIN. Ergebnis: Ausweis für
   * das Klassennotizbuch; `pin`, wenn sie jetzt das erste Mal gezeigt wird.
   */
  async login(token: string, body: { name?: string; pin?: string; testPassword?: string }) {
    const { nb, klasse } = await this.byToken(token);
    const typed = String(body?.name || '').trim().replace(/\s+/g, ' ');
    if (!typed) throw new BadRequestException('Bitte den Namen eingeben.');
    const who = await this.classes.resolveStudent(klasse, typed, body?.testPassword);
    const student = isTestStudent(who.studentId) ? null : await this.studentRepo.findOne({ where: { id: who.studentId, classId: klasse.id } });
    const pin = String(body?.pin ?? '').trim() || undefined;

    if (student && student.status !== 'pending') {
      const locked = pinGuard.lockedFor(student.id);
      if (locked) throw new ForbiddenException({ statusCode: 403, needPin: true, message: `Zu viele falsche PINs – bitte in ${locked} Minute${locked === 1 ? '' : 'n'} noch einmal.` });
    }
    const decision = loginDecision(student, pin, firstLoginOpen(nb.firstLoginUntil), pinMatches);
    if (decision === 'wrong') {
      pinGuard.failed(student!.id);
      throw new ForbiddenException({ statusCode: 403, needPin: true, message: 'Falsche PIN. Vergessen? Die Lehrkraft sieht sie in der Klassenliste.' });
    }
    if (decision === 'need') throw new ForbiddenException({ statusCode: 403, needPin: true, message: 'Bitte deine PIN eingeben.' });
    if (decision === 'closed') {
      throw new ForbiddenException({
        statusCode: 403, needPin: true,
        message: 'Gib deine PIN ein. Kennst du sie noch nicht, frag deine Lehrkraft – sie kann sie dir sagen oder die erste Anmeldung im Unterricht freischalten.',
      });
    }
    let shown: string | undefined;
    if (student && decision === 'show') {
      student.pin = student.pin || newPin();
      student.pinShownAt = new Date();
      await this.studentRepo.update({ id: student.id }, { pin: student.pin, pinShownAt: student.pinShownAt });
      shown = student.pin;
    } else if (student && decision === 'ok' && student.status !== 'pending') {
      pinGuard.passed(student.id);
      // Von der Lehrkraft gesagte PIN: gilt ab jetzt als gesehen.
      if (!student.pinShownAt) await this.studentRepo.update({ id: student.id }, { pinShownAt: new Date() });
    }
    return {
      ticket: issueTicket(classbookTicketKey(klasse.id), who.studentId, who.name),
      name: who.name,
      pending: student?.status === 'pending',
      ...(shown ? { pin: shown } : {}),
    };
  }

  private async session(token: string, ticket: unknown) {
    const { nb, klasse } = await this.byToken(token);
    const t = readTicket(ticket, classbookTicketKey(klasse.id));
    if (!t) throw new ForbiddenException({ statusCode: 403, expired: true, message: 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.' });
    const student = isTestStudent(t.s) ? null : await this.studentRepo.findOne({ where: { id: t.s, classId: klasse.id } });
    if (!student && !isTestStudent(t.s)) throw new ForbiddenException({ statusCode: 403, expired: true, message: 'Dieser Name steht nicht mehr in der Klassenliste.' });
    return { nb, klasse, ticket: t, student };
  }

  /**
   * Startseite des Schülers: Zuweisungen mit Modulen und seinem Stand, dazu
   * seine Ergebnisse und Blätter. Unbestätigte Einträge sehen nur die
   * Zuweisungen – unter ihrem Namen könnte sich jeder anmelden.
   */
  async home(token: string, ticket: unknown) {
    const { nb, klasse, ticket: t, student } = await this.session(token, ticket);
    const confirmed = !!student && student.status !== 'pending';
    const all = await this.classLinks(klasse);
    const active = all.filter((l) => l.active);
    // Ohne eingeschaltetes Modul gibt es für Schüler nichts zu sehen. Die Quiz-Arena
    // erscheint nur, solange die Lehrkraft ihren Wartebereich geöffnet hat (arena).
    const { nodes, placeOf } = await this.tree(klasse, all);
    // Durch den Baum ersetzte Bereichs-Links stehen nicht mehr da – ihre Lernthemen einzeln im Baum.
    const links = (await Promise.all(active.filter((l) => placeOf.get(l.id)?.inTree !== false).map((l) => this.linkInfo(l))))
      .filter((l) => l.practice.length && l.topics.length);
    // Laufende Klassenarbeiten: aktiv und ihr Link ist erzeugt (die Lehrkraft hat ihn ausgegeben).
    const exams = await Promise.all(active.filter((l) => (l.modes || []).includes('exam') && l.examToken).map(async (l) => {
      const attempt = await this.attemptRepo.findOne({ where: { linkId: l.id, studentId: t.s } });
      return { linkId: l.id, name: l.name, state: isTestStudent(t.s) ? 'open' : examState(attempt, l.singleAttempt) };
    }));
    const results = confirmed ? await this.resultRepo.find({ where: { classId: klasse.id, studentId: t.s }, order: { createdAt: 'DESC' } }) : [];
    const works = confirmed
      ? await this.workRepo.find({ where: { classId: klasse.id, studentId: t.s }, select: ['id', 'linkId', 'moduleId', 'moduleTitle', 'access', 'updatedAt'], order: { updatedAt: 'DESC' } })
      : [];
    return {
      className: klasse.name,
      name: t.n,
      arena: this.openArena(active),
      pending: !confirmed && !isTestStudent(t.s),
      exams,
      // Nur, wenn die Schüler das Modul gerade sehen (Zuweisung aktiv, Modul eingeschaltet).
      marker: nb.marker && links.some((l) => l.id === nb.marker!.linkId
        && l.topics.some((tp) => tp.id === nb.marker!.topicId && tp.units.some((u) => u.id === nb.marker!.moduleId))) ? nb.marker : null,
      // Bereiche und Abschnitte wie bei der Lehrkraft; leere blendet die Seite aus.
      nodes: nodes.map(({ id, kind, title, parentId, orderIndex }) => ({ id, kind, title, parentId, orderIndex })),
      assignments: links.map((l) => {
        const runs = results.filter((r) => r.linkId === l.id).map((r) => ({ details: (r.payload?.details || []) as DetailLike[] }));
        const mine = new Set(works.filter((w) => w.linkId === l.id).map((w) => w.moduleId));
        const units = l.resolved.flatMap((r) => unitsOf(r.modules));
        const cells = confirmed ? unitCells(units, runs, mine) : {};
        return {
          linkId: l.id,
          name: l.name,
          ...placeOf.get(l.id),
          modes: l.practice,
          contest: l.contest,
          topics: l.topics.map((tp) => ({ ...tp, units: tp.units.map((u) => ({ ...u, ...(cells[u.id] || {}) })) })),
        };
      }),
      results: results.filter((r) => r.mode !== 'exam').map((r) => ({
        id: r.id, linkName: r.linkName || '', mode: r.mode, score: r.score, maxScore: r.maxScore,
        percentage: r.payload?.percentage ?? null, at: r.createdAt,
      })),
      works: works.filter((w) => w.access !== 'exam').map((w) => ({ linkId: w.linkId, moduleId: w.moduleId, title: w.moduleTitle || 'Dokument', at: w.updatedAt })),
    };
  }

  /**
   * Quiz-Arena, deren Wartebereich die Lehrkraft gerade geöffnet hat – dann
   * sehen die Schüler nur sie. Sonst null.
   */
  private openArena(links: TopicLink[]): { linkId: string; name: string } | null {
    const open = links.find((l) => (l.modes || []).includes('contest') && this.contest.isOpen(l.id));
    return open ? { linkId: open.id, name: open.name } : null;
  }

  /** Für das Nachfragen der Schülerseite: `{ arena }` (siehe openArena). */
  async arena(token: string, ticket: unknown) {
    const { klasse } = await this.session(token, ticket);
    return { arena: this.openArena((await this.classLinks(klasse)).filter((l) => l.active)) };
  }

  /**
   * Eine Zuweisung öffnen: Adresse des Klassenlinks. Den Durchlauf startet
   * dann der gewöhnliche Link-Start mit dem Ausweis des Klassennotizbuchs.
   */
  async enter(token: string, body: { ticket?: string; linkId?: string; exam?: boolean }) {
    const { klasse } = await this.session(token, body?.ticket);
    const link = await this.linkRepo.findOne({ where: { id: String(body?.linkId || ''), classId: klasse.id } });
    if (!link || !link.active) throw new NotFoundException('Diese Aufgabe ist gerade nicht freigegeben.');
    // Klassenarbeit: nur über ihren eigenen Link – den gibt es erst, wenn die Lehrkraft ihn ausgegeben hat.
    if (body?.exam) {
      if (!(link.modes || []).includes('exam') || !link.examToken) throw new NotFoundException('Diese Klassenarbeit ist gerade nicht freigegeben.');
      return { linkToken: link.examToken };
    }
    let linkToken = await this.links.practiceToken(link);
    if (!linkToken) {
      link.token = crypto.randomBytes(12).toString('base64url');
      await this.linkRepo.save(link);
      linkToken = link.token;
    }
    return { linkToken };
  }
}
