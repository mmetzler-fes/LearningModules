import { Controller, Get, Post, Delete, Body, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GithubBackupService } from './github-backup.service';

/** GitHub-Backup der eigenen Inhalte – siehe docs/github-backup.md. */
@Controller('github-backup')
@UseGuards(JwtAuthGuard)
export class GithubBackupController {
  constructor(private readonly backup: GithubBackupService) {}

  @Get()
  async status(@Request() req: any) {
    return this.backup.status(req.user);
  }

  /** `{ repo?, token?, interval?, weekday?, hour?, enabled? }` – leerer Token lässt den gespeicherten. */
  @Post()
  async save(@Request() req: any, @Body() body: any) {
    return this.backup.saveConfig(req.user, body || {});
  }

  @Delete()
  async disconnect(@Request() req: any) {
    return this.backup.disconnect(req.user);
  }

  @Post('test')
  async test(@Request() req: any) {
    return this.backup.test(req.user);
  }

  @Post('run')
  async run(@Request() req: any) {
    return this.backup.run(req.user);
  }

  @Get('files')
  async files(@Request() req: any) {
    return this.backup.files(req.user);
  }

  @Get('versions')
  async versions(@Request() req: any, @Query('path') path: string) {
    return this.backup.versions(req.user, path);
  }

  @Get('preview')
  async preview(@Request() req: any, @Query('path') path: string, @Query('ref') ref?: string) {
    return this.backup.preview(req.user, path, ref);
  }

  /** `{ path, ref?, moduleIds, targetTopicId? }` */
  @Post('restore')
  async restore(@Request() req: any, @Body() body: any) {
    return this.backup.restore(req.user, body || {});
  }

  // ---- Admin: serverweit erlauben oder abschalten ----

  @Get('admin')
  async getAllowed(@Request() req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
    return { allowed: await this.backup.isAllowed() };
  }

  /** `{ allowed }` */
  @Post('admin')
  async setAllowed(@Request() req: any, @Body() body: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
    return this.backup.setAllowed(body?.allowed !== false);
  }
}
