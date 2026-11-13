import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { PlanNode } from '../core/entities/plan-node.entity';
import { PlanEntry } from '../core/entities/plan-entry.entity';
import { DocumentVersion } from '../core/entities/document-version.entity';
import { NotebooksService } from '../notebooks/notebooks.service';
import { PlansService } from '../plans/plans.service';
import { TopicsService } from '../topics/topics.service';
import { docSpec, withBlockIds } from '../worksheets/docspec';
import { subtreeIds } from '../notebooks/notebook-rules';
import { planSubtree } from '../plans/plan-rules';
import { docChanged } from '../core/events/doc-changes';
import { AiBridgeSessionRow } from '../core/entities/ai-bridge-session.entity';
import { collectImages, maskImages, unmaskImages } from './ai-images';
import { AI_QUIZ_TYPES, isAiQuizType, quizFormat, quizProblems, quizTypeName } from './quiz-format';

export interface AiBridgePermissions {
  organize: boolean;
  writeDocs: boolean;
}

export interface AiBridgeScope {
  /** Freigegebene Knoten im Lernnotizbuch (inkl. Unterbaum); '*' = gesamtes eigenes Lernnotizbuch. */
  notebookNodeIds: string[];
  /** Freigegebene Knoten in der Planung (inkl. Unterbaum); '*' = gesamte eigene Planung. */
  planNodeIds: string[];
  /** Darf die KI auch auf Themen unter „Unsortiert“ zugreifen? */
  includeUnsorted: boolean;
  /** Einzelne Lernthemen zusätzlich (z. B. das Lernthema eines Blatts, das neu aufbereitet wird). */
  topicIds?: string[];
  /** Neu aufbereiten: die Dokumente, um die es geht (für Anleitung und Baum). */
  moduleIds?: string[];
  permissions: AiBridgePermissions;
}

export type UndoAction =
  | { kind: 'delete_nb_node'; id: string; label: string }
  | { kind: 'rename_nb_node'; id: string; oldTitle: string; label: string }
  | { kind: 'restore_doc_settings'; id: string; old: any; label: string }
  | { kind: 'move_topic'; topicId: string; oldNodeId: string | null; oldOrderIndex: number; existed: boolean; label: string }
  | { kind: 'delete_plan_node'; id: string; label: string }
  | { kind: 'rename_plan_node'; id: string; oldTitle: string; label: string }
  | { kind: 'delete_plan_entries'; ids: string[]; label: string }
  | { kind: 'restore_plan_entry'; entry: { id: string; ownerId: string; nodeId: string; topicId: string; orderIndex: number }; label: string }
  | { kind: 'delete_topic'; id: string; label: string }
  | { kind: 'delete_module'; topicId: string; moduleId: string; label: string }
  | { kind: 'restore_module'; topicId: string; moduleId: string; oldTitle: string; oldContent: any; label: string };

export interface AiBridgeLogItem {
  at: string;
  op: string;
  summary: string;
}

export interface AiBridgeSession {
  id: string;
  tokenHash: string;
  tokenPreview: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  scope: AiBridgeScope;
  undoStack: UndoAction[];
  log: AiBridgeLogItem[];
  /** `regenerate`: Blatt neu aufbereiten – nur Dokumente überarbeiten. */
  purpose: 'regenerate' | null;
}

export type AiBridgeOp =
  | { op: 'create_notebook_node'; kind: 'book' | 'area' | 'section'; title: string; parentId?: string | null; ref?: string }
  | { op: 'rename_notebook_node'; id: string; title: string }
  | { op: 'set_doc_settings'; id: string; kurs?: string; titelmuster?: string; numbering?: 'tree' | 'flat' | 'off' | 'inherit' }
  | { op: 'move_topic'; topicId: string; targetNodeId: string | null; index?: number | null }
  | { op: 'create_plan_node'; kind: 'folder' | 'plan' | 'area' | 'section'; title: string; parentId?: string | null; ref?: string }
  | { op: 'rename_plan_node'; id: string; title: string }
  | { op: 'link_to_plan'; parentId: string; items: Array<{ type: 'topic' | 'nbnode' | 'plan'; id: string }> }
  | { op: 'remove_plan_entry'; entryId: string }
  | { op: 'create_topic'; title: string; description?: string; targetNodeId?: string | null; ref?: string }
  | { op: 'create_document'; topicId: string; title: string; kind?: 'arbeitsblatt' | 'klassenarbeit' | 'text'; spec: any; ref?: string }
  | { op: 'update_document'; moduleId: string; title?: string; spec?: any; kind?: 'arbeitsblatt' | 'klassenarbeit' | 'text' }
  | { op: 'create_quiz'; topicId: string; type: string; title: string; content: any; ref?: string }
  | { op: 'update_quiz'; moduleId: string; title?: string; content: any };

const DEFAULT_TTL_MINUTES = 60;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 240;
/** So lange nach dem Ablauf lässt sich eine Sitzung noch rückgängig machen. */
const SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const DOC_KINDS = ['arbeitsblatt', 'klassenarbeit', 'text'];
const MAX_REQ_PER_MIN = 60;
const MAX_OPS_PER_SESSION = 200;

