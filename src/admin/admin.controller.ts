import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Res,
  ForbiddenException, BadRequestException, UseInterceptors, UploadedFile,
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
import { HandoverService } from './handover.service';
import { UserSheetService } from './user-sheet.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    private readonly authService: AuthService,
    private readonly handover: HandoverService,
    private readonly userSheet: UserSheetService,
  ) {}

  // ---- Admin only guard helper ----
  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  // ---- List all admins and teachers ----
  @Get('users')
  async getAllUsers(@Request() req: any) {
    this.requireAdmin(req);
    const users = await this.userRepo.find();
    return users.map(({ passwordHash, resetPasswordToken, ...u }) => u);
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

    if (target.role === 'admin' && role !== 'admin') {
      const adminCount = await this.userRepo.count({ where: { role: 'admin' } });
      if (adminCount <= 1) throw new BadRequestException('Es muss mindestens ein Admin vorhanden bleiben.');
    }

    target.role = role;
    await this.userRepo.save(target);
    return { success: true, id: target.id, role: target.role };
  }

  // ---- Delete admin or teacher (min. 1 admin must remain) ----
  @Delete('users/:id')
  async deleteUser(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    const target = await this.userRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Benutzer nicht gefunden.');
    if (target.role === 'admin') {
      const adminCount = await this.userRepo.count({ where: { role: 'admin' } });
      if (adminCount <= 1) throw new BadRequestException('Es muss mindestens ein Admin vorhanden bleiben.');
    }

    // Erst übergeben, dann löschen. Andersherum bliebe alles als Waise mit
    // einer ownerId zurück, die auf niemanden zeigt: unsichtbar für alle,
    // aber bei Kolleginnen mit Nutzungsfreigabe weiterhin aktiv.
    const successor = await this.handover.pickSuccessor(target, req.user.userId);
    if (!successor) {
      throw new BadRequestException('Kein Admin gefunden, der die Inhalte übernehmen könnte.');
    }
    const moved = await this.handover.transferOwnership(target, successor);

    await this.userRepo.delete({ id });
    return {
      success: true,
      handedOverTo: successor.displayName || successor.email,
      moved,
    };
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
    const users = await this.userRepo.find();
    const userMap = new Map(users.map((u) => [u.id, u.email]));
    return topics.map(({ accessPassword: _ap, ...t }) => ({
      ...t,
      ownerEmail: userMap.get(t.ownerId) || t.ownerId,
    }));
  }
}
