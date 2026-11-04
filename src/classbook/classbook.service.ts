import { ShopOffer } from '../core/entities/shop-offer.entity';
import { DocumentVersion } from '../core/entities/document-version.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { HtmlAppState } from '../core/entities/html-app-state.entity';
import { contentOf, hasSolutionBlocks, forStudents } from '../core/public/student-view';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ClassNotebook, ClassNotebookItem } from '../core/entities/class-notebook.entity';
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
import { ClassbookProgress } from '../core/entities/classbook-progress.entity';
import { ancestorsOf, canHoldNode, commonPath, deadMirrorNodes, depthOf, leavesInOrder, nodeMoveError, normalizeMarker, reorder, dissolve, LeafRef, MAX_CLASS_DEPTH, TreeLink, TreeNode, veiledNodeIds } from './classbook-tree';
import { ClassesService } from '../classes/classes.service';
import { LinksService, PRACTICE_MODES, onlyHtmlApps } from '../links/links.service';
import { NotebooksService } from '../notebooks/notebooks.service';
import { issueDeviceTicket, pinTag, issueTicket, readTicket } from '../classes/student-ticket';
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
type OverviewUnit = Unit & { title: string; type: string; quizIds?: string[]; appRoot?: string; appUnit?: string };
function unitsOf(modules: LearningModule[]): OverviewUnit[] {
  return modules.flatMap((m): OverviewUnit[] => {
    const kids: LearningModule[] = (m as any).subModules || [];
    // Eine HTML-App zeigt je Abschnitt eine Spalte.
    if (m.type === 'htmlApp' && kids.length) return kids.map((k) => ({ id: k.id, title: k.title || '', type: k.type, ids: [k.id], appRoot: m.id, appUnit: contentOf(k).unit }));
    return [{ id: m.id, title: m.title || '', type: m.type, ids: [m.id, ...kids.map((s) => s.id)], quizIds: embeddedQuizIds(m) }];
  });
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
    @InjectRepository(ClassbookProgress) private readonly progressRepo: Repository<ClassbookProgress>,
    @InjectRepository(HtmlAppState) private readonly appStateRepo: Repository<HtmlAppState>,
    @InjectRepository(ShopOffer) private readonly offerRepo: Repository<ShopOffer>,
    @InjectRepository(TopicQuickLink) private readonly quickRepo: Repository<TopicQuickLink>,
    @InjectRepository(DocumentVersion) private readonly versionRepo: Repository<DocumentVersion>,
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
      nodes: nodes.map(({ id, kind, title, parentId, orderIndex, sourceNodeId, studentHidden }) => ({
        id, kind, title, parentId: parentId && known.has(parentId) ? parentId : null, orderIndex, sourceNodeId: sourceNodeId || null, studentHidden: !!studentHidden })),
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
      ...(() => {
        // Nur HTML-Apps: immer Quiz (links.service.ts, effectiveModes).
        const exam = (link.modes || []).includes('exam');
        const appsOnly = !exam && onlyHtmlApps(resolved);
        return {
          modes: appsOnly ? ['quiz'] : link.modes || [],
          practice: appsOnly ? ['quiz'] : practiceModes(link),
          exam,
          contest: !appsOnly && (link.modes || []).includes('contest'),
        };
      })(),
      topics: resolved.map((r) => ({ id: r.topic.id, title: r.topic.title, units: unitsOf(r.modules).map(({ id, title, type, quizIds }) => ({ id, title, type, quizIds })) })),
      resolved,
    };
  }

  /** Zuweisungen als `TreeLink[]` für `leavesInOrder` – `nodeId`/`orderIndex` aus `placeOf`. */
  private treeLinksOf(links: Array<{ id: string; topics: Array<{ id: string; units: Array<{ id: string }> }> }>,
    placeOf: Map<string, { nodeId: string | null; order: number }>): TreeLink[] {
    return links.map((l) => ({
      id: l.id,
      nodeId: placeOf.get(l.id)?.nodeId ?? null,
      orderIndex: placeOf.get(l.id)?.order ?? 0,
      topics: l.topics.map((t) => ({ topicId: t.id, moduleIds: t.units.map((u) => u.id) })),
    }));
  }

  /**
   * Bereiche/Abschnitte und Zuweisungen, wie Schüler sie gerade sehen (aktiv,
   * eingetragen, nicht ausgeblendet) – Grundlage für 📍 Merker, „Weiter“ und
   * die Startseite der Schüler (home()).
   */
  private async visibleTree(klasse: StudentClass, nb: ClassNotebook) {
    const all = await this.classLinks(klasse);
    const active = all.filter((l) => l.active);
    const { nodes, placeOf } = await this.tree(klasse, all);
    const { veiledNodes, veiled } = this.veiledLinks(nb, nodes, placeOf, all);
    const links = (await Promise.all(active.filter((l) => placeOf.get(l.id)?.inTree !== false && !veiled.has(l.id)).map((l) => this.linkInfo(l))))
      .filter((l) => l.practice.length && l.topics.length);
    return { nodes, placeOf, veiledNodes, veiled, links };
  }

  // ---- Lehrkraft ----

  /**
   * Zugang für die Schüler, für die Klassenverwaltung: Link, Klassencode, QR-Code.
   * Hat die Klasse noch kein Klassennotizbuch, entsteht hier ein leeres.
   */
  async access(user: any, classId: string, req?: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    const url = `${baseUrl(req)}/?k=${nb.token}`;
    const students = await this.studentRepo.find({ where: { classId }, select: ['id', 'status', 'pinShownAt'] });
    return {
      classId, className: klasse.name, url,
      code: nb.code ? formatClassCode(nb.code) : '',
      qrSvg: await renderQr(url),
      firstLoginUntil: firstLoginOpen(nb.firstLoginUntil) ? nb.firstLoginUntil : null,
      students: {
        confirmed: students.filter((s) => s.status !== 'pending').length,
        pinSeen: students.filter((s) => s.status !== 'pending' && s.pinShownAt).length,
      },
    };
  }

  async forTeacher(user: any, classId: string, req?: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    await this.migrateTeacherItems(user, klasse, nb, req);
    await this.removeDeleted(user, klasse, nb).catch(() => undefined);
    // Aus dem Notizbuch übernommene Bereiche: Neues dort kommt ausgeschaltet nach.
    await this.syncMirrors(user, klasse, req).catch(() => undefined);
    await this.arrangeByNotebook(user, klasse, nb).catch(() => undefined);
    const url = `${baseUrl(req)}/?k=${nb.token}`;
    const students = await this.studentRepo.find({ where: { classId }, select: ['id', 'status', 'pinShownAt'] });
    const raw = await this.classLinks(klasse);
    const { nodes, placeOf } = await this.tree(klasse, raw);
    const own = await this.classTopicIds(klasse.id);
    const { veiled } = this.veiledLinks(nb, nodes, placeOf, raw);
    const links = await Promise.all(raw.map(async (l) => {
      const info = await this.linkInfo(l);
      const ownTopic = (l.selection || []).map((e) => e.topicId).find((id) => own.has(id)) || null;
      const avail = await this.available(l, user);
      const selection = (l.selection || []) as SelEntry[];
      return {
        ...info,
        ...placeOf.get(l.id),
        veiled: veiled.has(l.id),
        // Klasseneigenes Lernthema (nur in diesem Klassennotizbuch) – sonst Verweis aufs Notizbuch.
        classTopicId: ownTopic,
        notReleased: avail.notReleased,
        releasedModuleIds: l.releasedModuleIds || [],
        // Was die Zuweisung enthalten kann, mit Schalter je Lernthema und Modul.
        available: avail.topics.map((t) => {
          const entry = selection.find((e) => e.topicId === t.topicId);
          // Quizze in einem eingeschalteten Dokument kommen mit ihm (siehe LinksService.resolveModules).
          const viaDoc = new Set(t.modules.filter((m) => moduleOn(entry, m)).flatMap((m) => m.embeds));
          return {
            ...t,
            enabled: !!entry && t.modules.some((m) => moduleOn(entry, m)),
            modules: t.modules.map(({ embeds, ...m }) => ({ ...m, quizIds: embeds, enabled: moduleOn(entry, m) || viaDoc.has(m.id), viaDoc: !moduleOn(entry, m) && viaDoc.has(m.id) })),
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
      marker: normalizeMarker(nb.marker),
      studentHidden: !!nb.studentHidden,
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
      ? await this.links.resolveModules(Object.assign(new TopicLink(), link, { selection: ids.map((topicId) => ({ topicId, all: true })) }), { includeOff: true })
      : [];
    const topics = resolved.map((r) => ({
      topicId: r.topic.id,
      title: r.topic.title,
      // Eigene Lernthemen lassen sich von hier aus bearbeiten, erworbene nur ansehen.
      canEdit: r.topic.ownerId === user.userId || user.role === 'admin',
      tagIds: r.topic.tagIds || [],
      // Hauptschalter im Lernnotizbuch: aus heißt für Schüler nirgends erreichbar.
      notebookOff: r.topic.ownerId === link.ownerId && !r.topic.selected && !r.topic.teacherOnly,
      modules: r.modules.map((m) => ({
        id: m.id, title: m.title || '', type: m.type, tagIds: m.tagIds || [],
        notebookOff: r.topic.ownerId === link.ownerId && m.moduleSelected === false,
        subIds: ((m as any).subModules || []).map((x: LearningModule) => x.id),
        embeds: embeddedQuizIds(m),
        hasSolutions: hasSolutionBlocks(m),
        solutionsOn: (link.solutionModuleIds || []).includes(m.id),
      })),
    }));
    // 🔒 Gesperrtes zeigt die Inhaltsübersicht der Lehrkraft mit, Schüler bekommen es nicht.
    for (const l of await this.links.lockedOf(link, ids)) {
      let t: any = topics.find((x) => x.topicId === l.topic.id);
      if (!t && !l.modules.length) continue;
      if (!t) {
        t = { topicId: l.topic.id, title: l.topic.title, canEdit: l.topic.ownerId === user.userId || user.role === 'admin', tagIds: l.topic.tagIds || [], modules: [] };
        topics.push(t);
      }
      t.teacherOnly = !!l.topic.teacherOnly;
      t.lockedModules = l.modules;
      t.mayRelease = l.ownerLink;
    }
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

  /** 🔓 Gesperrtes Modul nur für diese Klasse zeigen, etwa die Klassenarbeit zur Besprechung, oder wieder sperren. */
  async setRelease(user: any, classId: string, linkId: string, body: { moduleId?: string; on?: boolean }) {
    const link = await this.ownClassLink(user, classId, linkId);
    const moduleId = String(body?.moduleId || '');
    const mod = moduleId ? await this.moduleRepo.findOne({ where: { id: moduleId }, select: ['id', 'topicId'] }) : null;
    const topic = mod ? await this.topicRepo.findOne({ where: { id: mod.topicId }, select: ['id', 'ownerId'] }) : null;
    if (!mod || !topic || !(link.selection || []).some((e) => e.topicId === topic.id)) throw new BadRequestException('Dieses Modul gehört nicht zur Zuweisung.');
    if (topic.ownerId !== user.userId) throw new ForbiddenException('Freigeben lässt sich nur, was dir gehört.');
    const set = new Set(link.releasedModuleIds || []);
    if (body?.on) set.add(moduleId); else set.delete(moduleId);
    link.releasedModuleIds = set.size ? [...set] : null;
    await this.linkRepo.save(link);
    // Freigeben heißt auch: einschalten, sonst sähen die Schüler nichts.
    if (body?.on) await this.setItem(user, classId, linkId, { topicId: topic.id, moduleId, enabled: true });
    return { success: true, on: set.has(moduleId) };
  }

  /**
   * Der frühere Bereich „Nur für Lehrer“ zieht einmalig in die Inhaltsübersicht um, in einen für Schüler ausgeblendeten
   * Bereich „Für mich“. Ein eigenes Lernthema, das nirgends bei Schülern im Einsatz ist, bekommt 🔒; alles andere kommt
   * ausgeschaltet dazu, damit keine andere Klasse etwas verliert. Was nicht klappt, bleibt in der Liste und wird beim
   * nächsten Öffnen wieder versucht.
   */
  private async migrateTeacherItems(user: any, klasse: StudentClass, nb: ClassNotebook, req?: any) {
    const items = nb.teacherItems || [];
    if (!items.length) return;
    const left: typeof items = [];
    let nodeId: string | null = null;
    const home = async () => {
      if (nodeId) return nodeId;
      const known = await this.nodeRepo.findOne({ where: { classId: klasse.id, title: 'Für mich', parentId: IsNull() } });
      const orderIndex = (await this.nodeRepo.find({ where: { classId: klasse.id, parentId: IsNull() } })).length;
      const node = known || await this.nodeRepo.save(this.nodeRepo.create({
        id: crypto.randomUUID(), classId: klasse.id, kind: 'area', title: 'Für mich', parentId: null, orderIndex, studentHidden: true,
      } as any) as any);
      nodeId = (node as any).id;
      return nodeId;
    };
    for (const item of items) {
      try {
        const ids = item.type === 'node'
          ? (await this.notebooks.topicsOfNode(item.id, user).then((f: any) => [...(f.included || []), ...(f.notReleased || [])]))
          : [item.id];
        for (const topicId of ids) await this.moveTeacherTopic(user, klasse, topicId, home, req);
      } catch (_) {
        left.push(item);
      }
    }
    nb.teacherItems = left.length ? left : null;
    await this.repo.save(nb);
  }

  private async moveTeacherTopic(user: any, klasse: StudentClass, topicId: string, home: () => Promise<string | null>, req?: any) {
    const topic = await this.topicRepo.findOne({ where: { id: topicId } });
    if (!topic) return; // gelöscht: nichts zu übernehmen
    // Ist es dieser Klasse schon zugewiesen, bleibt es dort, wie es ist.
    const links = await this.linkRepo.find({ where: { ownerId: user.userId } });
    const usedBy = links.filter((l) => (l.selection || []).some((e) => e.topicId === topicId));
    if (usedBy.some((l) => l.classId === klasse.id)) return;
    if (topic.ownerId === user.userId && !topic.teacherOnly && !(await this.usedWithStudents(user, topic, usedBy))) {
      topic.teacherOnly = true;
      await this.topicRepo.save(topic);
    }
    const res = await this.assign(user, klasse.id, { type: 'topic', id: topicId, nodeId: await home() }, req);
    const link = await this.linkRepo.findOne({ where: { id: res.linkId } });
    if (link) {
      link.selection = [{ topicId, all: false, moduleIds: [] }];
      link.customized = true;
      await this.linkRepo.save(link);
    }
  }

  /** Erreicht ein Lernthema heute Schüler? Im Zweifel ja: Dann bekommt es kein 🔒, damit niemandem etwas verschwindet. */
  private async usedWithStudents(user: any, topic: LearningTopic, links: TopicLink[]) {
    if (links.some((l) => l.classId || l.token || l.examToken || l.contestHostToken)) return true;
    if ((topic as any).quickToken) return true;
    if (await this.quickRepo.count({ where: { topicId: topic.id, ownerId: user.userId } })) return true;
    // Angebote im Shop: Bei Bereichen und Auswahlen lässt sich das hier nicht billig klären, also vorsichtig.
    const offers = await this.offerRepo.find({ where: { sellerId: user.userId, active: true }, select: ['id', 'topicId', 'scopeType'] });
    return offers.some((o) => o.scopeType !== 'topic' || o.topicId === topic.id);
  }

  /** 💡 Lösungen eines Dokuments für diese Klasse zeigen oder wieder verbergen. */
  async setSolutions(user: any, classId: string, linkId: string, body: { moduleId?: string; on?: boolean }) {
    const link = await this.ownClassLink(user, classId, linkId);
    const moduleId = String(body?.moduleId || '');
    if (!moduleId) throw new BadRequestException('Modul fehlt.');
    const set = new Set(link.solutionModuleIds || []);
    if (body?.on) set.add(moduleId); else set.delete(moduleId);
    link.solutionModuleIds = set.size ? [...set] : null;
    await this.linkRepo.save(link);
    return { success: true, on: set.has(moduleId) };
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
      // Ohne gewählten Platz: dort, wo das Lernthema im Notizbuch liegt.
      const nodeId = body?.nodeId ? await this.nodeOrNull(klasse.id, body.nodeId) : await this.placeLikeNotebook(user, klasse, [id]);
      await this.placeAtEnd(klasse.id, link.id, nodeId);
    }
    return { linkId: created.id, existed: false, notReleased: created.notReleased || [] };
  }

  /** Pfad von der obersten Ebene bis zu diesem Notizbuch-Knoten. */
  private notebookPath(byId: Map<string, NotebookNode>, nodeId: string | null): NotebookNode[] {
    const path: NotebookNode[] = [];
    for (let n = nodeId ? byId.get(nodeId) : undefined; n; n = n.parentId ? byId.get(n.parentId) : undefined) path.unshift(n);
    return path;
  }

  /**
   * Bereiche und Abschnitte zu einem Notizbuch-Pfad anlegen, ohne das Book
   * (außer die Klasse hat es schon als Bereich). Andere Lernthemen dort kommen
   * dadurch nicht mit, die Knoten wachsen nicht nach.
   */
  private async mirrorPath(klasse: StudentClass, path: NotebookNode[]): Promise<string | null> {
    const have = new Set((await this.nodeRepo.find({ where: { classId: klasse.id } })).map((n) => n.sourceNodeId));
    let parentId: string | null = null;
    for (const n of path) {
      if (n.kind === 'book' && !have.has(n.id)) continue;
      parentId = await this.mirrorNode(klasse.id, n.id, n.title, n.kind === 'section' ? 'section' : 'area', parentId);
    }
    return parentId;
  }

  /** Platz im Klassennotizbuch für diese Lernthemen: wie im Notizbuch, sonst oben. */
  private async placeLikeNotebook(user: any, klasse: StudentClass, topicIds: string[]): Promise<string | null> {
    const nbNodes = await this.nbNodeRepo.find({ where: { ownerId: user.userId } });
    const nbPlaces = await this.nbPlaceRepo.find({ where: { ownerId: user.userId } });
    const path = this.commonNotebookPath(topicIds, new Map(nbNodes.map((n) => [n.id, n])), new Map(nbPlaces.map((p) => [p.topicId, p])));
    return path ? this.mirrorPath(klasse, path) : null;
  }

  /** Gemeinsamer Notizbuch-Pfad; null, wenn keins der Lernthemen im Notizbuch liegt. */
  private commonNotebookPath(topicIds: string[], byId: Map<string, NotebookNode>, nbPlaces: Map<string, NotebookPlacement>): NotebookNode[] | null {
    const paths = topicIds.filter((t) => nbPlaces.has(t)).map((t) => this.notebookPath(byId, nbPlaces.get(t)!.nodeId));
    return paths.length ? commonPath(paths) : null;
  }

  /**
   * Zuweisungen dorthin, wo ihre Lernthemen im Notizbuch liegen. Einmal je Klasse
   * alle, auch selbst einsortierte (`treeArrangedAt`); danach nur noch Links, die
   * noch keinen Platz haben, damit spätere Ordnung der Lehrkraft bleibt. Aus einem
   * für Schüler ausgeblendeten Bereich und in einen solchen hinein wird nichts
   * verschoben: Das änderte, was Schüler sehen.
   */
  private async arrangeByNotebook(user: any, klasse: StudentClass, nb: ClassNotebook, { force = false } = {}): Promise<number> {
    if (klasse.ownerId !== user.userId) return 0;
    const first = force || !nb.treeArrangedAt;
    let moved = 0;
    const links = await this.classLinks(klasse);
    const places = new Map((await this.placeRepo.find({ where: { classId: klasse.id } })).map((p) => [p.id, p]));
    const todo = links.filter((l) => {
      const place = places.get(l.id);
      return !place?.hidden && (first || !place) && practiceModes(l).length > 0;
    });
    if (todo.length) {
      const nbNodes = await this.nbNodeRepo.find({ where: { ownerId: user.userId } });
      const nbPlaces = await this.nbPlaceRepo.find({ where: { ownerId: user.userId } });
      const byId = new Map(nbNodes.map((n) => [n.id, n]));
      const placeOfTopic = new Map(nbPlaces.map((p) => [p.topicId, p]));
      const own = await this.classTopicIds(klasse.id);
      for (const link of todo) {
        const topicIds = (link.selection || []).map((e) => e.topicId).filter((t) => !own.has(t));
        const path = this.commonNotebookPath(topicIds, byId, placeOfTopic);
        if (!path) continue;
        const target = await this.mirrorPath(klasse, path);
        const veiled = veiledNodeIds(await this.nodeRepo.find({ where: { classId: klasse.id } }));
        const current = places.get(link.id)?.nodeId ?? null;
        if ((current && veiled.has(current)) || (target && veiled.has(target))) continue;
        if (places.has(link.id) && current === target) continue;
        await this.placeAtEnd(klasse.id, link.id, target);
        moved++;
      }
      if (first) await this.sortLikeNotebook(klasse, byId, placeOfTopic, links);
    }
    if (first) {
      nb.treeArrangedAt = new Date();
      await this.repo.save(nb);
    }
    return moved;
  }

  /** 🌳 Wie im Notizbuch ordnen: auf Wunsch jederzeit wieder. Nur Plätze und Reihenfolge, kein Inhalt. */
  async arrange(user: any, classId: string) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    return { moved: await this.arrangeByNotebook(user, klasse, nb, { force: true }) };
  }

  /** Geschwister in der Reihenfolge des Notizbuchs; was es dort nicht gibt, dahinter. */
  private async sortLikeNotebook(klasse: StudentClass, byId: Map<string, NotebookNode>, placeOfTopic: Map<string, NotebookPlacement>, links: TopicLink[]) {
    const nodes = await this.nodeRepo.find({ where: { classId: klasse.id } });
    const compare = (a: number[] | null, b: number[] | null, tie: number) => {
      if (!a || !b) return a ? -1 : b ? 1 : tie;
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
      return a.length - b.length || tie;
    };
    const nodeKey = (id: string | null) => (id && byId.has(id) ? this.notebookPath(byId, id).map((n) => n.orderIndex) : null);
    for (const parentId of new Set(nodes.map((n) => n.parentId ?? null))) {
      const siblings = nodes.filter((n) => (n.parentId ?? null) === parentId)
        .sort((a, b) => compare(nodeKey(a.sourceNodeId), nodeKey(b.sourceNodeId), a.orderIndex - b.orderIndex));
      for (const [i, n] of siblings.entries()) if (n.orderIndex !== i) await this.nodeRepo.update({ id: n.id }, { orderIndex: i });
    }
    const places = await this.placeRepo.find({ where: { classId: klasse.id } });
    const linkKey = (id: string) => {
      const p = placeOfTopic.get((links.find((l) => l.id === id)?.selection || [])[0]?.topicId);
      return p ? [p.orderIndex] : null;
    };
    for (const nodeId of new Set(places.map((p) => p.nodeId ?? null))) {
      const siblings = places.filter((p) => (p.nodeId ?? null) === nodeId).sort((a, b) => compare(linkKey(a.id), linkKey(b.id), a.orderIndex - b.orderIndex));
      for (const [i, p] of siblings.entries()) if (p.orderIndex !== i) await this.placeRepo.update({ id: p.id }, { orderIndex: i });
    }
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
    // Ein alter, versteckter Eintrag kommt so auch wieder in den Baum.
    await this.placeRepo.save(this.placeRepo.create({ id: linkId, classId, nodeId, orderIndex, hidden: false }));
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
    return { linkId: null, nodeId, existed: existed && !res.added, added: res.added, notReleased: res.notReleased, present: [...new Set(res.present)] };
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
    opts: { on: boolean; req?: any; preset?: Map<string, SelEntry>; exclude?: string }): Promise<{ added: number; notReleased: string[]; present: string[] }> {
    const node = cbNodeId ? await this.nodeRepo.findOne({ where: { id: cbNodeId, classId: klasse.id } }) : null;
    const tracked = !!node && node.sourceNodeId === sourceId;
    const seen = new Set<string>(tracked ? node!.seen || [] : []);
    let added = 0;
    const notReleased: string[] = [];
    const present: string[] = []; // Lernthemen, die schon im Baum stehen: „Name (in Eintrag)“
    // Unterbereiche und Abschnitte, in der Reihenfolge des Notizbuchs.
    const kids = nbNodes.filter((n) => n.parentId === sourceId).sort((a, b) => a.orderIndex - b.orderIndex);
    // Ausdrücklich zugewiesen (`on`) zählt der ganze Bereich; nur beim stillen Nachwachsen bleibt Entferntes weg.
    for (const kid of kids) {
      if (seen.has(kid.id) && !opts.on) continue;
      seen.add(kid.id);
      const kidId = await this.mirrorNode(klasse.id, kid.id, kid.title, kid.kind === 'section' ? 'section' : 'area', cbNodeId);
      const r = await this.fillMirror(user, klasse, kidId, kid.id, nbNodes, opts);
      added += r.added;
      notReleased.push(...r.notReleased);
      present.push(...r.present);
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
    // Nur was wirklich im Baum steht: Ein alter Bereichs-Link im Hintergrund zählt nicht als vorhanden.
    const hiddenLinks = new Set((await this.placeRepo.find({ where: { classId: klasse.id } })).filter((p) => p.hidden).map((p) => p.id));
    // Auch eine Klassenarbeit oder Quiz-Arena allein steht nicht im Baum.
    const own = await this.classTopicIds(klasse.id);
    const shown = (await this.classLinks(klasse)).filter((l) => l.id !== opts.exclude && !hiddenLinks.has(l.id)
      && (practiceModes(l).length > 0 || (l.selection || []).some((e) => own.has(e.topicId))));
    const inClass = new Map<string, string>();
    for (const l of shown) for (const e of l.selection || []) inClass.set(e.topicId, l.name);
    for (const topicId of topicIds) {
      if (seen.has(topicId) && !opts.on) continue;
      // Gesperrte Lernthemen kommen, sobald sie freigegeben sind.
      if (!ok.has(topicId)) continue;
      seen.add(topicId);
      if (inClass.has(topicId)) { present.push(`${inClass.get(topicId)}`); continue; }
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
      inClass.set(topicId, link.name);
      added++;
    }
    notReleased.push(...startable.notReleased);
    if (tracked) await this.nodeRepo.update({ id: node!.id }, { seen: [...seen] as any });
    return { added, notReleased: [...new Set(notReleased)], present };
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

  /**
   * Im Notizbuch gelöschte Lernthemen verschwinden aus dem Baum: Zuweisungen, deren Lernthemen es alle nicht
   * mehr gibt, und danach leere übernommene Bereiche. Ergebnisse und Blätter der Schüler hängen nicht daran.
   * Es bleiben: was nur ausgeschaltet ist, entzogene Nutzungsrechte (das Lernthema gibt es noch), Klassenarbeiten
   * (Abgaben hängen am Link) und Links auf einen Bereich, der noch besteht (er kann wieder wachsen).
   */
  private async removeDeleted(user: any, klasse: StudentClass, nb: ClassNotebook) {
    if (klasse.ownerId !== user.userId) return;
    const links = await this.classLinks(klasse);
    const templateIds = [...new Set(links.map((l) => l.templateId).filter(Boolean))] as string[];
    const rules = new Map((templateIds.length ? await this.linkRepo.find({ where: { id: In(templateIds) } }) : []).map((r) => [r.id, r]));
    const nbNodes = new Set((await this.nbNodeRepo.find({ where: { ownerId: user.userId } })).map((n) => n.id));
    const offerIds = [...new Set([...rules.values()].map((r) => r.quickNodeId))].filter((id) => id?.startsWith('offer:')) as string[];
    const nodes = await this.nodeRepo.find({ where: { classId: klasse.id } });
    const allOfferIds = [...new Set([...offerIds, ...nodes.map((n) => n.sourceNodeId).filter((id) => id?.startsWith('offer:')) as string[]])].map((id) => id.slice('offer:'.length));
    const offers = new Set((allOfferIds.length ? await this.offerRepo.find({ where: { id: In(allOfferIds) }, select: ['id'] }) : []).map((o) => o.id));
    const sourceAlive = (id: string) => (id.startsWith('offer:') ? offers.has(id.slice('offer:'.length)) : nbNodes.has(id));
    const topicIdsOf = (link: TopicLink) => {
      const rule = link.templateId ? rules.get(link.templateId) : null;
      return [...new Set([rule?.quickTopicId, ...(rule?.selection || []).map((e) => e.topicId), ...(link.selection || []).map((e) => e.topicId)].filter(Boolean))] as string[];
    };
    const allIds = [...new Set(links.flatMap(topicIdsOf))];
    const existing = new Set((allIds.length ? await this.topicRepo.find({ where: { id: In(allIds) }, select: ['id'] }) : []).map((t) => t.id));
    const gone = links.filter((link) => {
      if ((link.modes || []).includes('exam')) return false;
      const rule = link.templateId ? rules.get(link.templateId) : null;
      if (rule?.quickNodeId && sourceAlive(rule.quickNodeId)) return false;
      const ids = topicIdsOf(link);
      return ids.length > 0 && !ids.some((id) => existing.has(id));
    });
    for (const link of gone) {
      await this.placeRepo.delete({ id: link.id });
      await this.linkRepo.delete({ id: link.id });
    }
    const places = await this.placeRepo.find({ where: { classId: klasse.id } });
    const occupied = new Set(places.map((p) => p.nodeId).filter(Boolean)) as Set<string>;
    const dead = deadMirrorNodes(nodes, occupied, sourceAlive);
    if (dead.size) await this.nodeRepo.delete({ id: In([...dead]) });
    const marker = nb.marker as any;
    if ((marker?.linkId && gone.some((l) => l.id === marker.linkId)) || (marker?.nodeId && dead.has(marker.nodeId))) {
      nb.marker = null;
      await this.repo.update({ id: nb.id }, { marker: null });
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
    if (nb?.marker && 'linkId' in nb.marker && nb.marker.linkId === link.id) await this.repo.update({ id: nb.id }, { marker: null });
    return { success: true };
  }

  /**
   * 📍 Merker aufgelöst: das (zuletzt per „Weiter“ erreichte) Modul im Pfad,
   * der Pfad zum Aufklappen und ob es ein weiteres Modul gibt. `null` ohne
   * Merker oder wenn der Pfad gerade kein Modul (mehr) enthält.
   */
  private async resolveMarker(nb: ClassNotebook, klasse: StudentClass, studentId: string, confirmed: boolean,
    tree?: { nodes: TreeNode[]; placeOf: Map<string, { nodeId: string | null; order: number }>; links: Array<{ id: string; topics: Array<{ id: string; units: Array<{ id: string }> }> }> }) {
    const anchor = normalizeMarker(nb.marker);
    if (!anchor) return null;
    const { nodes, placeOf, links } = tree || await this.visibleTree(klasse, nb);
    const treeLinks = this.treeLinksOf(links, placeOf);
    const leaves = leavesInOrder(nodes, treeLinks, anchor);
    if (!leaves.length) return null;
    const progress = confirmed ? await this.progressRepo.findOne({ where: { classId: klasse.id, studentId } }) : null;
    const samePath = progress && JSON.stringify(progress.anchor) === JSON.stringify(anchor);
    const position = samePath ? Math.min(Math.max(progress!.position, 0), leaves.length - 1) : 0;
    const current = leaves[position];
    const nodeId = treeLinks.find((l) => l.id === current.linkId)?.nodeId ?? null;
    const openNodeIds = [...new Set([...(anchor.level === 'node' ? [anchor.nodeId] : []), ...ancestorsOf(nodes, nodeId)])];
    return { anchor, leaves, position, current, openNodeIds, hasNext: position < leaves.length - 1, total: leaves.length };
  }

  /** „Weiter“ im 📍-Pfad, ohne eigenes Fortschreiten: aktueller Stand. */
  async weiter(token: string, ticket: unknown) {
    const { nb, klasse, ticket: t, student } = await this.session(token, ticket);
    const confirmed = !!student && student.status !== 'pending';
    const resolved = await this.resolveMarker(nb, klasse, t.s, confirmed);
    return { current: resolved?.current || null, hasNext: !!resolved?.hasNext };
  }

  /** „Weiter“: einen Schritt im 📍-Pfad vor, gespeichert je Schüler. */
  async advanceWeiter(token: string, ticket: unknown) {
    const { nb, klasse, ticket: t, student } = await this.session(token, ticket);
    if (!student || student.status === 'pending') throw new ForbiddenException('Erst bestätigt – dann zählt der Fortschritt.');
    const resolved = await this.resolveMarker(nb, klasse, t.s, true);
    if (!resolved) return { current: null, hasNext: false };
    const nextPosition = Math.min(resolved.position + 1, resolved.total - 1);
    const row = (await this.progressRepo.findOne({ where: { classId: klasse.id, studentId: t.s } }))
      || this.progressRepo.create({ id: crypto.randomUUID(), classId: klasse.id, studentId: t.s, anchor: resolved.anchor, position: 0 });
    row.anchor = resolved.anchor;
    row.position = nextPosition;
    await this.progressRepo.save(row);
    return { current: resolved.leaves[nextPosition], hasNext: nextPosition < resolved.total - 1 };
  }

  /**
   * 📍 Merker setzen – auf jeder Ebene (`{ level: 'root'|'node'|'link'|'topic'|'module', ... }`,
   * siehe `MarkerAnchor`) – oder entfernen (`null`/`{}`). Schüler springen zum
   * ersten Modul darunter (siehe `leavesInOrder`); „Weiter“ führt von dort
   * durch alle weiteren.
   */
  async setMarker(user: any, classId: string, body: any) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    const anchor = normalizeMarker(body);
    let first: LeafRef | null = null;
    if (anchor) {
      const { nodes, placeOf, links } = await this.visibleTree(klasse, nb);
      const treeLinks = this.treeLinksOf(links, placeOf);
      first = leavesInOrder(nodes, treeLinks, anchor)[0] || null;
      if (!first) throw new BadRequestException('Dort liegt gerade kein Modul – nichts zum Merken.');
    }
    nb.marker = anchor;
    await this.repo.save(nb);
    // 👣 Folgen an: Die Schüler-Geräte springen zum ersten Modul des neuen Merkers.
    this.live.markerChanged(klasse.id, first ? { linkId: first.linkId, moduleId: first.moduleId, title: '' } : null);
    return { marker: anchor };
  }

  /**
   * 🙈 Für Schüler aus- bzw. einblenden: `{ type: 'node', id, hidden }` (Bereich,
   * Abschnitt – mit allem darunter) oder `{ type: 'book', hidden }` (das ganze
   * Klassennotizbuch). Die Module bleiben, wie sie sind.
   */
  async setVisibility(user: any, classId: string, body: { type?: string; id?: string; hidden?: boolean }) {
    const klasse = await this.classes.ownedClass(classId, user);
    const hidden = !!body?.hidden;
    if (body?.type === 'book') {
      const nb = await this.ensure(klasse);
      nb.studentHidden = hidden;
      await this.repo.save(nb);
      return { studentHidden: hidden };
    }
    const node = await this.nodeRepo.findOne({ where: { id: String(body?.id || ''), classId: klasse.id } });
    if (!node) throw new NotFoundException('Bereich bzw. Abschnitt nicht gefunden.');
    node.studentHidden = hidden;
    await this.nodeRepo.save(node);
    return { studentHidden: hidden };
  }

  /** Zuweisungen, die Schüler nicht sehen: ganzes Klassennotizbuch oder ihr Bereich/Abschnitt ausgeblendet. */
  private veiledLinks(nb: ClassNotebook, nodes: Array<{ id: string; kind: 'area' | 'section'; parentId: string | null; orderIndex: number; studentHidden?: boolean }>,
    placeOf: Map<string, { nodeId: string | null }>, links: TopicLink[]) {
    if (nb.studentHidden) return { veiledNodes: new Set(nodes.map((n) => n.id)), veiled: new Set(links.map((l) => l.id)) };
    const veiledNodes = veiledNodeIds(nodes);
    return { veiledNodes, veiled: new Set(links.filter((l) => { const p = placeOf.get(l.id); return !!p?.nodeId && veiledNodes.has(p.nodeId); }).map((l) => l.id)) };
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

  /** Wohin 👣 Folgen führt: das erste Modul unter dem 📍-Merker, auf welcher Ebene er auch sitzt. */
  private async followTarget(klasse: StudentClass, nb: ClassNotebook): Promise<LiveTarget | null> {
    const anchor = normalizeMarker(nb.marker);
    if (!anchor) return null;
    const { nodes, placeOf, links } = await this.visibleTree(klasse, nb);
    const first = leavesInOrder(nodes, this.treeLinksOf(links, placeOf), anchor)[0];
    return first ? { linkId: first.linkId, moduleId: first.moduleId, title: '' } : null;
  }

  /** 👣 Folgen an/aus: Die Schüler-Geräte folgen dem 📍-Merker. */
  async setFollow(user: any, classId: string, on: boolean) {
    const klasse = await this.classes.ownedClass(classId, user);
    const nb = await this.ensure(klasse);
    const reached = this.live.setFollow(classId, !!on, on ? await this.followTarget(klasse, nb) : null);
    return { follow: this.live.isFollowing(classId), reached };
  }

  /** Live-Verbindung eines Schüler-Geräts (nach der Anmeldung mit Ausweis). */
  async liveStream(token: string, ticket: unknown, res: Response) {
    const { nb, klasse } = await this.session(token, ticket);
    this.live.open(klasse.id, res, this.live.isFollowing(klasse.id) ? await this.followTarget(klasse, nb) : null);
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
    // HTML-Apps: geöffnete Abschnitte (ohne den Stand, der kann groß sein).
    const appRoots = [...new Set(links.flatMap((l) => l.resolved.flatMap((r) => unitsOf(r.modules))).map((u) => u.appRoot).filter(Boolean))] as string[];
    const appStates = appRoots.length ? await this.appStateRepo.find({ where: { moduleId: In(appRoots) }, select: ['moduleId', 'studentId', 'opened'] }) : [];
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
          const opened = new Set(units.filter((u) => appStates.some((x) => x.moduleId === u.appRoot && x.studentId === s.id && x.opened?.includes(u.appUnit as string))).map((u) => u.id));
          cells[s.id] = unitCells(units, runs, mine, opened);
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
    return this.loginToClass(nb, klasse, body);
  }

  /** Anmeldung über einen Klassenlink: dieselbe Regel wie im Klassennotizbuch. */
  async loginViaLink(klasse: StudentClass, body: { name?: string; pin?: string; testPassword?: string }) {
    return this.loginToClass(await this.ensure(klasse), klasse, body);
  }

  /** Gemerkte Anmeldung eines Geräts: nur, solange die PIN dieselbe ist und der Schüler in der Klasse steht. */
  async deviceLogin(klasse: StudentClass, raw: unknown) {
    const t = readTicket(raw, classbookTicketKey(klasse.id));
    if (!t) return null;
    if (isTestStudent(t.s)) return t;
    const student = await this.studentRepo.findOne({ where: { id: t.s, classId: klasse.id } });
    if (!student) return null;
    return !t.p || t.p === pinTag(student.pin) ? t : null;
  }

  private async loginToClass(nb: ClassNotebook, klasse: StudentClass, body: { name?: string; pin?: string; testPassword?: string }) {
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
      deviceTicket: issueDeviceTicket(classbookTicketKey(klasse.id), who.studentId, who.name, student?.pin),
      studentId: who.studentId,
      classId: klasse.id,
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
    const { nodes, placeOf, veiledNodes, veiled, links } = await this.visibleTree(klasse, nb);
    // 📍 Merker, auf jeder Ebene: zum (zuletzt per „Weiter“ erreichten) Modul im Pfad, mit dem Pfad zum Aufklappen.
    const resolved = await this.resolveMarker(nb, klasse, t.s, confirmed, { nodes, placeOf, links });
    const marker = resolved ? { anchor: resolved.anchor, current: resolved.current, openNodeIds: resolved.openNodeIds, hasNext: resolved.hasNext } : null;
    // Laufende Klassenarbeiten: aktiv und ihr Link ist erzeugt (die Lehrkraft hat ihn ausgegeben).
    const exams = await Promise.all(active.filter((l) => (l.modes || []).includes('exam') && l.examToken).map(async (l) => {
      const attempt = await this.attemptRepo.findOne({ where: { linkId: l.id, studentId: t.s } });
      return { linkId: l.id, name: l.name, state: isTestStudent(t.s) ? 'open' : examState(attempt, l.singleAttempt) };
    }));
    const results = confirmed ? await this.resultRepo.find({ where: { classId: klasse.id, studentId: t.s }, order: { createdAt: 'DESC' } }) : [];
    const works = confirmed
      ? await this.workRepo.find({ where: { classId: klasse.id, studentId: t.s }, select: ['id', 'linkId', 'moduleId', 'moduleTitle', 'access', 'updatedAt', 'versionId'], order: { updatedAt: 'DESC' } })
      : [];
    const workModuleIds = [...new Set(works.map((w) => w.moduleId))];
    const existingDocs = new Set((workModuleIds.length ? await this.moduleRepo.find({ where: { id: In(workModuleIds) }, select: ['id'] }) : []).map((m) => m.id));
    return {
      className: klasse.name,
      name: t.n,
      arena: this.openArena(active),
      pending: !confirmed && !isTestStudent(t.s),
      exams,
      marker,
      // Bereiche und Abschnitte wie bei der Lehrkraft; leere blendet die Seite aus.
      nodes: nodes.filter((n) => !veiledNodes.has(n.id)).map(({ id, kind, title, parentId, orderIndex }) => ({ id, kind, title, parentId, orderIndex })),
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
      works: works.filter((w) => w.access !== 'exam' && !nb.studentHidden && !veiled.has(w.linkId)).map((w) => ({ linkId: w.linkId, moduleId: w.moduleId, workId: w.id, gone: !existingDocs.has(w.moduleId), viewable: !!w.versionId, title: w.moduleTitle || 'Dokument', at: w.updatedAt })),
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

  /**
   * Eigenes Blatt, dessen Dokument gelöscht ist: die Fassung, die der Schüler vor sich hatte, nur zum Lesen.
   * Lösungen bleiben draußen, denn das 💡 der Klasse hing am gelöschten Modul. Blätter aus Klassenarbeiten gibt es
   * hier nicht, und solange das Dokument besteht, gilt der gewöhnliche Weg mit allen Schaltern.
   */
  async goneWork(token: string, body: { ticket?: string; workId?: string }) {
    const { nb, klasse, ticket: t, student } = await this.session(token, body?.ticket);
    const unavailable = () => new NotFoundException('Dieses Blatt ist nicht mehr verfügbar.');
    if (!student || student.status === 'pending' || nb.studentHidden) throw unavailable();
    const work = await this.workRepo.findOne({ where: { id: String(body?.workId || ''), classId: klasse.id, studentId: t.s } });
    if (!work || work.access === 'exam' || !work.versionId) throw unavailable();
    if (await this.moduleRepo.count({ where: { id: work.moduleId } })) throw unavailable();
    const version = await this.versionRepo.findOne({ where: { id: work.versionId } });
    if (!version || contentOf({ content: version.content }).kind === 'klassenarbeit') throw unavailable();
    return {
      moduleId: work.moduleId,
      title: version.title || work.moduleTitle || 'Dokument',
      content: forStudents({ type: 'document', content: version.content }).content,
      embedded: version.embedded || [],
      data: work.data ?? null,
    };
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
    const { nb, klasse } = await this.session(token, body?.ticket);
    const link = await this.linkRepo.findOne({ where: { id: String(body?.linkId || ''), classId: klasse.id } });
    if (!link || !link.active) throw new NotFoundException('Diese Aufgabe ist gerade nicht freigegeben.');
    // 🙈 In einem ausgeblendeten Bereich: nicht zu öffnen (die Klassenarbeit hat ihren eigenen Weg).
    if (!body?.exam) {
      const { nodes, placeOf } = await this.tree(klasse, [link]);
      if (this.veiledLinks(nb, nodes, placeOf, [link]).veiled.has(link.id)) throw new NotFoundException('Diese Aufgabe ist gerade nicht freigegeben.');
    }
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
