import { Controller, Get, Post, Patch, Put, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Schulen anlegen, Whitelists pflegen, Lehrkräfte zuordnen – nur Hauptadmin. */
@Controller('admin/schools')
@UseGuards(JwtAuthGuard)
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  @Get()
  async list(@Request() req: any) {
    this.requireAdmin(req);
    return this.schools.listForAdmin();
  }

  @Post()
  async create(@Request() req: any, @Body() body: { name?: string; whitelist?: string[] }) {
    this.requireAdmin(req);
    return this.schools.create(body || {});
  }

  /** Zuordnung einer Lehrkraft: `{ schoolId: id | null, isSchoolAdmin? }`. */
  @Patch('users/:userId')
  async assign(@Request() req: any, @Param('userId') userId: string, @Body() body: any) {
    this.requireAdmin(req);
    return this.schools.assign(userId, body || {});
  }

  @Patch(':id')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    this.requireAdmin(req);
    return this.schools.update(id, body || {});
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.schools.remove(id);
  }

  @Get(':id/whitelist-preview')
  async preview(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.schools.whitelistPreview(id);
  }

  @Post(':id/apply-whitelist')
  async apply(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.schools.applyWhitelist(id);
  }
}

/**
 * "Meine Schule" für Schuladmins. Jede Methode prüft im Service, dass nur
 * die eigene Schule betroffen ist und das jeweilige Recht nicht entzogen wurde.
 */
@Controller('my-school')
@UseGuards(JwtAuthGuard)
export class MySchoolController {
  constructor(private readonly schools: SchoolsService) {}

  @Get()
  async overview(@Request() req: any) {
    return this.schools.overviewFor(req.user);
  }

  @Put('whitelist')
  async setWhitelist(@Request() req: any, @Body() body: { whitelist?: string[] }) {
    return this.schools.setWhitelistAsSchoolAdmin(req.user, body?.whitelist || []);
  }

  @Get('whitelist-preview')
  async preview(@Request() req: any) {
    return this.schools.previewAsSchoolAdmin(req.user);
  }

  @Post('apply-whitelist')
  async apply(@Request() req: any) {
    return this.schools.applyAsSchoolAdmin(req.user);
  }

  @Post('teachers/:id/remove')
  async removeTeacher(@Request() req: any, @Param('id') id: string) {
    return this.schools.removeFromSchool(req.user, id);
  }

  @Post('teachers/:id/deactivate')
  async deactivate(@Request() req: any, @Param('id') id: string) {
    return this.schools.deactivateTeacher(req.user, id);
  }

  @Post('teachers/:id/reactivate')
  async reactivate(@Request() req: any, @Param('id') id: string) {
    return this.schools.reactivateTeacher(req.user, id);
  }
}
