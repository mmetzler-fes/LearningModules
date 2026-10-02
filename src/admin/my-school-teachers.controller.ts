import { Controller, Post, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { SchoolsService } from '../core/schools/schools.service';

/**
 * Schuladmin legt eine Lehrkraft für die eigene Schule an.
 *
 * Liegt hier statt bei den übrigen "Meine Schule"-Endpunkten, weil das
 * Anlegen den AuthService braucht – und das Auth-Modul seinerseits das
 * Schulmodul (Zuordnung beim Login). So entsteht kein Kreis.
 *
 * Grenzen: Es entsteht immer eine normale Lehrkraft, nie ein Schuladmin oder
 * Admin. Eine schon registrierte Adresse wird abgelehnt (kein "Übernehmen"
 * fremder Konten), und die globale Whitelist/Blacklist gilt wie überall.
 */
@Controller('my-school/teachers')
@UseGuards(JwtAuthGuard)
export class MySchoolTeachersController {
  constructor(
    private readonly authService: AuthService,
    private readonly schools: SchoolsService,
  ) {}

  @Post()
  async create(@Request() req: any, @Body() body: { email?: string; displayName?: string }) {
    const school = await this.schools.requireMayCreateTeachers(req.user);
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Bitte eine E-Mail-Adresse angeben.');
    const res = await this.authService.createUser({
      email,
      role: 'teacher',
      displayName: String(body?.displayName || '').trim() || undefined,
    });
    // Fest der eigenen Schule zuordnen – auch wenn die Whitelist auf eine
    // andere passen würde.
    await this.schools.assign(res.id, { schoolId: school.id, isSchoolAdmin: false });
    return res;
  }
}
