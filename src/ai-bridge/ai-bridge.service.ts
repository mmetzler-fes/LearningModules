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
  | { op: 'move_topic'; topicId: string; targetNodeId: string | null; index?: number | null }
  | { op: 'create_plan_node'; kind: 'folder' | 'plan' | 'area' | 'section'; title: string; parentId?: string | null; ref?: string }
  | { op: 'rename_plan_node'; id: string; title: string }
  | { op: 'link_to_plan'; parentId: string; items: Array<{ type: 'topic' | 'nbnode' | 'plan'; id: string }> }
  | { op: 'remove_plan_entry'; entryId: string }
  | { op: 'create_topic'; title: string; description?: string; targetNodeId?: string | null; ref?: string }
  | { op: 'create_document'; topicId: string; title: string; kind?: 'arbeitsblatt' | 'klassenarbeit' | 'text'; spec: any; ref?: string }
  | { op: 'update_document'; moduleId: string; title?: string; spec: any };

const DEFAULT_TTL_MINUTES = 60;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 240;
/** So lange nach dem Ablauf lässt sich eine Sitzung noch rückgängig machen. */
const SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
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
      /** Blatt neu aufbereiten: nur diese Dokumente, nur `writeDocs`. */
      regenerateModuleIds?: string[];
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
    if (regenerate) {
      const ids = [...new Set(body.regenerateModuleIds!.map(String))].slice(0, 30);
      const mods = await Promise.all(ids.map((id) => this.moduleRepo.findOne({ where: { id } })));
      const topicIds: string[] = [];
      for (const m of mods) {
        if (!m || m.type !== 'document') throw new BadRequestException('Neu aufbereiten geht nur mit Dokumenten.');
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
    const prompt = regenerate
      ? await this.buildRegeneratePrompt(session, rawToken, base)
      : this.buildTeacherPrompt(session, rawToken, base, await this.scopedTree(session));

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
    return this.executeBatch(session, body);
  }

  /** Auch wenn mittendrin etwas scheitert: Was schon geändert ist, bleibt rückgängig machbar. */
  async executeBatch(session: AiBridgeSession, body: { dryRun?: boolean; operations?: AiBridgeOp[] }) {
    const before = session.undoStack.length;
    try {
      return await this.runBatch(session, body);
    } finally {
      if (session.undoStack.length !== before) {
        await this.store(session);
        docChanged(session.userId);
      }
    }
  }

  private async runBatch(session: AiBridgeSession, body: { dryRun?: boolean; operations?: AiBridgeOp[] }) {
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

    const results: Array<{ index: number; op: string; ok: boolean; id?: string; summary: string }> = [];

    for (let i = 0; i < ops.length; i++) {
      const item = ops[i];
      if (!item || typeof item !== 'object' || !item.op) {
        throw new BadRequestException(`operations[${i}]: Feld "op" fehlt.`);
      }
      // Neu aufbereiten: nur die freigegebenen Dokumente überschreiben – nichts anlegen, nichts umräumen.
      if (session.purpose === 'regenerate' && (item.op !== 'update_document' || !(session.scope.moduleIds || []).includes(String((item as any).moduleId)))) {
        throw new ForbiddenException(`operations[${i}] (${item.op}): In dieser Sitzung geht nur update_document für die freigegebenen Dokumente.`);
      }

      switch (item.op) {
        case 'create_notebook_node': {
          this.requirePerm(session, 'organize', i, item.op);
          const parentId = resolveRef(item.parentId);
          if (parentId) {
            if (!scopeSets.allowedNbNodes.has(parentId)) throw new ForbiddenException(`operations[${i}]: Zielknoten „${parentId}“ ist nicht im freigegebenen Lernnotizbuch-Bereich.`);
          } else if (!scopeSets.nbAll) {
            throw new ForbiddenException(`operations[${i}]: Neue Books auf oberster Ebene sind in dieser Sitzung nicht freigegeben.`);
          }
          if (dryRun) {
            const fakeId = `dry_nb_${i}`;
            if (item.ref) refs.set(item.ref, fakeId);
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
          this.requirePerm(session, 'organize', i, item.op);
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

        case 'move_topic': {
          this.requirePerm(session, 'organize', i, item.op);
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
          this.requirePerm(session, 'organize', i, item.op);
          const parentId = resolveRef(item.parentId);
          if (parentId) {
            if (!scopeSets.allowedPlanNodes.has(parentId)) throw new ForbiddenException(`operations[${i}]: Planknoten „${parentId}“ ist nicht im freigegebenen Planungsbereich.`);
          } else if (!scopeSets.planAll) {
            throw new ForbiddenException(`operations[${i}]: Anlegen auf oberster Planungsebene ist in dieser Sitzung nicht freigegeben.`);
          }
          if (dryRun) {
            const fakeId = `dry_pl_${i}`;
            if (item.ref) refs.set(item.ref, fakeId);
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
          this.requirePerm(session, 'organize', i, item.op);
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
          this.requirePerm(session, 'organize', i, item.op);
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
          this.requirePerm(session, 'organize', i, item.op);
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
          this.requirePerm(session, 'writeDocs', i, item.op);
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
          this.requirePerm(session, 'writeDocs', i, item.op);
          const topicId = resolveRef(item.topicId)!;
          if (!topicId || !scopeSets.allowedTopics.has(topicId)) {
            throw new ForbiddenException(`operations[${i}]: Lernthema „${topicId}“ ist nicht im freigegebenen Bereich.`);
          }
          const title = String(item.title || '').trim().slice(0, 200);
          if (!title) throw new BadRequestException(`operations[${i}]: title fehlt.`);
          // Neues Lernthema im Probelauf: dort gibt es noch keine Bilder.
          if (!topicId.startsWith('dry_')) item.spec = await this.restoreImages(item.spec, topicId, i, `create_document „${title}“`);
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
          this.requirePerm(session, 'writeDocs', i, item.op);
          const moduleId = resolveRef(item.moduleId)!;
          const mod = moduleId ? await this.moduleRepo.findOne({ where: { id: moduleId } }) : null;
          if (!mod || mod.type !== 'document') throw new NotFoundException(`operations[${i}]: Dokument-Modul „${moduleId}“ nicht gefunden.`);
          if (!scopeSets.allowedTopics.has(mod.topicId)) {
            throw new ForbiddenException(`operations[${i}]: Dokument „${mod.title}“ liegt außerhalb des freigegebenen Bereichs.`);
          }
          item.spec = await this.restoreImages(item.spec, mod.topicId, i, `update_document „${mod.title}“`);
          const errors = docSpec().validateDocSpec(item.spec);
          if (errors.length) {
            throw new BadRequestException(`operations[${i}] (update_document „${mod.title}“): Ungültige DocSpec – ${errors.join(' · ')}`);
          }
          const nextTitle = item.title ? String(item.title).trim().slice(0, 200) : mod.title;
          const summary = `Dokument „${nextTitle}“ aktualisiert`;
          if (!dryRun) {
            const oldTitle = mod.title;
            const oldContent = typeof mod.content === 'string' ? JSON.parse(mod.content) : structuredClone(mod.content);
            await this.saveDocumentVersionSnapshot(mod.id, oldTitle, oldContent);
            const nextContent = withBlockIds({ ...(oldContent || { kind: 'arbeitsblatt' }), spec: item.spec });
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

  private requirePerm(session: AiBridgeSession, perm: keyof AiBridgePermissions, index: number, op: string) {
    if (!session.scope.permissions[perm]) {
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
      images: IMAGE_RULE,
      operationSchema: this.operationReference(),
      docSpecReference: this.docSpecReference(),
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
        description: 'Aktualisiert die DocSpec (und optional den Titel) eines bestehenden Dokument-Moduls. Vorab wird automatisch eine Sicherung für 1-Klick-Undo angelegt.',
        example: { op: 'update_document', moduleId: '<module-id>', title: 'Überarbeiteter Titel', spec: { content: [] } },
      },
    ];
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

  buildTeacherPrompt(session: AiBridgeSession, rawToken: string, baseUrl: string, tree: any): string {
    const expiresTime = new Date(session.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const compactTree = JSON.stringify(
      {
        notebook: tree.notebook,
        plans: tree.plans,
      },
      null,
      2,
    );

    return [
      '# Auftrag für meinen LearningModules-Assistenten',
      '',
      'Du unterstützt mich beim Strukturieren, Zuordnen und Aufbereiten meines Unterrichtsmaterials in **LearningModules**.',
      '- **Konzept der App:** Materialien werden einmalig im **Lernnotizbuch** (`notebook`: `book → area → section → Lernthema (topic) → Modul`) gesammelt. Von dort werden sie als Verweise (`link_to_plan`) in **Planungsvorlagen** (`plans`: `folder → plan → area → section`) projiziert.',
      '',
      '## 1. Dein zeitbeschränkter API-Zugang',
      `- **Gültig bis:** ${expiresTime} Uhr (alle Änderungen lassen sich in LearningModules rückgängig machen)`,
      `- **Freigegebene Rechte:** Lesen${session.scope.permissions.organize ? ', Strukturieren & Planen (`organize`)' : ''}${session.scope.permissions.writeDocs ? ', Dokumente anlegen & überarbeiten (`writeDocs`)' : ''}`,
      `- **Basis-URL:** \`${baseUrl}/api/ai-bridge\``,
      `- **Token:** \`${rawToken}\``,
      '',
      ...this.httpLines(baseUrl, rawToken),
      '',
      '### Falls du KEINEN direkten HTTP-Zugriff hast (normaler KI-Chat im Browser):',
      '- Antworte mir mit einem einzigen ````json Codeblock, der das JSON-Objekt `{ "operations": [ ... ] }` enthält. Ich kann diesen Codeblock direkt im KI-Dialog von LearningModules einfügen und mit einem Klick ausführen.',
      '',
      '## 2. Erlaubte Operationen in `"operations"`',
      '- `{"op": "create_notebook_node", "kind": "book"|"area"|"section", "title": "...", "parentId": "<id|null>", "ref": "$k1"}`',
      '- `{"op": "rename_notebook_node", "id": "<id>", "title": "..."}`',
      '- `{"op": "move_topic", "topicId": "<id>", "targetNodeId": "<nodeId|$ref>"}`',
      '- `{"op": "create_plan_node", "kind": "folder"|"plan"|"area"|"section", "title": "...", "parentId": "<id|null>", "ref": "$p1"}`',
      '- `{"op": "rename_plan_node", "id": "<id>", "title": "..."}`',
      '- `{"op": "link_to_plan", "parentId": "<planNodeId|$ref>", "items": [{"type": "topic"|"nbnode"|"plan", "id": "<id>"}]}`',
      '- `{"op": "remove_plan_entry", "entryId": "<entryId>"}`',
      '- `{"op": "create_topic", "title": "...", "description": "...", "targetNodeId": "<nodeId|$ref>", "ref": "$t1"}`',
      '- `{"op": "create_document", "topicId": "<topicId|$ref>", "title": "...", "kind": "arbeitsblatt"|"klassenarbeit"|"text", "spec": { "content": [...] }}`',
      '- `{"op": "update_document", "moduleId": "<moduleId>", "title": "...", "spec": { "content": [...] }}`',
      '',
      '### Kurzreferenz für Arbeitsblätter (`spec.content`):',
      '- Überschrift mit Nummer: `{"type": "section", "text": "..."}` (1.), `{"type": "task", "title": "...", "points": 4, "text": "...", "blocks": [...]}` (1.1), `{"type": "subtask", "title": "...", "blocks": [...]}` (1.1.1)',
      '- Überschrift ohne Nummer: `{"type": "heading", "level": 1, "text": "..."}`',
      '- Fließtext: `{"type": "text", "text": "Text mit **fett**, *kursiv* und Inline-Formel $U = R \\\\cdot I$"}`',
      '- Block-Formel: `{"type": "formula", "latex": "I = \\\\frac{U}{R}"}`',
      '- Schreibfeld für Schüler: `{"type": "karo", "lines": 4, "pattern": "karo"|"linien"|"leer"}`',
      '- Musterlösung (auf Schülerblatt ausgeblendet): `{"type": "solution", "blocks": [{"type": "text", "text": "..."}]}`',
      '- Tabelle: `{"type": "table", "header": ["Spalte A", "Spalte B"], "rows": [["1", "2"]]}`',
      '- Merke-Kasten: `{"type": "box", "title": "Merke", "shaded": true, "blocks": [{"type": "text", "text": "..."}]}`',
      '- Spalten nebeneinander: `{"type": "columns", "blocks": [{"type": "column", "blocks": [...]}, {"type": "column", "blocks": [...]}]}`',
      `- Bilder: ${IMAGE_RULE}`,
      '',
      '## 3. Aktueller Stand im freigegebenen Bereich',
      '```json',
      compactTree,
      '```',
      '',
      '## 4. Mein konkreter Auftrag an dich:',
      'Bitte führe folgenden Auftrag aus (oder gib das passende `{"operations": [...]}`-JSON aus):',
      '',
    ].join('\n');
  }
}
