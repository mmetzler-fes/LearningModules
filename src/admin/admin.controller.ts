import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Res,
  ForbiddenException, BadRequestException, UseInterceptors, UploadedFile, Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { UserSheetService } from './user-sheet.service';
import { BackupService } from './backup.service';
import { CloudBackupService } from './cloud-backup.service';
import { AccountsService } from '../accounts/accounts.service';
import { PointsService } from '../accounts/points.service';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { TwoFactorService } from '../accounts/two-factor.service';
import { LearningModule } from '../core/entities/learning-module.entity';
import { School } from '../core/entities/school.entity';
import { MailService } from '../core/mail/mail.service';

/** Zugangsdaten für eine erneute Bestätigung vor heiklen Aktionen. */
type Reauth = { password?: string; code?: string };

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  private readonly logger = new Logger('Admin');

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    private readonly authService: AuthService,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(School) private readonly schoolRepo: Repository<School>,
    private readonly userSheet: UserSheetService,
    private readonly accounts: AccountsService,
    private readonly points: PointsService,
    private readonly masterKey: MasterKeyService,
    private readonly backup: BackupService,
    private readonly cloudBackup: CloudBackupService,
    private readonly twoFactor: TwoFactorService,
    private readonly mail: MailService,
  ) {}

  // ---- Admin only guard helper ----
  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  /**
   * Erneut bestätigen: eigenes Passwort, bei aktiver 2FA auch ein Code.
   * Gilt für alles, womit sich der gesamte Datenbestand mitnehmen oder
   * ersetzen lässt (Masterkey, Backup herunterladen, Backup einspielen).
   * Eine offen gelassene Admin-Sitzung allein reicht dafür nicht.
   */
  private async reauth(req: any, creds: Reauth | undefined) {
    this.requireAdmin(req);
    await this.authService.assertOwnPassword(req.user.userId, creds?.password || '');
    await this.twoFactor.confirmSecondFactor(req.user.userId, creds?.code || '');
  }

  /** Alle anderen aktiven Admins benachrichtigen – ein unbemerkter Eingriff soll auffallen. */
  private async notifyOtherAdmins(req: any, subject: string, text: string) {
    const admins = await this.userRepo.find({ where: { role: 'admin' } });
    const actor = req.user.email || req.user.userId;
    const when = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    this.logger.warn(`${subject} – durch ${actor} am ${when}`);
    for (const a of admins.filter((u) => u.id !== req.user.userId && u.active !== false && u.email)) {
      await this.mail.sendNotice({
        to: a.email,
        subject: `LernModule: ${subject}`,
        text: `${text}\n\nDurch: ${actor}\nZeitpunkt: ${when}\n\n` +
          'Warst du das nicht oder ist es nicht abgesprochen, prüfe bitte sofort die Admin-Konten ' +
          'und ändere die Passwörter.',
      });
    }
  }

  // ---- List all admins and teachers ----
  @Get('users')
  async getAllUsers(@Request() req: any) {
    this.requireAdmin(req);
    const users = await this.userRepo.find();
    const { startPoints } = await this.points.getSettings();
    // Creator-Kennung je Konto in einem Rutsch statt einer Abfrage pro Zeile.
    const modules = await this.moduleRepo.find({ select: ['id', 'creatorId'] });
    const creators = new Set(modules.map((m) => m.creatorId));
    // Geheimnisse bleiben im Server – auch die verschlüsselten.
    return users.map(({ passwordHash, resetPasswordToken, totpSecret, totpPending, totpRecovery, totpLastStep, ...u }) => ({
      ...u,
      points: u.points ?? startPoints,
      isCreator: creators.has(u.id),
    }));
  }

  // ---- Create a new user (teacher or admin) with a generated initial password ----
  @Post('users')
  async createUser(
    @Request() req: any,
    @Body() body: { email: string; role?: UserRole; displayName?: string },
  ) {
    this.requireAdmin(req);
    return this.authService.createUser({
      email: body.email,
      role: body.role === 'admin' ? 'admin' : 'teacher',
      displayName: body.displayName,
    });
  }

  // ---- Reset a user's password to a new generated one ----
  @Post('users/:id/reset-password')
  async resetUserPassword(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.authService.resetUserPassword(id);
  }

  // ---- Change a user's role ----
  @Patch('users/:id/role')
  async setUserRole(@Request() req: any, @Param('id') id: string, @Body() body: { role?: UserRole }) {
    this.requireAdmin(req);
    const role: UserRole = body?.role === 'admin' ? 'admin' : 'teacher';

    const target = await this.userRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Benutzer nicht gefunden.');
    if (target.role === role) return { success: true, id: target.id, role };

    // Sich selbst die Admin-Rechte zu entziehen sperrt einen aus der
    // Benutzerverwaltung aus – das muss ein anderer Admin tun.
    if (target.id === req.user.userId && role !== 'admin') {
      throw new BadRequestException(
        'Du kannst dir die Admin-Rechte nicht selbst entziehen. Bitte von einem anderen Admin ändern lassen.',
      );
    }

    if (target.role === 'admin' && role !== 'admin' && (await this.accounts.otherActiveAdmins(target.id)) === 0) {
      throw new BadRequestException('Es muss mindestens ein aktiver Admin vorhanden bleiben.');
    }

    target.role = role;
    await this.userRepo.save(target);
    return { success: true, id: target.id, role: target.role };
  }

  // ---- Konto entfernen: Creator werden deaktiviert, alle anderen gelöscht ----
  @Delete('users/:id')
  async deleteUser(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    const target = await this.userRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Benutzer nicht gefunden.');
    return this.accounts.removeAccount(target, req.user.userId);
  }

  /** 2FA zurücksetzen, etwa bei verlorenem Handy. Die Person richtet sie danach neu ein. */
  @Post('users/:id/reset-2fa')
  async resetTwoFactor(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.twoFactor.reset(id);
  }

  /** Deaktiviertes Konto wieder freischalten; seine früheren Angebote kehren zurück. */
  @Post('users/:id/reactivate')
  async reactivateUser(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    const target = await this.userRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Benutzer nicht gefunden.');
    if (target.active !== false) return { success: true, alreadyActive: true };
    return this.accounts.reactivate(target);
  }

  // ---- Punkte ----

  @Get('points-settings')
  async getPointsSettings(@Request() req: any) {
    this.requireAdmin(req);
    return this.points.getSettings();
  }

  @Post('points-settings')
  async savePointsSettings(@Request() req: any, @Body() body: any) {
    this.requireAdmin(req);
    return this.points.saveSettings(body || {});
  }

  // ---- Masterkey ----

  /** Nur Fingerabdruck und Datum – den Schlüssel selbst gibt die App nie heraus. */
  @Get('master-key')
  async getMasterKey(@Request() req: any) {
    this.requireAdmin(req);
    return this.masterKey.status();
  }

  @Post('master-key')
  async setMasterKey(@Request() req: any, @Body() body: { masterKey?: string } & Reauth) {
    await this.reauth(req, body);
    const status = this.masterKey.setMasterKey(String(body?.masterKey || ''));
    await this.notifyOtherAdmins(req, 'Masterkey geändert',
      `Der Masterkey wurde neu gesetzt (Fingerabdruck ${status.fingerprint}). Ab jetzt werden Backups und ` +
      'Exporte damit verschlüsselt; ältere bleiben mit dem bisherigen Schlüssel lesbar.');
    return status;
  }

  // ---- Backup ----

  /** POST statt GET: Passwort und Code gehören in den Rumpf, nicht in die Adresse. */
  @Post('backup')
  async downloadBackup(@Request() req: any, @Body() body: Reauth, @Res() res: Response) {
    await this.reauth(req, body);
    this.logger.warn(`Backup heruntergeladen durch ${req.user.email || req.user.userId}`);
    const buffer = await this.backup.create();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="lernmodule-backup-${stamp}.lmbak"`);
    res.send(buffer);
  }

  /** Ersetzt alle Daten durch das Backup. Der vorherige Stand bleibt als Datei liegen. */
  @Post('restore')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  async restoreBackup(@Request() req: any, @UploadedFile() file: Express.Multer.File, @Body() body: Reauth) {
    await this.reauth(req, body);
    if (!file || !file.buffer) throw new BadRequestException('Keine Datei empfangen.');
    // Vor dem Einspielen benachrichtigen – danach gibt es die Konten evtl. nicht mehr.
    await this.notifyOtherAdmins(req, 'Backup eingespielt',
      `Ein Backup aus einer hochgeladenen Datei (${file.originalname || 'ohne Namen'}) wird eingespielt; ` +
      'alle Daten werden durch dessen Stand ersetzt.');
    return this.backup.restore(file.buffer);
  }

  // ---- Automatisches Backup (WebDAV / Nextcloud) ----

  @Get('cloud-backup')
  async getCloudBackup(@Request() req: any) {
    this.requireAdmin(req);
    return this.cloudBackup.status();
  }

  /** Leeres Passwort lässt das gespeicherte unverändert. */
  @Post('cloud-backup')
  async saveCloudBackup(@Request() req: any, @Body() body: any) {
    this.requireAdmin(req);
    return this.cloudBackup.saveConfig(body || {});
  }

  @Post('cloud-backup/test')
  async testCloudBackup(@Request() req: any) {
    this.requireAdmin(req);
    return this.cloudBackup.test();
  }

  @Post('cloud-backup/run')
  async runCloudBackup(@Request() req: any) {
    this.requireAdmin(req);
    return this.cloudBackup.run();
  }

  @Get('cloud-backup/files')
  async listCloudBackups(@Request() req: any) {
    this.requireAdmin(req);
    return this.cloudBackup.list();
  }

  /** Ein Backup aus der Cloud einspielen – ersetzt alle Daten. */
  @Post('cloud-backup/restore')
  async restoreCloudBackup(@Request() req: any, @Body() body: { name?: string } & Reauth) {
    await this.reauth(req, body);
    await this.notifyOtherAdmins(req, 'Backup eingespielt',
      `Das Cloud-Backup „${body?.name || '?'}“ wird eingespielt; alle Daten werden durch dessen Stand ersetzt.`);
    return this.cloudBackup.restoreFromCloud(String(body?.name || ''));
  }

  // ---- Benutzerliste als Tabelle (.ods) ----

  /**
   * Alle Konten mit Gruppen-Spalten zum Ankreuzen. Ohne Passwörter – im
   * Server liegt nur der Hash. Die Datei ist deshalb gefahrlos und dient der
   * Übersicht und der Gruppenpflege.
   */
  @Get('users/export.ods')
  async exportUsers(@Request() req: any, @Res() res: Response) {
    this.requireAdmin(req);
    const buffer = await this.userSheet.exportUsers();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.oasis.opendocument.spreadsheet');
    res.setHeader('Content-Disposition', `attachment; filename="benutzer-${stamp}.ods"`);
    res.send(buffer);
  }

  /**
   * Dieselbe Tabelle wieder einlesen: fehlende Konten anlegen, Gruppen nach
   * den Häkchen setzen. Wurden Konten angelegt, kommt eine zweite Tabelle mit
   * den Initialpasswörtern zurück – einmalig, denn danach steht im Server
   * wieder nur der Hash.
   */
  @Post('users/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async importUsers(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    this.requireAdmin(req);
    if (!file || !file.buffer) throw new BadRequestException('Keine Datei empfangen.');
    return this.userSheet.importUsers(file.buffer);
  }

  // ---- Whitelist / Blacklist management ----

  @Get('whitelist-blacklist')
  async getWhitelistBlacklist(@Request() req: any) {
    this.requireAdmin(req);
    const keys = ['teacher_whitelist', 'teacher_blacklist', 'admin_whitelist', 'admin_blacklist'];
    const result: Record<string, string[]> = {};
    for (const key of keys) {
      const entry = await this.configRepo.findOne({ where: { key } });
      result[key] = entry?.value || [];
    }
    return result;
  }

  @Post('whitelist-blacklist')
  async setWhitelistBlacklist(
    @Request() req: any,
    @Body() body: {
      teacher_whitelist?: string[];
      teacher_blacklist?: string[];
      admin_whitelist?: string[];
      admin_blacklist?: string[];
    },
  ) {
    this.requireAdmin(req);
    const keys = ['teacher_whitelist', 'teacher_blacklist', 'admin_whitelist', 'admin_blacklist'] as const;
    for (const key of keys) {
      if (body[key] !== undefined) {
        let entry = await this.configRepo.findOne({ where: { key } });
        if (!entry) {
          entry = this.configRepo.create({ key, value: body[key] });
        } else {
          entry.value = body[key];
        }
        await this.configRepo.save(entry);
      }
    }
    return { success: true };
  }

  // ---- Read-only view of ALL topics across all teachers/admins ----
  @Get('topics')
  async getAllTopicsReadOnly(@Request() req: any) {
    this.requireAdmin(req);
    const topics = await this.topicRepo.find({ relations: ['modules'], order: { id: 'ASC' } });
    const users = new Map((await this.userRepo.find()).map((u) => [u.id, u]));
    const schools = new Map((await this.schoolRepo.find()).map((s) => [s.id, s.name]));
    // Name und Schule der Lehrkraft, damit die Übersicht nach Schule und
    // Lehrkraft gegliedert werden kann.
    return topics.map(({ accessPassword: _ap, ...t }) => {
      const owner = users.get(t.ownerId);
      const schoolName = owner?.schoolId ? schools.get(owner.schoolId) || null : null;
      return {
        ...t,
        ownerEmail: owner?.email || t.ownerId,
        ownerName: owner?.displayName || owner?.email || t.ownerId,
        ownerActive: owner ? owner.active !== false : false,
        schoolId: schoolName ? owner!.schoolId : null,
        schoolName,
      };
    });
  }
}
