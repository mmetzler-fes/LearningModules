import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { HtmlAppFile } from '../core/entities/html-app-file.entity';
import { HtmlAppState } from '../core/entities/html-app-state.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { Result } from '../core/entities/result.entity';
import { RunProgress } from '../core/entities/run-progress.entity';
import { TopicLink } from '../core/entities/topic-link.entity';
import { ClassesService } from '../classes/classes.service';
import { isTestStudent } from '../classes/test-student';
import { FeaturesService } from '../features/features.service';
import { TopicsService } from '../topics/topics.service';
import {
  appHeaders, appOrigin, cleanProgress, cleanResult, FRAME_PREFIX, issueToken, LIFETIME_MS, MAX_FILE_BYTES, MAX_STATE_BYTES,
  parentOriginOf, parseManifest, readToken, SessionToken, shellPage, ViewToken,
} from './html-app-rules';

/** Höchstens so viele Meldungen je Sitzung und Minute; die Bridge bündelt, mehr schickt keine ehrliche App. */
const REPORTS_PER_MINUTE = 120;

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
    @InjectRepository(Result) private readonly resultRepo: Repository<Result>,
    @InjectRepository(RunProgress) private readonly progressRepo: Repository<RunProgress>,
    @InjectRepository(TopicLink) private readonly linkRepo: Repository<TopicLink>,
    private readonly classes: ClassesService,
    private readonly features: FeaturesService,
    private readonly topics: TopicsService,
  ) {}

  /** Datei prüfen und ablegen. Dieselbe Datei desselben Kontos entsteht nicht zweimal. */
  async upload(user: any, html: unknown) {
    if (typeof html !== 'string' || !html.trim()) throw new BadRequestException('Keine HTML-Datei angekommen.');
    const size = Buffer.byteLength(html);
    if (size > MAX_FILE_BYTES) throw new BadRequestException(`Die Datei ist zu groß (höchstens ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
    const { manifest, errors } = parseManifest(html);
    if (errors.length) throw new BadRequestException(`Steckbrief ungültig: ${errors.join(' ')}`);
    const sha = crypto.createHash('sha256').update(html).digest('hex');
    const known = await this.fileRepo.findOne({ where: { ownerId: user.userId, sha }, select: ['id', 'manifest', 'size'] });
    const file = known || (await this.fileRepo.save(this.fileRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, sha, size, html, manifest })));
    return {
      fileId: file.id, manifest: file.manifest ?? null, size: file.size,
      warnings: file.manifest ? [] : ['Kein Steckbrief gefunden: Die App wird nur angezeigt, ohne Lernstand und Ergebnisse.'],
    };
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
      await this.topics.findOneFor(found.root.topicId, user, 'read');
      fileId = contentOf(found.root).app?.fileId;
      startUnit = found.startUnit;
    }
    if (!fileId) throw new NotFoundException('Die Datei der App wurde nicht gefunden.');
    const file = await this.fileRepo.findOne({ where: { id: fileId }, select: ['id', 'manifest'] });
    if (!file) throw new NotFoundException('Die Datei der App wurde nicht gefunden.');
    return {
      ...this.frameUrls(file.id, this.parentOrigin(headers), Date.now() + LIFETIME_MS),
      mode: 'preview', session: null, state: null, unit: startUnit, enabledUnits: null, manifest: file.manifest ?? null,
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
    const { root, startUnit } = await this.rootOf(input.moduleId);
    const entry = input.listed.find((m) => m.id === root.id);
    if (!entry) throw new NotFoundException('Diese App gehört nicht zum Link.');
    const topic = await this.topicRepo.findOne({ where: { id: root.topicId }, select: ['id', 'ownerId'] });
    if (!topic || !(await this.features.has(topic.ownerId, 'htmlApps'))) throw new ForbiddenException('Für diese App gibt es hier keine Freischaltung.');
    const content = contentOf(root);
    const fileId = content.app?.fileId;
    const file = fileId ? await this.fileRepo.findOne({ where: { id: fileId }, select: ['id', 'manifest'] }) : null;
    if (!file) throw new NotFoundException('Die Datei der App wurde nicht gefunden.');
    if (!input.student && content.allowAnonymous === false) throw new ForbiddenException('Diese App ist nur mit Anmeldung nutzbar.');

    const all = (file.manifest?.units || []).map((u: any) => u.id);
    const kids = ((entry as any).subModules || []) as LearningModule[];
    const picked = kids.map((k) => contentOf(k).unit).filter((u) => all.includes(u));
    const enabledUnits = picked.length && picked.length < all.length ? picked : null;

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
      state, unit: startUnit, enabledUnits, manifest: file.manifest ?? null, rootId: root.id,
    };
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

    if (body.type === 'lm.state') {
      const data = JSON.stringify(body.data?.data ?? null);
      if (Buffer.byteLength(data) > MAX_STATE_BYTES) return refuse('state-too-large', `Der Stand ist größer als ${MAX_STATE_BYTES / 1024} KB.`);
      const row = (await this.stateRepo.findOne({ where: { moduleId: root.id, studentId: session.s } }))
        || this.stateRepo.create({ id: crypto.randomUUID(), moduleId: root.id, studentId: session.s });
      row.data = data;
      await this.stateRepo.save(row);
      return { success: true, stored: true };
    }

    const kids = await this.moduleRepo.find({ where: { parentId: root.id } });
    const kid = kids.find((k) => contentOf(k).unit === body.data?.unit && !contentOf(k).removed);
    if (!kid) return refuse('unknown-unit', `Den Abschnitt „${String(body.data?.unit ?? '').slice(0, 40)}“ gibt es im Steckbrief nicht.`);
    const kind = contentOf(kid).kind;

    if (body.type === 'lm.result') {
      if (kind !== 'graded') return refuse('not-graded', 'Ergebnisse gibt es nur bei Abschnitten mit „kind: graded“.');
      const clean = cleanResult(body.data);
      if ('error' in clean) return refuse('bad-result', clean.error);
      await this.saveResult(link, root, kid, session, {
        score: clean.score, maxScore: clean.max,
        detail: { points: clean.score / clean.max, isCorrect: clean.score >= clean.max, userAnswer: `${clean.score} von ${clean.max}`, items: clean.items },
      });
      return { success: true, stored: true };
    }
    if (body.type === 'lm.progress') {
      const clean = cleanProgress(body.data);
      if ('error' in clean) return refuse('bad-progress', clean.error);
      await this.saveLive(link.id, session.s, kid, clean);
      // Nur Fortschritt: Der Abschnitt zählt als bearbeitet, ohne Prozent.
      const seen = kind === 'info' ? clean.active : kind === 'practice' && !clean.active && (clean.done ?? 0) > 0;
      if (seen) {
        await this.saveResult(link, root, kid, session, {
          score: 0, maxScore: 0,
          detail: { informational: true, isCorrect: true, points: null, userAnswer: clean.active ? 'Angesehen' : `${clean.done} von ${clean.total}` },
        });
      }
      return { success: true, stored: true };
    }
    throw new BadRequestException('Unbekannte Meldung.');
  }

  /** Je Schüler und Abschnitt ein Eintrag: Die App meldet immer den Gesamtstand. */
  private async saveResult(link: TopicLink, root: LearningModule, kid: LearningModule, session: SessionToken, r: { score: number; maxScore: number; detail: any }) {
    const klasse = await this.classes.findById(link.classId);
    const topic = await this.topicRepo.findOne({ where: { id: root.topicId }, select: ['id', 'title'] });
    const row = (await this.resultRepo.findOne({ where: { linkId: link.id, studentId: session.s, moduleId: kid.id, mode: 'app' } }))
      || this.resultRepo.create({
        id: crypto.randomUUID(), linkId: link.id, studentId: session.s, moduleId: kid.id, mode: 'app', teacherId: link.ownerId,
        topicId: root.topicId, linkName: link.name, classId: klasse?.id ?? null, className: klasse?.name ?? null,
        schoolYear: klasse?.schoolYear || (await this.classes.currentSchoolYear()),
      });
    Object.assign(row, {
      studentName: session.n, score: r.score, maxScore: r.maxScore,
      payload: {
        topicTitle: topic?.title, moduleTitle: root.title, percentage: r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0,
        details: [{ moduleId: kid.id, title: kid.title, correctAnswer: '', appReported: true, ...r.detail }],
      },
    });
    await this.resultRepo.save(row);
  }

  /** Stand für den Liveview, am Durchlauf des Schülers. Ohne Durchlauf gibt es nichts anzuzeigen. */
  private async saveLive(linkId: string, studentId: string, kid: LearningModule, p: { unit: string; active: boolean; done?: number; total?: number }) {
    const row = await this.progressRepo.findOne({ where: { linkId, studentId } });
    if (!row) return;
    const app = row.appUnits || { active: null, units: {} };
    const prev = app.units[p.unit] || {};
    // „Gerade dran“ sagt LM.enter; eine App ohne enter zeigt den ersten gemeldeten Abschnitt.
    if (p.active || !app.active) app.active = p.unit;
    app.units[p.unit] = { title: kid.title, done: (p.active ? prev.done : p.done) ?? null, total: (p.active ? prev.total : p.total) ?? null };
    row.appUnits = { ...app };
    await this.progressRepo.save(row);
  }

  async frame(kind: 'shell' | 'app', token: unknown) {
    const view = readToken<ViewToken>(token, 'view');
    const origin = appOrigin();
    if (!view || !origin) return null;
    if (kind === 'shell') return shellPage(String(token), view.o);
    const file = await this.fileRepo.findOne({ where: { id: view.f } });
    return file ? { html: file.html, headers: appHeaders(origin, view.o) } : null;
  }
}
