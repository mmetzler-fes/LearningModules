import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { HtmlAppFile } from '../core/entities/html-app-file.entity';
import { HtmlAppState } from '../core/entities/html-app-state.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { User } from '../core/entities/user.entity';
import { isTestStudent } from '../classes/test-student';
import { FeaturesService } from '../features/features.service';
import { TopicsService } from '../topics/topics.service';
import { CHECK_VERSION, deliverable, inspectApp } from './html-app-check';
import {
  appFileIdOf, appHeaders, appOrigin, FRAME_PREFIX, issueToken, LIFETIME_MS, MAX_FILE_BYTES, MAX_STATE_BYTES,
  parentOriginOf, readToken, SessionToken, shellPage, ViewToken,
} from './html-app-rules';

/** Höchstens so viele Meldungen je Sitzung und Minute; die Bridge bündelt, mehr schickt keine ehrliche App. */
const REPORTS_PER_MINUTE = 120;

const hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const contentOf = (m: { content?: any }): any => {
  if (typeof m?.content !== 'string') return m?.content || {};
  try { return JSON.parse(m.content); } catch { return {}; }
};

/** HTML-Apps als Lernmodul: Hochladen, Öffnen, Meldungen (docs/html-apps.md). */
@Injectable()
export class HtmlAppsService {
  private readonly reports = new Map<string, { minute: number; count: number }>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(HtmlAppFile) private readonly fileRepo: Repository<HtmlAppFile>,
    @InjectRepository(HtmlAppState) private readonly stateRepo: Repository<HtmlAppState>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly features: FeaturesService,
    private readonly topics: TopicsService,
  ) {}

  /** Datei prüfen und ablegen. Dieselbe Datei desselben Kontos entsteht nicht zweimal. */
  async upload(user: any, html: unknown) {
    if (typeof html !== 'string' || !html.trim()) throw new BadRequestException('Keine HTML-Datei angekommen.');
    const size = Buffer.byteLength(html);
    if (size > MAX_FILE_BYTES) throw new BadRequestException(`Die Datei ist zu groß (höchstens ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
    const { manifest, errors } = inspectApp(html);
    if (errors.length || !manifest) throw new BadRequestException({ message: 'Die Datei hält die Regeln für HTML-Apps nicht ein.', errors });
    const sha = hex(html);
    const known = await this.fileRepo.findOne({ where: { ownerId: user.userId, sha }, select: ['id', 'manifest', 'size'] });
    // Eine gesperrte Datei bleibt gesperrt, auch wenn sie jemand anderes noch einmal hochlädt.
    const blocked = known ? null : await this.fileRepo.findOne({ where: { sha, shopBlockedAt: Not(IsNull()) }, select: ['id', 'shopBlockedAt', 'shopBlockedBy'] });
    const file = known || (await this.fileRepo.save(this.fileRepo.create({
      id: crypto.randomUUID(), ownerId: user.userId, sha, size, html, manifest,
      shopBlockedAt: blocked?.shopBlockedAt ?? null, shopBlockedBy: blocked?.shopBlockedBy ?? null,
    })));
    return { fileId: file.id, manifest: file.manifest, size: file.size, sha };
  }

  private frameUrls(fileId: string, parentOrigin: string, expires: number) {
    const origin = appOrigin();
    if (!origin) throw new ForbiddenException('HTML-Apps sind auf diesem Server nicht eingerichtet (HTML_APP_ORIGIN).');
    const t = issueToken({ k: 'view', f: fileId, o: parentOrigin }, expires);
    return { appOrigin: origin, shellUrl: `${origin}${FRAME_PREFIX}shell?t=${encodeURIComponent(t)}` };
  }

  private parentOrigin(headers: Record<string, any>) {
    const origin = parentOriginOf(headers);
    if (!origin) throw new ForbiddenException('Diese Seite darf die HTML-App nicht öffnen.');
    return origin;
  }

  /** Oberstes Modul der App und der Abschnitt, falls ein Untermodul gemeint ist. */
  private async rootOf(moduleId: string) {
    const mod = await this.moduleRepo.findOne({ where: { id: moduleId } });
    if (!mod) throw new NotFoundException('Modul nicht gefunden.');
    if (mod.type === 'htmlAppUnit' && mod.parentId) {
      const root = await this.moduleRepo.findOne({ where: { id: mod.parentId } });
      if (!root) throw new NotFoundException('Modul nicht gefunden.');
      return { root, startUnit: (contentOf(mod).unit as string) || null };
    }
    if (mod.type !== 'htmlApp') throw new NotFoundException('Keine HTML-App.');
    return { root: mod, startUnit: null };
  }

  /** Vorschau der Lehrkraft: gespeichertes Modul oder eben hochgeladene eigene Datei. Nichts wird gemeldet. */
  async preview(user: any, headers: Record<string, any>, body: { moduleId?: string; fileId?: string }) {
    let fileId = '';
    let startUnit: string | null = null;
    if (body?.fileId) {
      const file = await this.fileRepo.findOne({ where: { id: String(body.fileId) }, select: ['id', 'ownerId'] });
      if (file && file.ownerId === user.userId) fileId = file.id;
    }
    if (!fileId && body?.moduleId) {
      const found = await this.rootOf(String(body.moduleId));
      // Bei einem Nutzungsrecht sind nur die sichtbaren Module dabei: Eine gesperrte App fehlt dort.
      const topic = await this.topics.findOneFor(found.root.topicId, user, 'read');
      if (!(topic.modules || []).some((m) => m.id === found.root.id)) throw new NotFoundException('Die App wurde nicht gefunden.');
      fileId = contentOf(found.root).app?.fileId;
      startUnit = found.startUnit;
    }
    if (!fileId) throw new NotFoundException('Die Datei der App wurde nicht gefunden.');
    const file = await this.fileRepo.findOne({ where: { id: fileId }, select: ['id', 'manifest'] });
    if (!file) throw new NotFoundException('Die Datei der App wurde nicht gefunden.');
    this.requireCurrent(file);
    return {
      ...this.frameUrls(file.id, this.parentOrigin(headers), Date.now() + LIFETIME_MS),
      mode: 'preview', session: null, state: null, unit: startUnit, manifest: file.manifest ?? null,
    };
  }

  /**
   * Öffnen im Durchlauf: Der Aufrufer hat den Zugang zum Link geprüft und gibt
   * die Module weiter, die der Link enthält. Mit Schülerausweis wird
   * gespeichert, ohne ihn nur auf dem Gerät – wenn die Lehrkraft das zulässt.
   */
  async open(headers: Record<string, any>, input: {
    moduleId: string;
    listed: LearningModule[];
    student: { id: string; name: string; expires: number; linkId: string } | null;
  }) {
    const parentOrigin = this.parentOrigin(headers);
    const { root } = await this.rootOf(input.moduleId);
    const entry = input.listed.find((m) => m.id === root.id);
    if (!entry) throw new NotFoundException('Diese App gehört nicht zum Link.');
    const topic = await this.topicRepo.findOne({ where: { id: root.topicId }, select: ['id', 'ownerId'] });
    if (!topic || !(await this.features.has(topic.ownerId, 'htmlApps'))) throw new ForbiddenException('Für diese App gibt es hier keine Freischaltung.');
    const content = contentOf(root);
    const fileId = content.app?.fileId;
    const file = fileId ? await this.fileRepo.findOne({ where: { id: fileId }, select: ['id', 'manifest'] }) : null;
    if (!file) throw new NotFoundException('Die Datei der App wurde nicht gefunden.');
    this.requireCurrent(file);
    if (!input.student && content.allowAnonymous === false) throw new ForbiddenException('Diese App ist nur mit Anmeldung nutzbar.');

    const expires = input.student?.expires ?? Date.now() + LIFETIME_MS;
    let state: unknown = null;
    if (input.student && !isTestStudent(input.student.id)) {
      const row = await this.stateRepo.findOne({ where: { moduleId: root.id, studentId: input.student.id } });
      if (row) { try { state = JSON.parse(row.data); } catch { state = null; } }
    }
    return {
      ...this.frameUrls(file.id, parentOrigin, expires),
      mode: input.student ? 'practice' : 'anonymous',
      session: input.student
        ? issueToken({ k: 'session', m: root.id, l: input.student.linkId, s: input.student.id, n: input.student.name }, expires)
        : null,
      state, manifest: file.manifest ?? null, rootId: root.id,
    };
  }

  /** Eine App nach der alten Schnittstelle läuft nicht mehr, bis sie umgebaut ist. */
  private requireCurrent(file: { manifest?: any }) {
    if (file.manifest?.lmApp !== 2) throw new ForbiddenException('Diese HTML-App nutzt noch die alte Schnittstelle und muss umgebaut werden.');
  }

  private allowReport(token: string, now = Date.now()) {
    const key = crypto.createHash('sha1').update(token).digest('base64');
    const minute = Math.floor(now / 60000);
    if (this.reports.size > 5000) this.reports.clear();
    const seen = this.reports.get(key);
    if (seen?.minute !== minute) { this.reports.set(key, { minute, count: 1 }); return true; }
    seen.count += 1;
    return seen.count <= REPORTS_PER_MINUTE;
  }

  /**
   * Meldung der App, weitergereicht von der Hauptseite. Ablehnungen landen über
   * `lm.error` bei der App. Meldungen eines Schülers laufen nacheinander: `LM.flush`
   * schickt mehrere zugleich, und jede liest und schreibt dieselben Zeilen.
   */
  async report(body: { session?: string; type?: string; data?: any }) {
    const session = readToken<SessionToken>(body?.session, 'session');
    if (!session) throw new ForbiddenException('Die Anmeldung ist abgelaufen.');
    if (!this.allowReport(String(body.session))) throw new HttpException('Zu viele Meldungen.', 429);
    const key = `${session.l}:${session.s}`;
    const run = (this.queues.get(key) || Promise.resolve()).catch(() => undefined).then(() => this.handleReport(session, body));
    this.queues.set(key, run);
    try {
      return await run;
    } finally {
      if (this.queues.get(key) === run) this.queues.delete(key);
    }
  }

  private async handleReport(session: SessionToken, body: { type?: string; data?: any }) {
    const refuse = (code: string, message: string) => ({ success: false, stored: false, code, message });
    if (isTestStudent(session.s)) return { success: true, stored: false };
    const link = await this.linkRepo.findOne({ where: { id: session.l } });
    if (!link || !link.active) throw new ForbiddenException('Dieser Link ist derzeit deaktiviert.');
    const root = await this.moduleRepo.findOne({ where: { id: session.m } });
    if (!root || root.type !== 'htmlApp') throw new NotFoundException('Modul nicht gefunden.');
    // Ergebnisse und Liveview laufen über den normalen Durchlauf, hier bleibt nur der Stand der App.
    if (body.type !== 'lm.state') throw new BadRequestException('Unbekannte Meldung.');
    const data = JSON.stringify(body.data?.data ?? null);
    if (Buffer.byteLength(data) > MAX_STATE_BYTES) return refuse('state-too-large', `Der Stand ist größer als ${MAX_STATE_BYTES / 1024} KB.`);
    const row = (await this.stateRepo.findOne({ where: { moduleId: root.id, studentId: session.s } }))
      || this.stateRepo.create({ id: crypto.randomUUID(), moduleId: root.id, studentId: session.s });
    row.data = data;
    await this.stateRepo.save(row);
    return { success: true, stored: true };
  }

  /** Für den Admin: alle Dateien ohne Quelltext, mit Besitzer und den Modulen, die sie nutzen. */
  async adminList() {
    const files = await this.fileRepo.find({
      select: ['id', 'ownerId', 'sha', 'size', 'manifest', 'createdAt', 'shopBlockedAt', 'shopBlockedBy'],
      order: { createdAt: 'DESC' },
    });
    const modules = await this.moduleRepo.find({ where: { type: 'htmlApp' }, select: ['id', 'title', 'content', 'topicId'] });
    const topics = await this.topicRepo.find({ where: { id: In([...new Set(modules.map((m) => m.topicId))]) }, select: ['id', 'title'] });
    const users = await this.userRepo.find({ where: { id: In([...new Set(files.flatMap((f) => [f.ownerId, f.shopBlockedBy]).filter((x): x is string => !!x))]) }, select: ['id', 'displayName', 'email', 'active', 'features', 'featuresDenied'] });
    const nameOf = (id?: string | null) => { const u = users.find((x) => x.id === id); return u ? u.displayName || u.email : ''; };
    const mayUse = new Set<string>();
    for (const u of users) if (u.active !== false && (await this.features.enabledFor(u)).includes('htmlApps')) mayUse.add(u.id);
    return files.map((f) => ({
      id: f.id, sha: f.sha, size: f.size, createdAt: f.createdAt, owner: nameOf(f.ownerId),
      ownerAllowed: mayUse.has(f.ownerId),
      title: f.manifest?.title ?? '', version: f.manifest?.version ?? '', current: f.manifest?.lmApp === 2,
      units: f.manifest?.units?.length ?? 0, steps: (f.manifest?.units || []).reduce((n: number, u: any) => n + (u.steps?.length || 0), 0),
      shopBlocked: !!f.shopBlockedAt, blockedBy: nameOf(f.shopBlockedBy), blockedAt: f.shopBlockedAt,
      usedIn: modules.filter((m) => appFileIdOf(m) === f.id).map((m) => ({ title: m.title, topic: topics.find((t) => t.id === m.topicId)?.title ?? '' })),
    }));
  }

  /** Quelltext zum Lesen. Die Oberfläche zeigt ihn als Text, er läuft dort nie. */
  async adminSource(id: string) {
    const file = await this.fileRepo.findOne({ where: { id: String(id) }, select: ['id', 'sha', 'html'] });
    if (!file) throw new NotFoundException('Die Datei wurde nicht gefunden.');
    return { sha: file.sha, html: file.html, intact: hex(file.html) === file.sha };
  }

  /** Nimmt eine Fassung aus dem Shop oder lässt sie wieder zu; gilt für alle Dateien mit diesem Hash. */
  async setShopBlock(id: string, blocked: boolean, user: any) {
    const file = await this.fileRepo.findOne({ where: { id: String(id) }, select: ['id', 'sha'] });
    if (!file) throw new NotFoundException('Die Datei wurde nicht gefunden.');
    await this.fileRepo.update({ sha: file.sha }, { shopBlockedAt: blocked ? new Date() : null, shopBlockedBy: blocked ? user.userId : null });
    return { success: true, shopBlocked: blocked };
  }

  /**
   * Liefert nur aus, was jetzt noch die Prüfung besteht und dessen Hash stimmt. Das Ergebnis hängt
   * am Hash der Datei und an der Fassung der Regeln, nicht am Zeitpunkt des Hochladens.
   */
  private readonly inspected = new Map<string, { errors: string[]; scripts: string[] }>();

  private inspectOnce(sha: string, html: string) {
    const key = `${CHECK_VERSION}:${sha}`;
    let found = this.inspected.get(key);
    if (!found) {
      if (this.inspected.size > 200) this.inspected.clear();
      found = inspectApp(html);
      this.inspected.set(key, found);
    }
    return found;
  }

  async frame(kind: 'shell' | 'app', token: unknown) {
    const view = readToken<ViewToken>(token, 'view');
    const origin = appOrigin();
    if (!view || !origin) return null;
    if (kind === 'shell') return shellPage(String(token), view.o);
    const file = await this.fileRepo.findOne({ where: { id: view.f } });
    if (!file || hex(file.html) !== file.sha) return null;
    const { errors, scripts } = this.inspectOnce(file.sha, file.html);
    if (errors.length) return null;
    const { html, scriptHashes } = deliverable(file.html, scripts);
    return { html, headers: appHeaders(origin, view.o, scriptHashes) };
  }
}
