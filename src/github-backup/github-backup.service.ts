import { Injectable, Logger, Optional, BadRequestException, ForbiddenException, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { DocumentInk } from '../core/entities/document-ink.entity';
import { GithubBackup } from '../core/entities/github-backup.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { MailService } from '../core/mail/mail.service';
import { ImportService } from '../core/interchange/import/import.service';
import { ownModules, topicJson } from '../core/interchange/export/export.service';
import { isDue, nextSlot, DAY } from '../core/schedule/slot';
import { NextcloudService } from '../nextcloud/nextcloud.service';
import { GithubRepo, parseRepo } from './github-api';
import { BackupTopic, INDEX_PATH, parseDocIndex, parseIndex, pickModules, planBackup, topicIdOf } from './backup-plan';
import { buildZlm } from './zlm-export';

/**
 * GitHub-Backup je Lehrkraft (docs/github-backup.md).
 *
 * Gesichert wird, was auch der offene JSON-Export herausgibt: in jedem Thema
 * nur die selbst verfassten Module. Gekauftes oder übernommenes Material
 * verlässt die App so wenig wie beim Export.
 *
 * Je Lauf: Dateibaum holen, je Thema den Git-SHA des JSON lokal berechnen
 * und vergleichen; nur Geändertes und Neues geht hoch, alles in einem
 * Commit. Dazu jedes Dokument als .zlm im Aufbau des Notizbuchs (mit
 * Bildern und der Beschriftung der Lehrkraft) – zum Öffnen im lm-editor.
 * Gelöscht werden nur die alten Orte verschobener .zlm.
 *
 * Der Admin kann die Funktion serverweit abschalten (Standard: erlaubt).
 */

const ALLOWED_KEY = 'github_backup_allowed';
const README = `# LearningModules – Backup

Dieses Repository füllt LearningModules automatisch mit den selbst verfassten
Lerninhalten: je Lernthema eine JSON-Datei im Ordner \`themen/\` und jedes
Dokument (Arbeitsblatt, Klassenarbeit …) als .zlm im Ordner \`Notizbuch/\` –
geordnet wie im Notizbuch der App.

- Eine .zlm öffnet der lm-editor (https://mmetzler-fes.github.io/lm-editor/),
  auch ohne Server und offline – mit Bildern, Quizzen und deiner Beschriftung.
- Jede JSON-Datei lässt sich in LearningModules wieder importieren – oder direkt
  aus der App heraus wiederherstellen (🏠 → 💾 GitHub-Backup).
- Ältere Stände stehen in der Versionsgeschichte (History) jeder Datei.
- Gelöschte Themen bleiben hier liegen, bis du die Datei selbst löschst.

**Bitte privat halten** – die Dateien enthalten auch Lösungen.
`;

@Injectable()
export class GithubBackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GithubBackupService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(GithubBackup) private readonly backupRepo: Repository<GithubBackup>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(DocumentInk) private readonly inkRepo: Repository<DocumentInk>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placementRepo: Repository<NotebookPlacement>,
    private readonly masterKey: MasterKeyService,
    private readonly mail: MailService,
    private readonly importService: ImportService,
    @Optional() private readonly nextcloud?: NextcloudService,
  ) {}

  // ---- Freigabe durch den Admin ----

  async isAllowed() {
    const row = await this.configRepo.findOne({ where: { key: ALLOWED_KEY } });
    return row?.value?.allowed !== false;
  }

  async setAllowed(allowed: boolean) {
    await this.configRepo.save(this.configRepo.create({ key: ALLOWED_KEY, value: { allowed: !!allowed } }));
    return { allowed: !!allowed };
  }

  private async requireAllowed() {
    if (!(await this.isAllowed())) {
      throw new ForbiddenException('Das GitHub-Backup ist auf diesem Server abgeschaltet.');
    }
  }

  // ---- Einstellungen ----

  private async find(userId: string) {
    return this.backupRepo.findOne({ where: { userId } });
  }

  private async findOrNew(userId: string) {
    return (await this.find(userId)) || this.backupRepo.create({ id: crypto.randomUUID(), userId });
  }

  /** Was die Oberfläche sehen darf – ohne Token. */
  async status(user: any) {
    const allowed = await this.isAllowed();
    const b = await this.find(user.userId);
    if (!b) return { allowed, configured: false, config: { repo: '', hasToken: false, enabled: false, interval: 'daily', weekday: 1, hour: 18 } };
    return {
      allowed,
      configured: true,
      config: { repo: b.repo, hasToken: !!b.tokenSealed, enabled: b.enabled, interval: b.interval, weekday: b.weekday, hour: b.hour },
      state: {
        lastAttemptAt: b.lastAttemptAt,
        lastSuccessAt: b.lastSuccessAt,
        lastStatus: b.lastStatus,
        lastError: b.lastError,
        lastResult: b.lastResult,
        tokenExpiresAt: b.tokenExpiresAt,
      },
      nextRunAt: allowed && b.enabled ? nextSlot(b, new Date()).toISOString() : null,
    };
  }

  async saveConfig(user: any, input: any) {
    await this.requireAllowed();
    const b = await this.findOrNew(user.userId);
    if (input.repo !== undefined) {
      const raw = String(input.repo || '').trim();
      const repo = raw ? parseRepo(raw) : '';
      if (repo === null) throw new BadRequestException('Repository bitte als „benutzer/repository“ angeben.');
      b.repo = repo;
    }
    if (input.token) {
      const token = String(input.token).trim();
      if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new BadRequestException('Das sieht nicht nach einem GitHub-Token aus.');
      b.tokenSealed = this.masterKey.sealSecret(token);
      b.tokenExpiresAt = null;
      b.expiryNotified = false;
    }
    if (input.interval !== undefined) b.interval = input.interval === 'weekly' ? 'weekly' : 'daily';
    if (input.weekday !== undefined) b.weekday = this.int(input.weekday, 0, 6, 'Wochentag');
    if (input.hour !== undefined) b.hour = this.int(input.hour, 0, 23, 'Uhrzeit');
    if (input.enabled !== undefined) b.enabled = !!input.enabled;
    if (b.enabled && (!b.repo || !b.tokenSealed)) {
      throw new BadRequestException('Zum Einschalten braucht es Repository und Token.');
    }
    await this.backupRepo.save(b);
    return this.status(user);
  }

  /** Token und Einstellungen vergessen. Im Repository bleibt alles, wie es ist. */
  async disconnect(user: any) {
    await this.backupRepo.delete({ userId: user.userId });
    return { success: true };
  }

  private int(v: any, min: number, max: number, field: string) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new BadRequestException(`${field}: bitte eine ganze Zahl zwischen ${min} und ${max}.`);
    }
    return n;
  }

  private client(b: GithubBackup | null) {
    if (!b || !b.repo || !b.tokenSealed) throw new BadRequestException('Bitte zuerst Repository und Token speichern.');
    let token: string;
    try {
      token = this.masterKey.unsealSecret(b.tokenSealed);
    } catch {
      // Etwa nach dem Umzug auf einen Server mit anderem App-Secret.
      throw new BadRequestException('Der gespeicherte Token lässt sich nicht mehr lesen – bitte neu eintragen.');
    }
    return new GithubRepo(b.repo, token);
  }

  private async noteExpiry(b: GithubBackup, gh: GithubRepo) {
    if (!gh.tokenExpiresAt) return;
    if (!b.tokenExpiresAt || b.tokenExpiresAt.getTime() !== gh.tokenExpiresAt.getTime()) {
      b.tokenExpiresAt = gh.tokenExpiresAt;
      b.expiryNotified = false;
    }
  }

  /** Lesen, Schreibrecht und Sichtbarkeit prüfen, ohne etwas zu ändern. */
  async test(user: any) {
    await this.requireAllowed();
    const b = await this.find(user.userId);
    const gh = this.client(b);
    const info = await gh.info();
    if (info.canPush === false) {
      throw new BadRequestException('Der Token darf in dieses Repository nicht schreiben – er braucht „Contents: Read and write“.');
    }
    const head = await gh.head();
    const files = head ? (await gh.tree(head.treeSha)).filter((e) => topicIdOf(e.path)).length : 0;
    await this.noteExpiry(b!, gh);
    await this.backupRepo.save(b!);
    const warning = info.private
      ? null
      : '⚠️ Das Repository ist öffentlich – jeder, auch deine Schülerinnen und Schüler, kann die Lösungen lesen. Bitte auf GitHub unter Settings → Danger Zone auf „Private“ stellen.';
    return {
      success: true,
      private: info.private,
      warning,
      tokenExpiresAt: gh.tokenExpiresAt,
      message: `Verbindung zu ${info.fullName} in Ordnung – ${head ? `${files} Themendatei${files === 1 ? '' : 'en'} im Repository` : 'Repository noch leer'}.`,
    };
  }

  // ---- Zeitplan ----

  onApplicationBootstrap() {
    const tick = () => this.tick().catch((err) => this.logger.error('Prüfung der GitHub-Backups fehlgeschlagen', err));
    setTimeout(tick, 60 * 1000).unref?.();
    this.timer = setInterval(tick, 10 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.ticking || !(await this.isAllowed())) return;
    this.ticking = true;
    try {
      const now = new Date();
      for (const b of await this.backupRepo.find({ where: { enabled: true } })) {
        if (!b.repo || !b.tokenSealed || !isDue(b, b, now)) continue;
        const user = await this.userRepo.findOne({ where: { id: b.userId } });
        if (!user || user.active === false) continue;
        // Nacheinander, nicht parallel – schont GitHub und den Server.
        await this.runFor(b.userId).catch(() => undefined);
      }
    } finally {
      this.ticking = false;
    }
  }

  // ---- Lauf ----

  /** Alle Themen mit eigenen Modulen, im Format des JSON-Exports – und ihre Dokumente als .zlm. */
  private async collect(userId: string): Promise<BackupTopic[]> {
    const own = await this.moduleRepo.find({ where: { creatorId: userId }, select: ['id', 'topicId'] });
    const topicIds = [...new Set(own.map((m) => m.topicId).filter(Boolean))];
    const folderOf = await this.notebookFolders(userId, topicIds);
    const local = this.nextcloud ? (url: string) => this.nextcloud!.readImageByUrl(url) : undefined;
    const out: BackupTopic[] = [];
    for (let i = 0; i < topicIds.length; i += 200) {
      const topics = await this.topicRepo.find({ where: { id: In(topicIds.slice(i, i + 200)) }, relations: ['modules'] });
      for (const t of topics) {
        const modules = ownModules(t.modules || [], userId).sort((a, b) => a.orderIndex - b.orderIndex);
        if (!modules.length) continue;
        const title = t.title || 'Ohne Titel';
        const docs = modules.filter((m) => m.type === 'document');
        const inks = docs.length ? await this.inkRepo.find({ where: { id: In(docs.map((d) => d.id)), ownerId: userId } }) : [];
        const documents = [];
        for (const d of docs) {
          const ink = inks.find((x) => x.id === d.id) || null;
          documents.push({ id: d.id, title: d.title || 'Dokument', bytes: await buildZlm({ doc: d, modules, ink }, { local }) });
        }
        out.push({
          id: t.id,
          title,
          content: JSON.stringify(topicJson(t, modules), null, 2) + '\n',
          modules: modules.filter((m) => !m.parentId).length,
          folder: [...(folderOf.get(t.id) || ['Unsortiert']), title],
          documents,
        });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Ordner im Notizbuch der Lehrkraft je Thema: Book, Bereich, Abschnitt (ohne das Thema). */
  private async notebookFolders(userId: string, topicIds: string[]) {
    const nodes = new Map((await this.nodeRepo.find({ where: { ownerId: userId } })).map((n) => [n.id, n]));
    const pathOf = (nodeId: string | null) => {
      const titles: string[] = [];
      const seen = new Set<string>();
      for (let n = nodeId ? nodes.get(nodeId) : undefined; n && !seen.has(n.id); n = n.parentId ? nodes.get(n.parentId) : undefined) {
        seen.add(n.id);
        titles.unshift(n.title || 'Ohne Titel');
      }
      return titles.length ? titles : null;
    };
    const out = new Map<string, string[]>();
    for (let i = 0; i < topicIds.length; i += 200) {
      for (const p of await this.placementRepo.find({ where: { ownerId: userId, topicId: In(topicIds.slice(i, i + 200)) } })) {
        const path = pathOf(p.nodeId);
        if (path) out.set(p.topicId, path);
      }
    }
    return out;
  }

  async run(user: any) {
    await this.requireAllowed();
    return this.runFor(user.userId);
  }

  private async runFor(userId: string) {
    if (this.running.has(userId)) throw new BadRequestException('Es läuft bereits ein Backup.');
    this.running.add(userId);
    const b = await this.find(userId);
    const now = new Date();
    try {
      const gh = this.client(b);
      b!.lastAttemptAt = now;
      await this.backupRepo.save(b!);

      const info = await gh.info();
      if (info.canPush === false) {
        throw new BadRequestException('Der Token darf in dieses Repository nicht schreiben – er braucht „Contents: Read and write“.');
      }
      const head = (await gh.head()) || (await gh.initialize('README.md', README, 'LearningModules-Backup eingerichtet'));
      const tree = await gh.tree(head.treeSha);
      const indexText = tree.some((e) => e.path === INDEX_PATH) ? await gh.read(INDEX_PATH, head.commitSha) : null;
      const plan = planBackup(tree, await this.collect(userId), parseIndex(indexText), parseDocIndex(indexText));

      let commit: string | null = null;
      if (plan.files.length || plan.remove.length) {
        const parts = [
          plan.updated.length ? `${plan.updated.length} geändert` : '',
          plan.created.length ? `${plan.created.length} neu` : '',
        ].filter(Boolean);
        const summary = parts.join(', ') || 'Index aktualisiert';
        const names = [...plan.created, ...plan.updated];
        const body = names.length ? `\n\n${names.map((n) => `- ${n}`).join('\n')}` : '';
        commit = await gh.commit(head, plan.files, `Backup ${now.toLocaleDateString('de-DE')}: ${summary}${body}`, plan.remove);
      }

      const result = { created: plan.created.length, updated: plan.updated.length, unchanged: plan.unchanged, commit };
      await this.noteExpiry(b!, gh);
      Object.assign(b!, { lastSuccessAt: now, lastStatus: 'ok', lastError: null, lastResult: result, failureNotified: false });
      await this.backupRepo.save(b!);
      await this.warnExpiry(b!);
      this.logger.log(`GitHub-Backup ${b!.repo}: ${result.created} neu, ${result.updated} geändert, ${result.unchanged} unverändert`);
      return { success: true, ...result };
    } catch (err: any) {
      const message = err?.response?.message || err?.message || String(err);
      if (b) {
        b.lastStatus = 'error';
        b.lastError = message;
        if (!b.failureNotified) {
          await this.notify(userId, 'GitHub-Backup fehlgeschlagen',
            `Das Backup deiner Lerninhalte nach GitHub (${b.repo || '?'}) ist fehlgeschlagen:\n\n${message}\n\n` +
            'Die App versucht es stündlich erneut. Einstellungen: 🏠 LernModule → 💾 GitHub-Backup.');
          b.failureNotified = true;
        }
        await this.backupRepo.save(b);
      }
      this.logger.warn(`GitHub-Backup für ${userId} fehlgeschlagen: ${message}`);
      throw new BadRequestException(message);
    } finally {
      this.running.delete(userId);
    }
  }

  /** Zwei Wochen vor Ablauf des Tokens einmal Bescheid geben. */
  private async warnExpiry(b: GithubBackup) {
    if (!b.tokenExpiresAt || b.expiryNotified) return;
    if (b.tokenExpiresAt.getTime() - Date.now() > 14 * DAY) return;
    await this.notify(b.userId, 'GitHub-Token läuft bald ab',
      `Der Token für dein GitHub-Backup (${b.repo}) läuft am ${b.tokenExpiresAt.toLocaleDateString('de-DE')} ab. ` +
      'Danach werden deine Lerninhalte nicht mehr gesichert.\n\n' +
      'Auf GitHub unter Settings → Developer settings → Personal access tokens den Token verlängern (Regenerate) ' +
      'und den neuen in der App eintragen: 🏠 LernModule → 💾 GitHub-Backup.');
    b.expiryNotified = true;
    await this.backupRepo.save(b);
  }

  private async notify(userId: string, subject: string, text: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.email) return;
    await this.mail.sendNotice({ to: user.email, subject, text }).catch(() => undefined);
  }

  // ---- Wiederherstellen ----

  private async readyClient(user: any) {
    await this.requireAllowed();
    return this.client(await this.find(user.userId));
  }

  /** Die gesicherten Themen mit aktuellem Titel (aus dem Index). */
  async files(user: any) {
    const gh = await this.readyClient(user);
    const head = await gh.head();
    if (!head) return { files: [] };
    const tree = await gh.tree(head.treeSha);
    const index = new Map(parseIndex(tree.some((e) => e.path === INDEX_PATH) ? await gh.read(INDEX_PATH, head.commitSha) : null).map((e) => [e.datei, e]));
    const files = tree
      .filter((e) => topicIdOf(e.path))
      .map((e) => ({
        path: e.path,
        title: index.get(e.path)?.titel || e.path.slice('themen/'.length, -'.json'.length),
        modules: index.get(e.path)?.module ?? null,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'de'));
    return { files };
  }

  private checkPath(path: string) {
    if (!topicIdOf(String(path || ''))) throw new BadRequestException('Unbekannte Datei.');
  }

  private checkRef(ref?: string) {
    if (ref && !/^[0-9a-f]{40}$/i.test(ref)) throw new BadRequestException('Unbekannte Version.');
  }

  async versions(user: any, path: string) {
    this.checkPath(path);
    const gh = await this.readyClient(user);
    return { versions: await gh.history(path) };
  }

  private async load(gh: GithubRepo, path: string, ref?: string) {
    this.checkPath(path);
    this.checkRef(ref);
    const text = await gh.read(path, ref || undefined);
    if (text === null) throw new NotFoundException('Diese Datei gibt es in dem Stand nicht.');
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new BadRequestException('Die Datei ist kein gültiges JSON – wurde sie auf GitHub von Hand bearbeitet?');
    }
    const topic = data?.topic;
    if (!topic || !Array.isArray(topic.modules)) throw new BadRequestException('Die Datei enthält kein Lernthema.');
    return topic;
  }

  /** Inhalt eines Stands zur Auswahl der Module. */
  async preview(user: any, path: string, ref?: string) {
    const topic = await this.load(await this.readyClient(user), path, ref);
    const subs = new Map<string, number>();
    for (const m of topic.modules) if (m?.parentId) subs.set(String(m.parentId), (subs.get(String(m.parentId)) || 0) + 1);
    return {
      title: String(topic.title || ''),
      description: String(topic.description || ''),
      modules: topic.modules
        .filter((m: any) => m && !m.parentId)
        .map((m: any) => ({ id: String(m.id), title: String(m.title || ''), type: String(m.type || ''), subModules: subs.get(String(m.id)) || 0 })),
    };
  }

  /** `{ path, ref?, moduleIds, targetTopicId? }` – ohne Ziel entsteht ein neues Thema. */
  async restore(user: any, body: any) {
    const gh = await this.readyClient(user);
    const topic = await this.load(gh, String(body?.path || ''), body?.ref ? String(body.ref) : undefined);
    const ids = Array.isArray(body?.moduleIds) ? body.moduleIds.map(String) : [];
    const modules = pickModules(topic.modules, ids);
    if (!modules.length) throw new BadRequestException('Bitte mindestens ein Modul auswählen.');
    const title = `${String(topic.title || 'Thema')} (wiederhergestellt)`;
    return this.importService.importTopicData(
      { topic: { title, description: topic.description || '', modules } },
      { userId: user.userId },
      body?.targetTopicId ? String(body.targetTopicId) : undefined,
    );
  }
}
