import { Injectable, Logger, BadRequestException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { User } from '../core/entities/user.entity';
import { MailService } from '../core/mail/mail.service';
import { ownModules, topicJson } from '../core/interchange/export/export.service';
import { isDue, nextSlot } from '../core/schedule/slot';
import { NextcloudService } from './nextcloud.service';
import { safeFolderName } from './nextcloud-api';

const BACKUPS = 'Backups';
const README_NAME = 'LIESMICH.txt';
const README = `LearningModules – Backup

Diesen Ordner füllt LearningModules automatisch mit deinen selbst verfassten
Lerninhalten: je Lernthema eine JSON-Datei.

- Jede Datei lässt sich in LearningModules wieder einlesen:
  🏠 LernModule → 📥 Thema importieren → Datei wählen.
- Ältere Stände einer Datei zeigt die Nextcloud unter „Versionen“.
- Gelöschte Themen bleiben hier liegen, bis du die Datei selbst löschst.
- Die Dateien enthalten auch die Lösungen – den Ordner nicht öffentlich teilen.
`;

/** Ein Thema, wie es gesichert wird. */
export interface BackupFile { topicId: string; file: string; content: string; hash: string }

/** Dateiname eines Themas: Titel plus Kennungsanfang – eindeutig und lesbar. */
export function backupFileName(topicId: string, title: string): string {
  return `${safeFolderName(title, 'Ohne Titel')} (${topicId.slice(0, 8)}).json`;
}

/**
 * Was hochgeladen werden muss: neue und geänderte Themen, und solche, deren
 * Datei in der Nextcloud fehlt (z. B. von Hand gelöscht).
 */
export function planNextcloudBackup(files: BackupFile[], previous: Record<string, { file: string; hash: string }>, present: Set<string>) {
  const upload: BackupFile[] = [];
  let unchanged = 0;
  let created = 0;
  for (const f of files) {
    const prev = previous[f.topicId];
    if (prev && prev.hash === f.hash && prev.file === f.file && present.has(f.file)) { unchanged++; continue; }
    if (!prev) created++;
    upload.push(f);
  }
  return { upload, created, updated: upload.length - created, unchanged };
}

/**
 * Backup der eigenen Inhalte in die Nextcloud der Lehrkraft (docs/nextcloud.md):
 * je Lernthema eine JSON-Datei im Format des JSON-Exports – nur selbst
 * verfasste Module, wie beim offenen Export. Hochgeladen wird nur, was sich
 * geändert hat; ältere Stände hält die Versionsverwaltung der Nextcloud.
 */
@Injectable()
export class NextcloudBackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NextcloudBackupService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(NextcloudLink) private readonly linkRepo: Repository<NextcloudLink>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly nextcloud: NextcloudService,
    private readonly mail: MailService,
  ) {}

  /** `{ enabled?, hour? }` */
  async saveSettings(user: any, input: any) {
    const l = await this.linkRepo.findOne({ where: { userId: user.userId } });
    if (!l) throw new BadRequestException('Bitte zuerst die Nextcloud verbinden.');
    if (input.hour !== undefined) {
      const h = Number(input.hour);
      if (!Number.isInteger(h) || h < 0 || h > 23) throw new BadRequestException('Uhrzeit: bitte eine ganze Stunde von 0 bis 23.');
      l.backupHour = h;
    }
    if (input.enabled !== undefined) l.backupEnabled = !!input.enabled;
    await this.linkRepo.save(l);
    return { success: true, enabled: l.backupEnabled, hour: l.backupHour, nextRunAt: l.backupEnabled ? nextSlot(this.schedule(l), new Date()) : null };
  }

  private schedule(l: NextcloudLink) {
    return { interval: 'daily' as const, weekday: 1, hour: l.backupHour };
  }

  onApplicationBootstrap() {
    const tick = () => this.tick().catch((err) => this.logger.error('Prüfung der Nextcloud-Backups fehlgeschlagen', err));
    setTimeout(tick, 90 * 1000).unref?.();
    this.timer = setInterval(tick, 10 * 60 * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      for (const l of await this.linkRepo.find({ where: { backupEnabled: true } })) {
        const state = { lastAttemptAt: l.backupAttemptAt, lastSuccessAt: l.backupSuccessAt, lastStatus: l.backupStatus };
        if (!l.verifiedAt || !isDue(this.schedule(l), state, now)) continue;
        const user = await this.userRepo.findOne({ where: { id: l.userId } });
        if (!user || user.active === false) continue;
        await this.runFor(l.userId).catch(() => undefined); // nacheinander, schont Nextcloud und Server
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Alle Themen mit eigenen Modulen, im Format des JSON-Exports. */
  private async collect(userId: string): Promise<BackupFile[]> {
    const own = await this.moduleRepo.find({ where: { creatorId: userId }, select: ['id', 'topicId'] });
    const topicIds = [...new Set(own.map((m) => m.topicId).filter(Boolean))];
    const out: BackupFile[] = [];
    for (let i = 0; i < topicIds.length; i += 200) {
      const topics = await this.topicRepo.find({ where: { id: In(topicIds.slice(i, i + 200)) }, relations: ['modules'] });
      for (const t of topics) {
        const modules = ownModules(t.modules || [], userId).sort((a, b) => a.orderIndex - b.orderIndex);
        if (!modules.length) continue;
        const content = JSON.stringify(topicJson(t, modules), null, 2) + '\n';
        out.push({ topicId: t.id, file: backupFileName(t.id, t.title), content, hash: crypto.createHash('sha256').update(content).digest('hex') });
      }
    }
    return out;
  }

  async run(user: any) {
    return this.runFor(user.userId);
  }

  private async runFor(userId: string) {
    if (this.running.has(userId)) throw new BadRequestException('Es läuft bereits ein Backup.');
    this.running.add(userId);
    const now = new Date();
    let l: NextcloudLink | null = null;
    try {
      const conn = await this.nextcloud.connection(userId);
      l = conn.l;
      const nc = conn.nc;
      l.backupAttemptAt = now;
      await this.linkRepo.save(l);

      await nc.ensureFolder([l.folder, BACKUPS]);
      const present = new Set((await nc.list([l.folder, BACKUPS])).filter((e) => !e.isFolder).map((e) => e.name));
      if (!present.has(README_NAME)) await nc.put([l.folder, BACKUPS, README_NAME], Buffer.from(README, 'utf-8'), 'text/plain; charset=utf-8');
      const files = await this.collect(userId);
      const plan = planNextcloudBackup(files, l.backupFiles || {}, present);
      const done = { ...(l.backupFiles || {}) };
      for (const f of plan.upload) {
        await nc.put([l.folder, BACKUPS, f.file], Buffer.from(f.content, 'utf-8'), 'application/json');
        done[f.topicId] = { file: f.file, hash: f.hash };
      }
      const result = { created: plan.created, updated: plan.updated, unchanged: plan.unchanged };
      Object.assign(l, { backupFiles: done, backupSuccessAt: now, backupStatus: 'ok', backupError: null, backupResult: result, backupFailureNotified: false });
      await this.linkRepo.save(l);
      return { success: true, ...result };
    } catch (err: any) {
      const message = err?.response?.message || err?.message || String(err);
      if (l) {
        l.backupStatus = 'error';
        l.backupError = message;
        if (!l.backupFailureNotified && l.backupEnabled) {
          await this.notify(userId, 'Nextcloud-Backup fehlgeschlagen',
            `Das Backup deiner Lerninhalte in die Nextcloud ist fehlgeschlagen:\n\n${message}\n\n`
            + 'Die App versucht es stündlich erneut. Einstellungen: 🏠 LernModule → ☁️ Nextcloud.');
          l.backupFailureNotified = true;
        }
        await this.linkRepo.save(l);
      }
      this.logger.warn(`Nextcloud-Backup für ${userId} fehlgeschlagen: ${message}`);
      throw new BadRequestException(message);
    } finally {
      this.running.delete(userId);
    }
  }

  private async notify(userId: string, subject: string, text: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.email) return;
    await this.mail.sendNotice({ to: user.email, subject, text }).catch(() => undefined);
  }
}