/** Wie die KI mit Bildern umgeht (Verweise statt Base64 – siehe ai-images.ts). */
const IMAGE_RULE = '`{"type": "image", "src": "lm-img:…", "width": "8cm", "float": "right"}` – vorhandene Bilder erscheinen beim Lesen als kurze Verweise `lm-img:…`; diese unverändert übernehmen, dann bleibt das Bild erhalten. Neue Bilder als `data:image/png;base64,…`.';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AiBridgeService {
  /** Anfragen je Sitzung in der laufenden Minute – nur im Speicher. */
  private readonly rate = new Map<string, { start: number; count: number }>();

  constructor(
    @InjectRepository(NotebookNode) private readonly nbNodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly nbPlaceRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(PlanNode) private readonly planNodeRepo: Repository<PlanNode>,
    @InjectRepository(PlanEntry) private readonly planEntryRepo: Repository<PlanEntry>,
    @InjectRepository(DocumentVersion) private readonly versionRepo: Repository<DocumentVersion>,
    private readonly notebooks: NotebooksService,
    private readonly plans: PlansService,
    private readonly topics: TopicsService,
    @InjectRepository(AiBridgeSessionRow) private readonly sessionRepo: Repository<AiBridgeSessionRow>,
  ) {}

  // ---- Speichern ----

  private fromRow(r: AiBridgeSessionRow): AiBridgeSession {
    return {
      id: r.id, tokenHash: r.tokenHash, tokenPreview: r.tokenPreview, userId: r.userId,
      createdAt: new Date(r.createdAt).getTime(), expiresAt: new Date(r.expiresAt).getTime(),
      scope: r.scope, undoStack: r.undoStack || [], log: r.log || [], purpose: r.purpose === 'regenerate' ? 'regenerate' : null,
    };
  }

  private async store(s: AiBridgeSession) {
    await this.sessionRepo.save(this.sessionRepo.create({
      id: s.id, tokenHash: s.tokenHash, tokenPreview: s.tokenPreview, userId: s.userId, createdAt: new Date(s.createdAt),
      expiresAt: new Date(s.expiresAt), scope: s.scope, undoStack: s.undoStack, log: s.log, purpose: s.purpose,
    }));
  }

  /** Alte Sitzungen dieser Lehrkraft entfernen (abgelaufen und älter als die Aufbewahrung). */
  private async cleanup(userId: string) {
    const now = Date.now();
    const rows = await this.sessionRepo.find({ where: { userId } });
    for (const r of rows) if (now - new Date(r.expiresAt).getTime() > SESSION_RETENTION_MS) await this.sessionRepo.delete({ id: r.id });
  }

  // ---- Sitzungen verwalten (Lehrkraft) ----

  async createSession(
    user: { userId: string },
    body: {
      ttlMinutes?: number;
      notebookNodeIds?: string[];
      planNodeIds?: string[];
      includeUnsorted?: boolean;
      permissions?: Partial<AiBridgePermissions>;
      baseUrl?: string;
      /** Blatt neu aufbereiten bzw. Quiz überarbeiten: nur diese Module, nur `writeDocs`. */
      regenerateModuleIds?: string[];
      /** Quiz-Formate gleich in die Anleitung (für KIs ohne HTTP-Zugriff). */
      withQuizFormats?: boolean;
    },
  ) {
    await this.cleanup(user.userId);
    const ttl = Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Number(body?.ttlMinutes) || DEFAULT_TTL_MINUTES));
    const rawToken = `lma_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = sha256(rawToken);
    const now = Date.now();

    const nbIds = Array.isArray(body?.notebookNodeIds) ? body.notebookNodeIds.map(String).filter(Boolean) : ['*'];
    const plIds = Array.isArray(body?.planNodeIds) ? body.planNodeIds.map(String).filter(Boolean) : ['*'];

    let scope: AiBridgeScope = {
      notebookNodeIds: nbIds,
      planNodeIds: plIds,
      includeUnsorted: body?.includeUnsorted !== false,
      permissions: {
        organize: body?.permissions?.organize !== false,
        writeDocs: body?.permissions?.writeDocs !== false,
      },
    };
    const regenerate = Array.isArray(body?.regenerateModuleIds) && body.regenerateModuleIds.length > 0;
    let quizRegen = false;
    if (regenerate) {
      const ids = [...new Set(body.regenerateModuleIds!.map(String))].slice(0, 30);
      const mods = await Promise.all(ids.map((id) => this.moduleRepo.findOne({ where: { id } })));
      const topicIds: string[] = [];
      // Entweder Dokumente (neu aufbereiten) oder Quizze (überarbeiten) – je mit eigener Anleitung.
      const quizzes = mods.length > 0 && mods.every((m) => m && isAiQuizType(m.type));
      quizRegen = quizzes;
      for (const m of mods) {
        if (!m || (quizzes ? !isAiQuizType(m.type) : m.type !== 'document')) {
          throw new BadRequestException(`Mit KI überarbeiten geht entweder mit Dokumenten oder mit Quizzen (${AI_QUIZ_TYPES.map(quizTypeName).join(', ')}).`);
        }
        const topic = await this.topicRepo.findOne({ where: { id: m.topicId, ownerId: user.userId } });
        if (!topic) throw new ForbiddenException('Nur eigene Dokumente lassen sich mit der KI neu aufbereiten.');
        if (!topicIds.includes(m.topicId)) topicIds.push(m.topicId);
      }
      scope = { notebookNodeIds: [], planNodeIds: [], includeUnsorted: false, topicIds, moduleIds: ids, permissions: { organize: false, writeDocs: true } };
    }

    const session: AiBridgeSession = {
      id: crypto.randomUUID(),
      tokenHash,
      tokenPreview: `${rawToken.slice(0, 10)}…${rawToken.slice(-4)}`,
      userId: user.userId,
      createdAt: now,
      expiresAt: now + ttl * 60 * 1000,
      scope,
      undoStack: [],
      log: [],
      purpose: regenerate ? 'regenerate' : null,
    };

    await this.store(session);
    const base = String(body?.baseUrl || '').replace(/\/+$/, '') || 'http://localhost:3000';
    const prompt = quizRegen
      ? await this.buildQuizRevisePrompt(session, rawToken, base)
      : regenerate
        ? await this.buildRegeneratePrompt(session, rawToken, base)
        : this.buildTeacherPrompt(session, rawToken, base, await this.scopedTree(session), { quizFormats: !!body?.withQuizFormats });

    return {
      session: this.publicSession(session),
      token: rawToken,
      prompt,
    };
  }

  async listSessions(user: { userId: string }) {
    await this.cleanup(user.userId);
    return (await this.sessionRepo.find({ where: { userId: user.userId } }))
      .map((r) => this.fromRow(r))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => this.publicSession(s));
  }

  async revokeSession(user: { userId: string }, sessionId: string) {
    const s = await this.ownSession(user.userId, sessionId);
    s.expiresAt = Math.min(s.expiresAt, Date.now() - 1);
    await this.store(s);
    return { success: true, session: this.publicSession(s) };
  }

  /** Laufende Sitzung verlängern: ab jetzt `minutes` weiter (höchstens MAX_TTL_MINUTES). */
  async extendSession(user: { userId: string }, sessionId: string, minutes?: number) {
    const s = await this.ownSession(user.userId, sessionId);
    if (s.expiresAt <= Date.now()) throw new BadRequestException('Diese KI-Sitzung ist schon beendet – bitte eine neue erzeugen.');
    const add = Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Number(minutes) || 30));
    s.expiresAt = Math.min(Date.now() + MAX_TTL_MINUTES * 60_000, Math.max(s.expiresAt, Date.now()) + add * 60_000);
    await this.store(s);
    return { success: true, session: this.publicSession(s) };
  }

  async rollbackSession(user: { userId: string }, sessionId: string) {
    const s = await this.ownSession(user.userId, sessionId);
    if (!s.undoStack.length) return { success: true, reverted: 0, session: this.publicSession(s) };

    let reverted = 0;
    const errors: string[] = [];
    while (s.undoStack.length > 0) {
      const action = s.undoStack.pop()!;
      try {
        await this.applyUndo(s.userId, action);
        reverted++;
      } catch (err: any) {
        errors.push(`${action.label}: ${err?.message || 'Fehler beim Zurücksetzen'}`);
      }
    }
    s.log.push({
      at: new Date().toISOString(),
      op: 'rollback',
      summary: `⏪ ${reverted} Änderung${reverted === 1 ? '' : 'en'} rückgängig gemacht.`,
    });
    await this.store(s);
    docChanged(s.userId);
    return { success: errors.length === 0, reverted, errors, session: this.publicSession(s) };
  }

  private async ownSession(userId: string, sessionId: string): Promise<AiBridgeSession> {
    const r = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!r || r.userId !== userId) throw new NotFoundException('KI-Sitzung nicht gefunden.');
    return this.fromRow(r);
  }

  private publicSession(s: AiBridgeSession) {
    const now = Date.now();
    return {
      id: s.id,
      tokenPreview: s.tokenPreview,
      createdAt: new Date(s.createdAt).toISOString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
      active: s.expiresAt > now,
      remainingSeconds: Math.max(0, Math.round((s.expiresAt - now) / 1000)),
      scope: s.scope,
      purpose: s.purpose,
      opsCount: s.undoStack.length,
      canRollback: s.undoStack.length > 0,
      log: s.log,
    };
  }

  // ---- Token-Prüfung (KI-Zugriff) ----

  async authenticateToken(rawToken: string | undefined): Promise<AiBridgeSession> {
    const cleaned = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();
    if (!cleaned || !cleaned.startsWith('lma_')) {
      throw new UnauthorizedException('Ungültiges oder fehlendes KI-Token (erwartet: lma_…).');
    }
    const row = await this.sessionRepo.findOne({ where: { tokenHash: sha256(cleaned) } });
    if (!row) throw new UnauthorizedException('KI-Token nicht gefunden oder bereits gelöscht.');
    const session = this.fromRow(row);
    const now = Date.now();
    if (session.expiresAt <= now) {
      throw new UnauthorizedException('Das KI-Token ist abgelaufen oder wurde beendet. Bitte in LearningModules verlängern oder ein neues erzeugen.');
    }
    const r = this.rate.get(session.id);
    const window = r && now - r.start <= 60_000 ? r : { start: now, count: 0 };
    window.count++;
    this.rate.set(session.id, window);
    if (window.count > MAX_REQ_PER_MIN) {
      throw new ForbiddenException('Zu viele Anfragen pro Minute für dieses KI-Token.');
    }
    return session;
  }

  // ---- Geltungsbereich (Scope) auswerten ----

  private async resolveScopeSets(session: AiBridgeSession) {
    const user = { userId: session.userId };
    const [nbTree, planTree] = await Promise.all([
      this.notebooks.tree(user),
      this.plans.tree(user),
    ]);

    const nbAll = session.scope.notebookNodeIds.includes('*');
    const allowedNbNodes = new Set<string>();
    if (nbAll) {
      for (const n of nbTree.nodes) allowedNbNodes.add(n.id);
    } else {
      for (const rootId of session.scope.notebookNodeIds) {
        if (nbTree.nodes.some((n: any) => n.id === rootId)) {
          for (const id of subtreeIds(nbTree.nodes as any, rootId)) allowedNbNodes.add(id);
        }
      }
    }

    const allowedTopics = new Set<string>();
    for (const p of nbTree.placements) {
      if (p.topicId.startsWith('offer:')) continue;
      if (p.nodeId === null) {
        if (nbAll || session.scope.includeUnsorted) allowedTopics.add(p.topicId);
      } else if (allowedNbNodes.has(p.nodeId)) {
        allowedTopics.add(p.topicId);
      }
    }
    // Einzeln freigegebene Lernthemen (nur eigene; geprüft beim Erzeugen und beim Lesen über ownerId).
    for (const id of session.scope.topicIds || []) allowedTopics.add(id);

    const planAll = session.scope.planNodeIds.includes('*');
    const allowedPlanNodes = new Set<string>();
    if (planAll) {
      for (const n of planTree.nodes) allowedPlanNodes.add(n.id);
    } else {
      for (const rootId of session.scope.planNodeIds) {
        if (planTree.nodes.some((n: any) => n.id === rootId)) {
          for (const id of planSubtree(planTree.nodes as any, rootId)) allowedPlanNodes.add(id);
        }
      }
    }

    return { nbTree, planTree, nbAll, planAll, allowedNbNodes, allowedTopics, allowedPlanNodes };
  }

  async scopedTree(session: AiBridgeSession) {
    const { nbTree, planTree, allowedNbNodes, allowedTopics, allowedPlanNodes } = await this.resolveScopeSets(session);

    const nbNodes = nbTree.nodes
      .filter((n: any) => allowedNbNodes.has(n.id))
      .map((n: any) => ({ id: n.id, kind: n.kind, title: n.title, parentId: n.parentId && allowedNbNodes.has(n.parentId) ? n.parentId : null, orderIndex: n.orderIndex }));

    const topicsById = new Map<string, any>();
    for (const t of nbTree.topics || []) topicsById.set(t.id, t);

    // Einzeln freigegebene Lernthemen ohne Platz im Notizbuch stehen wie „Unsortiert“ da.
    const placed = new Set(nbTree.placements.map((p: any) => p.topicId));
    const loose = (session.scope.topicIds || []).filter((id) => !placed.has(id)).map((topicId) => ({ topicId, nodeId: null, orderIndex: 0 }));
    const placements = [...nbTree.placements, ...loose]
      .filter((p: any) => allowedTopics.has(p.topicId))
      .map((p: any) => {
        const t = topicsById.get(p.topicId);
        return {
          topicId: p.topicId,
          nodeId: p.nodeId && allowedNbNodes.has(p.nodeId) ? p.nodeId : null,
          orderIndex: p.orderIndex,
          title: t?.title || 'Lernthema',
          description: t?.description || '',
          modules: (t?.modules || []).map((m: any) => ({ id: m.id, type: m.type, title: m.title, orderIndex: m.orderIndex })),
        };
      });

    const planNodes = planTree.nodes
      .filter((n: any) => allowedPlanNodes.has(n.id))
      .map((n: any) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        parentId: n.parentId && allowedPlanNodes.has(n.parentId) ? n.parentId : null,
        orderIndex: n.orderIndex,
        refId: n.refId || null,
      }));

    const planEntries = planTree.entries
      .filter((e: any) => allowedPlanNodes.has(e.nodeId))
      .map((e: any) => ({
        id: e.id,
        nodeId: e.nodeId,
        topicId: e.topicId,
        topicTitle: topicsById.get(e.topicId)?.title || planTree.topics?.find((t: any) => t.id === e.topicId)?.title || e.topicId,
        orderIndex: e.orderIndex,
      }));

    return {
      permissions: session.scope.permissions,
      expiresAt: new Date(session.expiresAt).toISOString(),
      notebook: {
        allowRootCreation: session.scope.notebookNodeIds.includes('*'),
        nodes: nbNodes,
        topics: placements,
      },
      plans: {
        allowRootCreation: session.scope.planNodeIds.includes('*'),
        nodes: planNodes,
        entries: planEntries,
      },
    };
  }

  async getScopedTopic(session: AiBridgeSession, topicId: string) {
    const { allowedTopics } = await this.resolveScopeSets(session);
    if (!allowedTopics.has(topicId)) {
      throw new ForbiddenException('Dieses Lernthema liegt außerhalb des für das KI-Token freigegebenen Bereichs.');
    }
    const topic = await this.topicRepo.findOne({ where: { id: topicId, ownerId: session.userId } });
    if (!topic) throw new NotFoundException('Lernthema nicht gefunden.');
    const modules = await this.moduleRepo.find({ where: { topicId: topic.id }, order: { orderIndex: 'ASC' } });
    return {
      id: topic.id,
      title: topic.title,
      description: topic.description || '',
      // Eingebettete Bilder als `lm-img:`-Verweise (ai-images.ts) – unverändert zurückschreiben, dann bleiben sie.
      modules: modules.map((m) => {
        const { value, images } = maskImages(this.parsed(m.content));
        return { id: m.id, type: m.type, title: m.title, description: m.description || '', orderIndex: m.orderIndex, content: value, images };
      }),
    };
  }

  private parsed(content: any) {
    if (typeof content !== 'string') return content;
    try { return JSON.parse(content); } catch { return content; }
  }

  /** Ein Dokument zum Neuaufbereiten: DocSpec mit Bild-Verweisen, Art, Titel. */
  async getScopedDocument(session: AiBridgeSession, moduleId: string) {
    const mod = await this.moduleRepo.findOne({ where: { id: moduleId } });
    if (!mod || mod.type !== 'document') throw new NotFoundException('Dokument nicht gefunden.');
    const { allowedTopics } = await this.resolveScopeSets(session);
    if (!allowedTopics.has(mod.topicId)) throw new ForbiddenException('Dieses Dokument liegt außerhalb des für das KI-Token freigegebenen Bereichs.');
    const content = this.parsed(mod.content) || {};
    const { value, images } = maskImages(content.spec ?? content);
    return { id: mod.id, topicId: mod.topicId, title: mod.title, kind: content.kind || 'arbeitsblatt', spec: value, images };
  }

  /**
   * `lm-img:`-Verweise einer DocSpec wieder durch die Bilder ersetzen – aus den
   * Dokumenten des Lernthemas (dort lagen sie, als die KI sie gelesen hat).
   */
  private async restoreImages(spec: any, topicId: string, index: number, label: string) {
    if (!JSON.stringify(spec ?? null).includes('lm-img:')) return spec;
    const mods = await this.moduleRepo.find({ where: { topicId } });
    const known = collectImages(mods.map((m) => this.parsed(m.content)));
    const { value, unknown } = unmaskImages(spec, known);
    if (unknown.length) {
      throw new BadRequestException(`operations[${index}] (${label}): Unbekannte Bild-Verweise ${unknown.join(', ')} – nur Verweise aus diesem Lernthema übernehmen oder neue Bilder als data:image/png;base64,… einfügen.`);
    }
    return value;
  }

  // ---- Batch-Operationen (Sortieren, Projektieren in Pläne, Dokumente anlegen/ändern) ----

  async executeBatchByTeacher(user: { userId: string }, sessionId: string, body: { dryRun?: boolean; operations?: AiBridgeOp[] }) {
    const session = await this.ownSession(user.userId, sessionId);
    // Von der Lehrkraft selbst eingefügt: ihre Handlung – die Rechte der KI gelten nicht, die Reichweite schon.
    return this.executeBatch(session, body, { byTeacher: true });
  }

  /** Auch wenn mittendrin etwas scheitert: Was schon geändert ist, bleibt rückgängig machbar. */
  async executeBatch(session: AiBridgeSession, body: { dryRun?: boolean; operations?: AiBridgeOp[] }, opts: { byTeacher?: boolean } = {}) {
    const before = session.undoStack.length;
    try {
      return await this.runBatch(session, body, !!opts.byTeacher);
    } finally {
      if (session.undoStack.length !== before) {
        await this.store(session);
        docChanged(session.userId);
      }
    }
  }

  private async runBatch(session: AiBridgeSession, body: { dryRun?: boolean; operations?: AiBridgeOp[] }, byTeacher: boolean) {
    const ops = Array.isArray(body?.operations) ? body.operations : [];
    if (!ops.length) throw new BadRequestException('operations: Mindestens eine Operation erforderlich.');
    if (session.undoStack.length + ops.length > MAX_OPS_PER_SESSION) {
      throw new BadRequestException(`Maximal ${MAX_OPS_PER_SESSION} Operationen pro KI-Sitzung erlaubt.`);
    }

    const dryRun = !!body?.dryRun;
    const scopeSets = await this.resolveScopeSets(session);
    const user = { userId: session.userId };
    const refs = new Map<string, string>(); // Symbolische Referenzen wie "$neu_1" -> echte UUID
    const resolveRef = (id: string | null | undefined): string | null => {
      if (!id) return null;
      const s = String(id).trim();
      if (s.startsWith('$')) {
        const mapped = refs.get(s);
        if (!mapped) throw new BadRequestException(`Unbekannte symbolische Referenz „${s}“ – sie muss in einer vorherigen Operation als "ref": "${s}" definiert werden.`);
        return mapped;
      }
      return s;
    };

    // Quiz-Blöcke im Dokument dürfen auf ein Quiz desselben Aufrufs zeigen: { "type": "quiz", "module": "$q1" }.
    const resolveQuizRefs = (spec: any): any => {
      const walk = (v: any): any => {
        if (Array.isArray(v)) return v.map(walk);
        if (!v || typeof v !== 'object') return v;
        const out: any = {};
        for (const [k, x] of Object.entries(v)) out[k] = walk(x);
        if (out.type === 'quiz' && typeof out.module === 'string' && out.module.startsWith('$')) out.module = resolveRef(out.module);
        return out;
      };
      return walk(spec);
    };

    const results: Array<{ index: number; op: string; ok: boolean; id?: string; summary: string }> = [];

    for (let i = 0; i < ops.length; i++) {
      const item = ops[i];
      if (!item || typeof item !== 'object' || !item.op) {
        throw new BadRequestException(`operations[${i}]: Feld "op" fehlt.`);
      }
      // Neu aufbereiten: nur die freigegebenen Dokumente bzw. Quizze überschreiben – nichts anlegen, nichts umräumen.
      if (session.purpose === 'regenerate' && (!['update_document', 'update_quiz'].includes(item.op) || !(session.scope.moduleIds || []).includes(String((item as any).moduleId)))) {
        throw new ForbiddenException(`operations[${i}] (${item.op}): In dieser Sitzung geht nur update_document bzw. update_quiz für die freigegebenen Module.`);
      }

      switch (item.op) {
        case 'create_notebook_node': {
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const parentId = resolveRef(item.parentId);
          if (parentId) {
            if (!scopeSets.allowedNbNodes.has(parentId)) throw new ForbiddenException(`operations[${i}]: Zielknoten „${parentId}“ ist nicht im freigegebenen Lernnotizbuch-Bereich.`);
          } else if (!scopeSets.nbAll) {
            throw new ForbiddenException(`operations[${i}]: Neue Books auf oberster Ebene sind in dieser Sitzung nicht freigegeben.`);
          }
          if (dryRun) {
            const fakeId = `dry_nb_${i}`;
            if (item.ref) refs.set(item.ref, fakeId);
            // Wie beim echten Lauf: Folgeschritte dürfen in den neuen Ordner (sonst scheitert der Probelauf daran).
            scopeSets.allowedNbNodes.add(fakeId);
            results.push({ index: i, op: item.op, ok: true, id: fakeId, summary: `[Vorschau] Notizbuch-${item.kind} „${item.title}“ anlegen` });
            break;
          }
          const created = await this.notebooks.createNode(user, { kind: item.kind, title: item.title, parentId });
          scopeSets.allowedNbNodes.add(created.id);
          if (item.ref) refs.set(item.ref, created.id);
          const summary = `Notizbuch-Ordner „${item.title}“ (${item.kind}) angelegt`;
          session.undoStack.push({ kind: 'delete_nb_node', id: created.id, label: summary });
          session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          results.push({ index: i, op: item.op, ok: true, id: created.id, summary });
          break;
        }

        case 'rename_notebook_node': {
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const id = resolveRef(item.id)!;
          if (!scopeSets.allowedNbNodes.has(id)) throw new ForbiddenException(`operations[${i}]: Knoten „${id}“ ist nicht freigegeben.`);
          const node = await this.nbNodeRepo.findOne({ where: { id, ownerId: session.userId } });
          if (!node) throw new NotFoundException(`operations[${i}]: Knoten „${id}“ nicht gefunden.`);
          const summary = `Notizbuch-Ordner „${node.title}“ → „${item.title}“ umbenannt`;
          if (!dryRun) {
            const oldTitle = node.title;
            await this.notebooks.updateNode(id, user, { title: item.title });
            session.undoStack.push({ kind: 'rename_nb_node', id, oldTitle, label: summary });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, id, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        case 'set_doc_settings': {
          // Kurs, Kopfzeile und 🔢 Nummerierung eines Ordners (numbering.ts) – die übrigen Einstellungen bleiben.
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const id = resolveRef(item.id)!;
          if (!scopeSets.allowedNbNodes.has(id)) throw new ForbiddenException(`operations[${i}]: Knoten „${id}“ ist nicht freigegeben.`);
          const node = await this.nbNodeRepo.findOne({ where: { id, ownerId: session.userId } });
          if (!node) throw new NotFoundException(`operations[${i}]: Knoten „${id}“ nicht gefunden.`);
          if (item.numbering !== undefined && !['tree', 'flat', 'off', 'inherit'].includes(String(item.numbering))) {
            throw new BadRequestException(`operations[${i}]: numbering: tree (gegliedert), flat (durchgezählt), off oder inherit (wie darüber).`);
          }
          const body: Record<string, unknown> = {};
          for (const k of ['kurs', 'titelmuster', 'numbering'] as const) if (item[k] !== undefined) body[k] = item[k];
          if (!Object.keys(body).length) throw new BadRequestException(`operations[${i}]: kurs, titelmuster oder numbering angeben.`);
          const what = [body.kurs !== undefined && `Kurs „${body.kurs}“`, body.numbering && `Nummerierung ${body.numbering}`, body.titelmuster !== undefined && 'Kopfzeile'].filter(Boolean).join(', ');
          const summary = `Notizbuch-Ordner „${node.title}“: ${what}`;
          if (!dryRun) {
            const old = node.docSettings ? structuredClone(node.docSettings) : null;
            await this.notebooks.updateDocSettings(id, user, body);
            session.undoStack.push({ kind: 'restore_doc_settings', id, old, label: summary });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, id, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        case 'move_topic': {
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const topicId = resolveRef(item.topicId)!;
          const targetNodeId = resolveRef(item.targetNodeId);
          if (!scopeSets.allowedTopics.has(topicId)) {
            throw new ForbiddenException(`operations[${i}]: Lernthema „${topicId}“ ist nicht im freigegebenen Bereich.`);
          }
          if (targetNodeId && !scopeSets.allowedNbNodes.has(targetNodeId)) {
            throw new ForbiddenException(`operations[${i}]: Zielordner „${targetNodeId}“ ist nicht im freigegebenen Bereich.`);
          }
          const existingPlace = await this.nbPlaceRepo.findOne({ where: { ownerId: session.userId, topicId } });
          const oldNodeId = existingPlace?.nodeId ?? null;
          const oldOrderIndex = existingPlace?.orderIndex ?? 0;
          const existed = !!existingPlace;
          const topic = await this.topicRepo.findOne({ where: { id: topicId } });
          const summary = `Lernthema „${topic?.title || topicId}“ verschoben`;
          if (!dryRun) {
            await this.notebooks.move(user, { type: 'topic', id: topicId, parentId: targetNodeId, index: item.index ?? null });
            session.undoStack.push({
              kind: 'move_topic',
              topicId,
              oldNodeId,
              oldOrderIndex,
              existed,
              label: summary,
            });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, id: topicId, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        case 'create_plan_node': {
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const parentId = resolveRef(item.parentId);
          if (parentId) {
            if (!scopeSets.allowedPlanNodes.has(parentId)) throw new ForbiddenException(`operations[${i}]: Planknoten „${parentId}“ ist nicht im freigegebenen Planungsbereich.`);
          } else if (!scopeSets.planAll) {
            throw new ForbiddenException(`operations[${i}]: Anlegen auf oberster Planungsebene ist in dieser Sitzung nicht freigegeben.`);
          }
          if (dryRun) {
            const fakeId = `dry_pl_${i}`;
            if (item.ref) refs.set(item.ref, fakeId);
            scopeSets.allowedPlanNodes.add(fakeId);
            results.push({ index: i, op: item.op, ok: true, id: fakeId, summary: `[Vorschau] Planungsknoten „${item.title}“ (${item.kind}) anlegen` });
            break;
          }
          const created = await this.plans.createNode(user, { kind: item.kind, title: item.title, parentId });
          scopeSets.allowedPlanNodes.add(created.id);
          if (item.ref) refs.set(item.ref, created.id);
          const summary = `Planungsknoten „${item.title}“ (${item.kind}) angelegt`;
          session.undoStack.push({ kind: 'delete_plan_node', id: created.id, label: summary });
          session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          results.push({ index: i, op: item.op, ok: true, id: created.id, summary });
          break;
        }

        case 'rename_plan_node': {
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const id = resolveRef(item.id)!;
          if (!scopeSets.allowedPlanNodes.has(id)) throw new ForbiddenException(`operations[${i}]: Planknoten „${id}“ ist nicht freigegeben.`);
          const node = await this.planNodeRepo.findOne({ where: { id, ownerId: session.userId } });
          if (!node) throw new NotFoundException(`operations[${i}]: Planknoten „${id}“ nicht gefunden.`);
          const summary = `Planungsknoten „${node.title}“ → „${item.title}“ umbenannt`;
          if (!dryRun) {
            const oldTitle = node.title;
            await this.plans.renameNode(user, id, item.title);
            session.undoStack.push({ kind: 'rename_plan_node', id, oldTitle, label: summary });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, id, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        case 'link_to_plan': {
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const parentId = resolveRef(item.parentId)!;
          if (!parentId || !scopeSets.allowedPlanNodes.has(parentId)) {
            throw new ForbiddenException(`operations[${i}]: Planungsziel „${parentId}“ ist nicht freigegeben.`);
          }
          const resolvedItems = (item.items || []).map((it) => {
            const id = resolveRef(it.id)!;
            if (it.type === 'topic' && !scopeSets.allowedTopics.has(id)) {
              throw new ForbiddenException(`operations[${i}]: Lernthema „${id}“ ist nicht freigegeben.`);
            }
            if (it.type === 'nbnode' && !scopeSets.allowedNbNodes.has(id)) {
              throw new ForbiddenException(`operations[${i}]: Notizbuch-Knoten „${id}“ ist nicht freigegeben.`);
            }
            if (it.type === 'plan' && !scopeSets.allowedPlanNodes.has(id)) {
              throw new ForbiddenException(`operations[${i}]: Plan „${id}“ ist nicht freigegeben.`);
            }
            return { type: it.type, id };
          });
          if (!resolvedItems.length) throw new BadRequestException(`operations[${i}]: items ist leer.`);
          const summary = `${resolvedItems.length} Verweis${resolvedItems.length === 1 ? '' : 'e'} in Plan eingetragen`;
          if (!dryRun) {
            const beforeEntries = await this.planEntryRepo.find({ where: { ownerId: session.userId } });
            const beforeNodes = await this.planNodeRepo.find({ where: { ownerId: session.userId } });
            const beforeEntryIds = new Set(beforeEntries.map((e) => e.id));
            const beforeNodeIds = new Set(beforeNodes.map((n) => n.id));
            await this.plans.add(user, { parentId, items: resolvedItems });
            const afterEntries = await this.planEntryRepo.find({ where: { ownerId: session.userId } });
            const afterNodes = await this.planNodeRepo.find({ where: { ownerId: session.userId } });
            const newEntryIds = afterEntries.filter((e) => !beforeEntryIds.has(e.id)).map((e) => e.id);
            const newNodeIds = afterNodes.filter((n) => !beforeNodeIds.has(n.id)).map((n) => n.id);
            for (const nid of newNodeIds) scopeSets.allowedPlanNodes.add(nid);
            if (newEntryIds.length) session.undoStack.push({ kind: 'delete_plan_entries', ids: newEntryIds, label: summary });
            for (const nid of newNodeIds) session.undoStack.push({ kind: 'delete_plan_node', id: nid, label: summary });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        case 'remove_plan_entry': {
          this.requirePerm(session, byTeacher, 'organize', i, item.op);
          const entry = await this.planEntryRepo.findOne({ where: { id: String(item.entryId || ''), ownerId: session.userId } });
          if (!entry || !scopeSets.allowedPlanNodes.has(entry.nodeId)) {
            throw new ForbiddenException(`operations[${i}]: Plan-Verweis „${item.entryId}“ nicht gefunden oder nicht freigegeben.`);
          }
          const summary = `Plan-Verweis entfernt`;
          if (!dryRun) {
            const snapshot = { id: entry.id, ownerId: entry.ownerId, nodeId: entry.nodeId, topicId: entry.topicId, orderIndex: entry.orderIndex };
            await this.plans.deleteEntry(user, entry.id);
            session.undoStack.push({ kind: 'restore_plan_entry', entry: snapshot, label: summary });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, id: entry.id, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        case 'create_topic': {
          this.requirePerm(session, byTeacher, 'writeDocs', i, item.op);
          const targetNodeId = resolveRef(item.targetNodeId);
          if (targetNodeId && !scopeSets.allowedNbNodes.has(targetNodeId)) {
            throw new ForbiddenException(`operations[${i}]: Zielknoten „${targetNodeId}“ ist nicht freigegeben.`);
          }
          if (!targetNodeId && !scopeSets.nbAll && !scopeSets.allowedNbNodes.size && !session.scope.includeUnsorted) {
            throw new ForbiddenException(`operations[${i}]: Bitte einen freigegebenen targetNodeId angeben.`);
          }
          const title = String(item.title || '').trim().slice(0, 120);
          if (!title) throw new BadRequestException(`operations[${i}]: title fehlt.`);
          if (dryRun) {
            const fakeId = `dry_topic_${i}`;
            if (item.ref) refs.set(item.ref, fakeId);
            scopeSets.allowedTopics.add(fakeId);
            results.push({ index: i, op: item.op, ok: true, id: fakeId, summary: `[Vorschau] Lernthema „${title}“ anlegen` });
            break;
          }
          const created = (await this.topics.create(user, { title, description: String(item.description || '').trim() })) as unknown as LearningTopic;
          scopeSets.allowedTopics.add(created.id);
          if (targetNodeId) {
            await this.notebooks.move(user, { type: 'topic', id: created.id, parentId: targetNodeId, index: null });
          }
          if (item.ref) refs.set(item.ref, created.id);
          const summary = `Lernthema „${title}“ angelegt`;
          session.undoStack.push({ kind: 'delete_topic', id: created.id, label: summary });
          session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          results.push({ index: i, op: item.op, ok: true, id: created.id, summary });
          break;
        }

        case 'create_document': {
          this.requirePerm(session, byTeacher, 'writeDocs', i, item.op);
          const topicId = resolveRef(item.topicId)!;
          if (!topicId || !scopeSets.allowedTopics.has(topicId)) {
            throw new ForbiddenException(`operations[${i}]: Lernthema „${topicId}“ ist nicht im freigegebenen Bereich.`);
          }
          const title = String(item.title || '').trim().slice(0, 200);
          if (!title) throw new BadRequestException(`operations[${i}]: title fehlt.`);
          // Neues Lernthema im Probelauf: dort gibt es noch keine Bilder.
          if (!topicId.startsWith('dry_')) item.spec = await this.restoreImages(item.spec, topicId, i, `create_document „${title}“`);
          item.spec = resolveQuizRefs(item.spec);
          const errors = docSpec().validateDocSpec(item.spec);
          if (errors.length) {
            throw new BadRequestException(`operations[${i}] (create_document „${title}“): Ungültige DocSpec – ${errors.join(' · ')}`);
          }
          const summary = `Dokument „${title}“ angelegt`;
          if (dryRun) {
            const fakeId = `dry_doc_${i}`;
            if (item.ref) refs.set(item.ref, fakeId);
            results.push({ index: i, op: item.op, ok: true, id: fakeId, summary: `[Vorschau] ${summary}` });
            break;
          }
          const kind = ['arbeitsblatt', 'klassenarbeit', 'text'].includes(String(item.kind)) ? item.kind : 'arbeitsblatt';
          const saved = await this.topics.addModule(topicId, user, {
            type: 'document',
            title,
            moduleSelected: true,
            content: withBlockIds({ kind, spec: item.spec }),
          } as any);
          if (item.ref) refs.set(item.ref, saved.id);
          session.undoStack.push({ kind: 'delete_module', topicId, moduleId: saved.id, label: summary });
          session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          results.push({ index: i, op: item.op, ok: true, id: saved.id, summary });
          break;
        }

        case 'update_document': {
          this.requirePerm(session, byTeacher, 'writeDocs', i, item.op);
          const moduleId = resolveRef(item.moduleId)!;
          const mod = moduleId ? await this.moduleRepo.findOne({ where: { id: moduleId } }) : null;
          if (!mod || mod.type !== 'document') throw new NotFoundException(`operations[${i}]: Dokument-Modul „${moduleId}“ nicht gefunden.`);
          if (!scopeSets.allowedTopics.has(mod.topicId)) {
            throw new ForbiddenException(`operations[${i}]: Dokument „${mod.title}“ liegt außerhalb des freigegebenen Bereichs.`);
          }
          if (item.kind !== undefined && !DOC_KINDS.includes(item.kind)) {
            throw new BadRequestException(`operations[${i}] (update_document „${mod.title}“): kind: ${DOC_KINDS.join(' | ')}.`);
          }
          // Ohne spec bleibt der Inhalt, wie er ist (z. B. nur die Dokument-Art umstellen).
          if (item.spec === undefined && item.kind === undefined && !item.title) {
            throw new BadRequestException(`operations[${i}] (update_document „${mod.title}“): spec, kind oder title fehlt.`);
          }
          if (item.spec !== undefined) {
            item.spec = resolveQuizRefs(await this.restoreImages(item.spec, mod.topicId, i, `update_document „${mod.title}“`));
            const errors = docSpec().validateDocSpec(item.spec);
            if (errors.length) {
              throw new BadRequestException(`operations[${i}] (update_document „${mod.title}“): Ungültige DocSpec – ${errors.join(' · ')}`);
            }
          }
          const nextTitle = item.title ? String(item.title).trim().slice(0, 200) : mod.title;
          const summary = item.spec === undefined && item.kind && !item.title
            ? `Dokument „${nextTitle}“: Art ${item.kind}`
            : `Dokument „${nextTitle}“ aktualisiert`;
          if (!dryRun) {
            const oldTitle = mod.title;
            const oldContent = typeof mod.content === 'string' ? JSON.parse(mod.content) : structuredClone(mod.content);
            await this.saveDocumentVersionSnapshot(mod.id, oldTitle, oldContent);
            const nextContent = withBlockIds({
              ...(oldContent || { kind: 'arbeitsblatt' }),
              ...(item.spec !== undefined ? { spec: item.spec } : {}),
              ...(item.kind ? { kind: item.kind } : {}),
            });
            await this.topics.addModule(mod.topicId, user, {
              id: mod.id,
              type: 'document',
              title: nextTitle,
              content: nextContent,
            } as any);
            session.undoStack.push({
              kind: 'restore_module',
              topicId: mod.topicId,
              moduleId: mod.id,
              oldTitle,
              oldContent,
              label: summary,
            });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, id: mod.id, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        case 'create_quiz': {
          this.requirePerm(session, byTeacher, 'writeDocs', i, item.op);
          const topicId = resolveRef(item.topicId)!;
          if (!topicId || !scopeSets.allowedTopics.has(topicId)) {
            throw new ForbiddenException(`operations[${i}]: Lernthema „${topicId}“ ist nicht im freigegebenen Bereich.`);
          }
          const title = String(item.title || '').trim().slice(0, 200);
          if (!title) throw new BadRequestException(`operations[${i}]: title fehlt.`);
          if (!topicId.startsWith('dry_')) item.content = await this.restoreImages(item.content, topicId, i, `create_quiz „${title}“`);
          const problems = quizProblems(item.type, item.content);
          if (problems.length) {
            throw new BadRequestException(`operations[${i}] (create_quiz „${title}“): ${problems.join(' · ')} – Format: GET /api/ai-bridge/reference/quiz?types=${item.type || ''}`);
          }
          const summary = `Quiz „${title}“ (${quizTypeName(item.type)}) angelegt`;
          if (dryRun) {
            const fakeId = `dry_quiz_${i}`;
            if (item.ref) refs.set(item.ref, fakeId);
            results.push({ index: i, op: item.op, ok: true, id: fakeId, summary: `[Vorschau] ${summary}` });
            break;
          }
          const saved = await this.topics.addModule(topicId, user, { type: item.type, title, moduleSelected: true, content: item.content } as any);
          if (item.ref) refs.set(item.ref, saved.id);
          session.undoStack.push({ kind: 'delete_module', topicId, moduleId: saved.id, label: summary });
          session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          results.push({ index: i, op: item.op, ok: true, id: saved.id, summary });
          break;
        }

        case 'update_quiz': {
          this.requirePerm(session, byTeacher, 'writeDocs', i, item.op);
          const moduleId = resolveRef(item.moduleId)!;
          const mod = moduleId ? await this.moduleRepo.findOne({ where: { id: moduleId } }) : null;
          if (!mod || !isAiQuizType(mod.type)) {
            throw new NotFoundException(`operations[${i}]: Quiz „${moduleId}“ nicht gefunden (bearbeitbar: ${AI_QUIZ_TYPES.join(', ')}).`);
          }
          if (!scopeSets.allowedTopics.has(mod.topicId)) {
            throw new ForbiddenException(`operations[${i}]: Quiz „${mod.title}“ liegt außerhalb des freigegebenen Bereichs.`);
          }
          item.content = await this.restoreImages(item.content, mod.topicId, i, `update_quiz „${mod.title}“`);
          const problems = quizProblems(mod.type, item.content);
          if (problems.length) {
            throw new BadRequestException(`operations[${i}] (update_quiz „${mod.title}“): ${problems.join(' · ')} – Format: GET /api/ai-bridge/reference/quiz?types=${mod.type}`);
          }
          const nextTitle = item.title ? String(item.title).trim().slice(0, 200) : mod.title;
          const summary = `Quiz „${nextTitle}“ überarbeitet`;
          if (!dryRun) {
            const oldTitle = mod.title;
            const oldContent = typeof mod.content === 'string' ? JSON.parse(mod.content) : structuredClone(mod.content);
            await this.topics.addModule(mod.topicId, user, { id: mod.id, type: mod.type, title: nextTitle, content: item.content } as any);
            session.undoStack.push({ kind: 'restore_module', topicId: mod.topicId, moduleId: mod.id, oldTitle, oldContent, label: summary });
            session.log.push({ at: new Date().toISOString(), op: item.op, summary });
          }
          results.push({ index: i, op: item.op, ok: true, id: mod.id, summary: dryRun ? `[Vorschau] ${summary}` : summary });
          break;
        }

        default:
          throw new BadRequestException(`operations[${i}]: Unbekannte Operation „${(item as any).op}“.`);
      }
    }

    return {
      ok: true,
      dryRun,
      count: results.length,
      results,
      session: this.publicSession(session),
    };
  }

  private requirePerm(session: AiBridgeSession, byTeacher: boolean, perm: keyof AiBridgePermissions, index: number, op: string) {
    if (!byTeacher && !session.scope.permissions[perm]) {
      throw new ForbiddenException(`operations[${index}] (${op}): Das Recht „${perm}“ ist für dieses KI-Token nicht freigeschaltet.`);
    }
  }

  private async saveDocumentVersionSnapshot(moduleId: string, title: string, content: any) {
    try {
      const payload = JSON.stringify({ title, content, embedded: null });
      const id = sha256(payload);
      const exists = await this.versionRepo.findOne({ where: { id } });
      if (!exists) {
        await this.versionRepo.save(this.versionRepo.create({ id, moduleId, title, content, embedded: null }));
      }
    } catch {
      // Snapshot in DocumentVersion ist optionaler Zusatz zum In-Memory-UndoStack
    }
  }

  private async applyUndo(userId: string, action: UndoAction) {
    const user = { userId };
    switch (action.kind) {
      case 'delete_nb_node':
        await this.notebooks.deleteNode(action.id, user);
        break;
      case 'rename_nb_node':
        await this.notebooks.updateNode(action.id, user, { title: action.oldTitle });
        break;
      case 'restore_doc_settings':
        await this.nbNodeRepo.update({ id: action.id, ownerId: userId }, { docSettings: action.old });
        break;
      case 'move_topic':
        if (action.existed) {
          await this.notebooks.move(user, { type: 'topic', id: action.topicId, parentId: action.oldNodeId, index: action.oldOrderIndex });
        } else {
          await this.nbPlaceRepo.delete({ ownerId: userId, topicId: action.topicId });
        }
        break;
      case 'delete_plan_node':
        await this.plans.deleteNode(user, action.id);
        break;
      case 'rename_plan_node':
        await this.plans.renameNode(user, action.id, action.oldTitle);
        break;
      case 'delete_plan_entries':
        for (const id of action.ids) await this.planEntryRepo.delete({ id, ownerId: userId });
        break;
      case 'restore_plan_entry':
        await this.planEntryRepo.save(this.planEntryRepo.create(action.entry));
        break;
      case 'delete_topic':
        await this.topics.remove(action.id, user);
        break;
      case 'delete_module':
        await this.moduleRepo.delete({ id: action.moduleId, topicId: action.topicId });
        break;
      case 'restore_module':
        await this.moduleRepo.update({ id: action.moduleId, topicId: action.topicId }, { title: action.oldTitle, content: action.oldContent });
        break;
    }
  }

  // ---- KI-verständliche Anleitung (Selbstbeschreibung + Prompt) ----

  async getInstructionsForAi(session: AiBridgeSession, baseUrl: string) {
    const tree = await this.scopedTree(session);
    return {
      description: 'LearningModules AI-Bridge – Zeitbeschränkte Schnittstelle zur Sortierung, Unterrichtsplanung und Dokument-Aufbereitung.',
      session: this.publicSession(session),
      authentication: 'Header "Authorization: Bearer <token>" (Schreiben nur so; Lesen notfalls auch mit ?token=).',
      endpoints: {
        instructions: `GET ${baseUrl}/api/ai-bridge/instructions`,
        tree: `GET ${baseUrl}/api/ai-bridge/tree`,
        topicDetail: `GET ${baseUrl}/api/ai-bridge/topics/:topicId`,
        document: `GET ${baseUrl}/api/ai-bridge/documents/:moduleId`,
        batch: `POST ${baseUrl}/api/ai-bridge/batch`,
      },
      // Formate zum Nachschlagen – nur holen, was gerade gebraucht wird.
      references: {
        docSpec: `GET ${baseUrl}/api/ai-bridge/reference/docspec`,
        quiz: `GET ${baseUrl}/api/ai-bridge/reference/quiz?types=${AI_QUIZ_TYPES.join(',')}`,
      },
      quizTypes: Object.fromEntries(AI_QUIZ_TYPES.map((t) => [t, quizTypeName(t)])),
      images: IMAGE_RULE,
      operationSchema: this.operationReference(),
      currentTree: tree,
    };
  }

  private operationReference() {
    return [
      {
        op: 'create_notebook_node',
        description: 'Legt im Lernnotizbuch ein Book (nur oben), einen Bereich (area) oder einen Abschnitt (section, unterste Ordnerebene für Lernthemen) an. Optional "ref": "$mein_knoten" vergeben, um in nachfolgenden Operationen desselben Aufrufs darauf zu verweisen.',
        example: { op: 'create_notebook_node', kind: 'section', title: 'Grundschaltungen', parentId: '<book-oder-area-id>', ref: '$sec_grund' },
      },
      {
        op: 'set_doc_settings',
        description: 'Kurs, Kopfzeile (titelmuster) und Nummerierung eines Ordners: numbering flat (durchgezählt 1, 2, 3 …), tree (gegliedert 1.1 …), off, inherit (wie darüber). Übrige Einstellungen bleiben; rückgängig machbar.',
        example: { op: 'set_doc_settings', id: '<section-id>', kurs: 'BPE 8', numbering: 'flat' },
      },
      {
        op: 'move_topic',
        description: 'Verschiebt ein Lernthema im Lernnotizbuch in einen Abschnitt/Bereich (targetNodeId darf auch ein "$ref" sein).',
        example: { op: 'move_topic', topicId: '<topic-id>', targetNodeId: '$sec_grund' },
      },
      {
        op: 'create_plan_node',
        description: 'Legt in der Planung einen Ordner (folder), Plan (plan), Bereich (area) oder Abschnitt (section) an.',
        example: { op: 'create_plan_node', kind: 'area', title: 'LF 1: Elektrotechnische Systeme analysieren', parentId: '<plan-id>', ref: '$lf1' },
      },
      {
        op: 'link_to_plan',
        description: 'Projiziert Lernthemen (type: "topic") oder ganze Notizbuch-Ordner (type: "nbnode") als Verweis in einen Plan-Bereich/-Abschnitt.',
        example: { op: 'link_to_plan', parentId: '$lf1', items: [{ type: 'topic', id: '<topic-id>' }] },
      },
      {
        op: 'create_topic',
        description: 'Legt ein neues Lernthema im Lernnotizbuch an.',
        example: { op: 'create_topic', title: 'Ohmsches Gesetz', targetNodeId: '$sec_grund', ref: '$top_ohm' },
      },
      {
        op: 'create_document',
        description: 'Legt ein editierbares Arbeitsblatt (DocSpec) in einem Lernthema an.',
        example: {
          op: 'create_document',
          topicId: '$top_ohm',
          title: 'AB 1: Ohmsches Gesetz',
          kind: 'arbeitsblatt',
          spec: {
            content: [
              { type: 'section', text: 'Zusammenhang zwischen Spannung, Strom und Widerstand' },
              { type: 'text', text: 'In einem metallischen Leiter ist die Stromstärke $I$ proportional zur Spannung $U$.' },
              { type: 'formula', latex: 'I = \\frac{U}{R}' },
              {
                type: 'task',
                title: 'Stromstärke berechnen',
                points: 4,
                text: 'An einem Widerstand $R = 100\\,\\Omega$ liegt $U = 12\\,\\text{V}$ an. Berechne $I$.',
                blocks: [
                  { type: 'karo', lines: 4 },
                  { type: 'solution', blocks: [{ type: 'text', text: '$I = \\frac{12\\,\\text{V}}{100\\,\\Omega} = 0{,}12\\,\\text{A}$' }] },
                ],
              },
            ],
          },
        },
      },
      {
        op: 'update_document',
        description: 'Aktualisiert die DocSpec (und optional Titel und Dokument-Art kind: arbeitsblatt | klassenarbeit | text) eines bestehenden Dokument-Moduls. Ohne spec bleibt der Inhalt. Nummeriert werden nur Arbeitsblätter. Vorab wird automatisch eine Sicherung für 1-Klick-Undo angelegt.',
        example: { op: 'update_document', moduleId: '<module-id>', title: 'Überarbeiteter Titel', spec: { content: [] } },
      },
      {
        op: 'create_quiz',
        description: `Legt ein Quiz im Lernthema an (type: ${AI_QUIZ_TYPES.join(', ')}). Format von "content" je Typ: GET /reference/quiz?types=<typ>. Mit "ref" lässt es sich im selben Aufruf in ein Dokument einbetten: Block { "type": "quiz", "module": "$q1" }.`,
        example: { op: 'create_quiz', topicId: '<topic-id|$ref>', type: 'multipleChoice', title: 'Ohmsches Gesetz', ref: '$q1', content: { question: 'Wie groß ist I bei U = 12 V und R = 6 Ω?', answers: [{ text: '0,5 A', correct: false }, { text: '2 A', correct: true }, { text: '72 A', correct: false }], singleAnswer: true, randomAnswers: true } },
      },
      {
        op: 'update_quiz',
        description: 'Überarbeitet Inhalt (und optional Titel) eines vorhandenen Quiz – der Typ bleibt. Vorher mit GET /topics/<id> lesen; rückgängig machbar.',
        example: { op: 'update_quiz', moduleId: '<module-id>', content: { question: '…', answers: [] } },
      },
    ];
  }

  /** Nachschlagen: das Format der Arbeitsblätter (GET /reference/docspec). */
  getDocSpecReference() {
    return { ...this.docSpecReference(), quizBlock: '{ type: "quiz", module: "<Quiz-Modul-ID oder $ref aus create_quiz>" } – bettet ein Quiz ins Blatt ein', images: IMAGE_RULE };
  }

  /** Nachschlagen: das Format der Quiz-Typen (GET /reference/quiz?types=…) – nur die gewünschten. */
  getQuizReference(types: string) {
    const wanted = String(types || '').split(',').map((t) => t.trim()).filter(isAiQuizType);
    return quizFormat(wanted.length ? wanted : [...AI_QUIZ_TYPES]);
  }

  private docSpecReference() {
    return {
      format: 'Objekt { orientation?: "portrait"|"landscape", content: Block[] }',
      inlineMarkup: '**fett**, *kursiv*, ++unterstrichen++, `Code`, $LaTeX-Formel$, x^{2}, R_{1}',
      blocks: {
        section: '{ type: "section", text: "Abschnittsüberschrift (1., 2., …)", blocks?: Block[] }',
        task: '{ type: "task", title: "Aufgabentitel (1.1, 1.2, …)", text?: "Aufgabenstellung", points?: number, blocks?: Block[] }',
        subtask: '{ type: "subtask", title: "Teilaufgabe (1.1.1 / a))", text?: "...", points?: number, blocks?: Block[] }',
        heading: '{ type: "heading", level?: 1|2|3, text: "Überschrift ohne Nummerierung" }',
        text: '{ type: "text", text: "Absatztext", align?: "left"|"center"|"right"|"justify" }',
        list: '{ type: "list", ordered?: boolean, items: Array<string | { text: string, items: ... }> }',
        table: '{ type: "table", header?: string[], rows: string[][], widths?: string[], border?: boolean }',
        formula: '{ type: "formula", latex: "I = \\\\frac{U}{R}", align?: "left" }',
        karo: '{ type: "karo", lines: 1..60, pattern?: "karo"|"linien"|"leer"|"frei", width?: "10cm" }',
        solution: '{ type: "solution", blocks: Block[] } (darf keine weiteren solution- oder quiz-Blöcke enthalten)',
        box: '{ type: "box", title?: "Merke", shaded?: boolean, blocks: Block[] }',
        columns: '{ type: "columns", blocks: [{ type: "column", width?: "8cm", blocks: Block[] }, { type: "column", blocks: Block[] }] }',
        code: '{ type: "code", code: "void setup() {}", size?: 8|9|10 }',
      },
    };
  }

  /** Zugang per HTTP – Token im Header, damit er nicht in Server- und Proxy-Protokollen steht. */
  private httpLines(baseUrl: string, rawToken: string, extra: string[] = []): string[] {
    return [
      '### Falls du direkten Web-/HTTP-Zugriff hast (z. B. Claude Code, Agent, Python):',
      `- Bei jeder Anfrage den Header \`Authorization: Bearer ${rawToken}\` mitschicken.`,
      `- Regeln & aktuellen Baum: \`GET ${baseUrl}/api/ai-bridge/instructions\``,
      `- Lernthema mit Inhalten: \`GET ${baseUrl}/api/ai-bridge/topics/<topicId>\``,
      ...extra,
      `- Änderungen prüfen (Probelauf): \`POST ${baseUrl}/api/ai-bridge/batch\` mit \`{ "dryRun": true, "operations": [...] }\``,
      `- Änderungen ausführen: \`POST ${baseUrl}/api/ai-bridge/batch\` mit \`{ "operations": [...] }\``,
      '- Meldet der Server einen Fehler (z. B. ungültige DocSpec), korrigiere und sende erneut.',
      `- Nur wenn dein Werkzeug keine Header setzen kann: Lesen geht auch mit \`?token=${rawToken}\` an der Adresse.`,
    ];
  }

  /**
   * Anleitung „Blatt neu aufbereiten“: das Original (liegt der KI als PDF/Bild
   * vor) in ein sauberes Arbeitsblatt überführen, Inhalte und Reihenfolge wie im
   * Original, Grafiken mitnehmen. Der jetzige Stand steht mit Bild-Verweisen darin,
   * damit es auch ohne HTTP-Zugriff geht.
   */
  async buildRegeneratePrompt(session: AiBridgeSession, rawToken: string, baseUrl: string): Promise<string> {
    const expiresTime = new Date(session.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const docs = await Promise.all((session.scope.moduleIds || []).map((id) => this.getScopedDocument(session, id)));
    return [
      `# Arbeitsblatt${docs.length === 1 ? '' : 'er'} neu aufbereiten (LearningModules)`,
      '',
      `Ich gebe dir ${docs.length === 1 ? 'das Original' : 'die Originale'} (PDF/Word/Bild) als Anhang. Der Import in LearningModules hat ${docs.length === 1 ? 'es' : 'sie'} nur unvollständig übernommen.`,
      `Bitte bereite ${docs.length === 1 ? 'das Blatt' : 'jedes Blatt'} als sauberes, editierbares Arbeitsblatt (DocSpec) neu auf und überschreibe damit das vorhandene Dokument (\`update_document\`).`,
      '',
      '## Regeln',
      '- **Inhalte und Reihenfolge wie im Original.** Nicht umschreiben, nicht kürzen, keine eigenen Zusatzaufgaben. Formulierungen und Anrede (du/Sie) bleiben.',
      '- Information, Aufgaben und Lösungen gehören auf ein Blatt: Aufgaben als `task`/`subtask` (Punkte nur, wenn das Original welche nennt), Lösungen in `solution`-Blöcken direkt bei der Aufgabe.',
      '- Schreibfelder (`karo`) dort, wo im Original Platz zum Schreiben ist – Länge passend zur Lösung.',
      '- **Grafiken mitnehmen:** Bilder und gezeichnete Grafiken (Pfeile, Klammern, Skizzen, Schaltpläne) gehören zum Blatt. Vorhandene Bilder stehen als `lm-img:…` im jetzigen Stand – diese Verweise an die passende Stelle übernehmen. Fehlt eine Grafik und kannst du sie aus dem Original ausschneiden, als `data:image/png;base64,…` einfügen. Sonst an der Stelle einen Kasten `{"type":"box","title":"📌 Grafik aus dem Original","blocks":[{"type":"text","text":"<was dort zu sehen ist>"}]}` setzen, damit ich sie nachtrage.',
      '- Formeln als LaTeX (`$…$` im Text, `formula`-Block für abgesetzte Formeln), Tabellen als `table`, Programmcode als `code`.',
      '- Keine Seitenbegrenzung – lieber vollständig als kurz.',
      '',
      '## Zugang',
      `- **Gültig bis:** ${expiresTime} Uhr · Rechte: nur diese Dokumente überarbeiten. Vorher wird jeweils eine Fassung gesichert; ich kann alles rückgängig machen.`,
      `- **Basis-URL:** \`${baseUrl}/api/ai-bridge\` · **Token:** \`${rawToken}\``,
      '',
      ...this.httpLines(baseUrl, rawToken, [`- Ein Dokument mit DocSpec und Bild-Verweisen: \`GET ${baseUrl}/api/ai-bridge/documents/<moduleId>\``]),
      '- Erst mit `"dryRun": true` prüfen, dann ausführen.',
      '',
      '### Falls du KEINEN HTTP-Zugriff hast (normaler KI-Chat):',
      '- Antworte mit genau einem ```json-Codeblock `{ "operations": [ { "op": "update_document", "moduleId": "…", "spec": { "content": [ … ] } } ] }`. Ich füge ihn in LearningModules ein; Fehler melde ich dir zurück.',
      '',
      '## Format (DocSpec, Kurzreferenz)',
      ...Object.entries(this.docSpecReference().blocks).map(([, v]) => `- \`${v}\``),
      `- Inline: ${this.docSpecReference().inlineMarkup}`,
      `- Bilder: ${IMAGE_RULE}`,
      '',
      `## ${docs.length === 1 ? 'Das Dokument' : 'Die Dokumente'} (jetziger Stand)`,
      ...docs.flatMap((d) => [
        '',
        `### „${d.title}“ – moduleId \`${d.id}\`, Art: ${d.kind}`,
        d.images.length ? `Bilder darin: ${d.images.map((im) => `\`${im.ref}\` (${im.mime}, ${im.kb} KB)`).join(', ')}` : 'Bisher keine Bilder darin.',
        '```json',
        JSON.stringify(d.spec),
        '```',
      ]),
      '',
      '## Mein Zusatzwunsch (optional):',
      '',
    ].join('\n');
  }

  /**
   * Anleitung „Quiz überarbeiten“: der jetzige Stand je Quiz und das Format nur seiner Typen –
   * so passt alles in einen Chat, auch ohne HTTP-Zugriff.
   */
  async buildQuizRevisePrompt(session: AiBridgeSession, rawToken: string, baseUrl: string): Promise<string> {
    const expiresTime = new Date(session.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const mods = (await this.moduleRepo.find({ where: { id: In(session.scope.moduleIds || []) } })).filter((m) => isAiQuizType(m.type));
    const one = mods.length === 1;
    return [
      `# ${one ? 'Quiz' : 'Quizze'} überarbeiten (LearningModules)`,
      '',
      `Bitte überarbeite ${one ? 'dieses Quiz' : 'diese Quizze'} (\`update_quiz\`). Der Typ bleibt. Sag mir unten, was dir auffällt, wenn ich keinen Wunsch nenne: unklare Fragen, unplausible Ablenker, Fehler in der Lösung.`,
      '',
      '## Zugang',
      `- **Gültig bis:** ${expiresTime} Uhr · Rechte: nur ${one ? 'dieses Quiz' : 'diese Quizze'} überarbeiten. Ich kann alles rückgängig machen.`,
      `- **Basis-URL:** \`${baseUrl}/api/ai-bridge\` · **Token:** \`${rawToken}\``,
      '',
      ...this.httpLines(baseUrl, rawToken),
      '- Erst mit `"dryRun": true` prüfen, dann ausführen.',
      '',
      '### Falls du KEINEN HTTP-Zugriff hast (normaler KI-Chat):',
      '- Antworte mit genau einem ```json-Codeblock `{ "operations": [ { "op": "update_quiz", "moduleId": "…", "content": { … } } ] }`. Ich füge ihn in LearningModules ein; Fehler melde ich dir zurück.',
      '',
      quizFormat([...new Set(mods.map((m) => m.type))]).replace(/^# /, '## '),
      '',
      `## ${one ? 'Das Quiz' : 'Die Quizze'} (jetziger Stand)`,
      ...mods.flatMap((m) => {
        const { value } = maskImages(this.parsed(m.content));
        return ['', `### „${m.title}“ – moduleId \`${m.id}\`, Typ: ${m.type}`, '```json', JSON.stringify(value), '```'];
      }),
      '',
      '## Mein Wunsch (optional):',
      '',
    ].join('\n');
  }

  /**
   * Kurzanleitung für die KI der Lehrkraft: Zugang, Rechte, Ablauf, nur die erlaubten
   * Operationen und eine knappe Gliederung des freigegebenen Bereichs (ohne Module).
   * Alles Weitere – vollständiger Baum, DocSpec-Referenz – holt eine KI mit Webzugriff
   * über GET /instructions bzw. /tree. Bewusst kurz: Die Anleitung muss in einen Chat passen.
   */
  buildTeacherPrompt(session: AiBridgeSession, rawToken: string, baseUrl: string, tree: any, { quizFormats = false } = {}): string {
    const expiresTime = new Date(session.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const { organize, writeDocs } = session.scope.permissions;
    const rights = !organize && !writeDocs
      ? '**Nur lesen** – du änderst nichts selbst, sondern schlägst `{"operations": [...]}` vor; ich prüfe und führe aus.'
      : `Lesen${organize ? ', ordnen (Ordner anlegen/umbenennen, Lernthemen verschieben, in Pläne eintragen)' : ''}${writeDocs ? ', Inhalte anlegen (Lernthemen, Arbeitsblätter anlegen und überarbeiten)' : ''}.`;
    const ops = [
      ...(organize ? [
        '`{"op":"create_notebook_node","kind":"area"|"section","title":"…","parentId":"<id|$ref>","ref":"$a1"}` – section ist die unterste Ordnerebene für Lernthemen',
        '`{"op":"rename_notebook_node","id":"<id>","title":"…"}`',
        '`{"op":"set_doc_settings","id":"<nodeId>","kurs":"BPE 8","numbering":"flat"}` – Kurs/Kopfzeile und Nummerierung (flat durchgezählt, tree gegliedert, off, inherit)',
        '`{"op":"move_topic","topicId":"<id>","targetNodeId":"<id|$ref>"}`',
        '`{"op":"create_plan_node","kind":"folder"|"plan"|"area"|"section","title":"…","parentId":"<id|$ref|null>","ref":"$p1"}`',
        '`{"op":"rename_plan_node","id":"<id>","title":"…"}`',
        '`{"op":"link_to_plan","parentId":"<planNodeId|$ref>","items":[{"type":"topic"|"nbnode","id":"<id>"}]}`',
        '`{"op":"remove_plan_entry","entryId":"<id>"}`',
      ] : []),
      ...(writeDocs ? [
        '`{"op":"create_topic","title":"…","targetNodeId":"<sectionId|$ref>","ref":"$t1"}`',
        '`{"op":"create_document","topicId":"<id|$ref>","title":"…","kind":"arbeitsblatt","spec":{"content":[…]}}`',
        '`{"op":"update_document","moduleId":"<id>","title":"…","spec":{"content":[…]}}` – vorher mit GET /documents/<id> lesen',
        `\`{"op":"create_quiz","topicId":"<id|$ref>","type":"<Typ>","title":"…","content":{…},"ref":"$q1"}\` – Typen: ${AI_QUIZ_TYPES.map((t) => `${t} (${quizTypeName(t)})`).join(', ')}`,
        '`{"op":"update_quiz","moduleId":"<id>","title":"…","content":{…}}` – Typ bleibt; vorher mit GET /topics/<id> lesen',
      ] : []),
    ];
    const docSpec = writeDocs ? [
      '',
      '## Arbeitsblätter (`spec.content`), kurz',
      '- `section` (1.), `task` mit `title`/`points`/`text`/`blocks` (1.1), `subtask` (a); ohne Nummer: `heading` mit `level` 1–3',
      '- `text` (Markdown: **fett**, *kursiv*, $Formel$), `formula` (`latex`), `table` (`header`, `rows`), `box` (`title`, `blocks`), `columns`',
      '- `karo` (`lines`, `pattern` karo|linien|leer|frei) als Schreibfeld, `solution` (`blocks`) als ausgeblendete Musterlösung',
      `- Bilder: ${IMAGE_RULE}`,
      '- Quiz ins Blatt einbetten: `{"type":"quiz","module":"<id|$q1>"}`.',
      `- Nachschlagen: vollständige Referenz \`GET ${baseUrl}/api/ai-bridge/reference/docspec\`; Quiz-Format nur der gebrauchten Typen \`GET ${baseUrl}/api/ai-bridge/reference/quiz?types=multipleChoice,trueFalse\`. Der Server prüft alles und meldet Fehler genau.`,
      ...(quizFormats ? ['', quizFormat([...AI_QUIZ_TYPES]).replace(/^# /, '## ')] : []),
    ] : [];

    return [
      '# Auftrag für meinen LearningModules-Assistenten',
      '',
      'LearningModules sammelt Material im **Lernnotizbuch** (Book → Bereich (area) → Abschnitt (section) → Lernthema → Module wie Arbeitsblätter) und verweist von dort in **Pläne** (Ordner → Plan → Bereich → Abschnitt).',
      '',
      '## Zugang',
      `- Basis-URL: \`${baseUrl}/api/ai-bridge\` · Token: \`${rawToken}\` · gültig bis ${expiresTime} Uhr`,
      `- Rechte: ${rights} Nur im freigegebenen Bereich, nie Schülerdaten.`,
      `- Höchstens ${MAX_OPS_PER_SESSION} Operationen je Sitzung. Ich kann alles mit einem Klick rückgängig machen.`,
      '',
      '## Ablauf',
      `1. Mit HTTP-Zugriff (z. B. Claude Code): Header \`Authorization: Bearer ${rawToken}\` bei jeder Anfrage. Baum: \`GET ${baseUrl}/api/ai-bridge/tree\`, Lernthema: \`GET …/topics/<id>\`, Dokument: \`GET …/documents/<id>\`.`,
      `2. Erst prüfen: \`POST ${baseUrl}/api/ai-bridge/batch\` mit \`{"dryRun": true, "operations": [...]}\`, dann ohne \`dryRun\` ausführen. Mit \`"ref": "$name"\` verweisen spätere Operationen desselben Aufrufs auf Neues.`,
      '3. Große Inhalte (Arbeitsblätter mit Bildern) einzeln je Aufruf schicken. Bei einer Fehlermeldung korrigieren und erneut senden.',
      '4. Ohne HTTP-Zugriff: antworte mit genau einem ```json-Block `{"operations": [...]}` – ich füge ihn im KI-Dialog ein.',
      ...(ops.length ? ['', '## Erlaubte Operationen', ...ops.map((o) => `- ${o}`)] : []),
      ...docSpec,
      '',
      '## Freigegebener Bereich (Gliederung mit IDs, ohne Module)',
      this.outline(tree),
      '',
      '## Mein Auftrag',
      '',
    ].join('\n');
  }

  /** Knappe Gliederung des Baums für die Anleitung – höchstens etwa `max` Zeichen, Rest per GET /tree. */
  private outline(tree: any, max = 6000): string {
    const lines: string[] = [];
    const walk = (nodes: any[], topics: any[], parentId: string | null, depth: number) => {
      for (const n of nodes.filter((x) => (x.parentId ?? null) === parentId).sort((a, b) => a.orderIndex - b.orderIndex)) {
        lines.push(`${'  '.repeat(depth)}- ${n.kind} „${n.title}“ \`${n.id}\``);
        for (const t of topics.filter((x) => x.nodeId === n.id).sort((a, b) => a.orderIndex - b.orderIndex)) {
          lines.push(`${'  '.repeat(depth + 1)}- Lernthema „${t.title}“ \`${t.topicId}\` (${(t.modules || []).length} Module)`);
        }
        walk(nodes, topics, n.id, depth + 1);
      }
    };
    const nb = tree?.notebook || {};
    lines.push('Lernnotizbuch:');
    walk(nb.nodes || [], nb.topics || [], null, 0);
    const unsorted = (nb.topics || []).filter((t: any) => !t.nodeId);
    if (unsorted.length) lines.push(`- Unsortiert: ${unsorted.length} Lernthemen`);
    if ((tree?.plans?.nodes || []).length) {
      lines.push('Planung:');
      walk(tree.plans.nodes, [], null, 0);
    }
    let text = '';
    for (const l of lines) {
      if (text.length + l.length > max) return `${text}… (gekürzt – vollständig per GET /tree)`;
      text += (text ? '\n' : '') + l;
    }
    return text;
  }
}
