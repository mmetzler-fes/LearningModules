import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    private readonly jwtService: JwtService,
  ) {}

  // ---- Password hashing ----

  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(8).toString('hex');
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const derived = crypto.scryptSync(password, salt, 32).toString('hex');
    return derived === hash;
  }

  // ---- Whitelist / Blacklist check ----

  async checkAllowed(email: string, listType: 'teacher' | 'admin'): Promise<void> {
    const emailLower = email.toLowerCase();
    const domain = emailLower.split('@')[1] || '';

    const whitelistEntry = await this.configRepo.findOne({ where: { key: `${listType}_whitelist` } });
    const blacklistEntry = await this.configRepo.findOne({ where: { key: `${listType}_blacklist` } });

    const whitelist: string[] = whitelistEntry?.value || [];
    const blacklist: string[] = blacklistEntry?.value || [];

    // Blacklist takes priority
    if (blacklist.length > 0) {
      const blocked = blacklist.some(
        (entry) => emailLower === entry.toLowerCase() || domain === entry.toLowerCase().replace(/^@/, ''),
      );
      if (blocked) throw new ForbiddenException('Diese E-Mail-Adresse ist gesperrt.');
    }

    // If whitelist is defined, only listed entries are allowed
    if (whitelist.length > 0) {
      const allowed = whitelist.some(
        (entry) => emailLower === entry.toLowerCase() || domain === entry.toLowerCase().replace(/^@/, ''),
      );
      if (!allowed) throw new ForbiddenException('Diese E-Mail-Adresse ist nicht in der Whitelist.');
    }
  }

  // ---- Login (teacher / admin by email + password) ----

  async login(email: string, password: string) {
    if (!email || !password) throw new UnauthorizedException('E-Mail und Passwort erforderlich.');
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !user.passwordHash || !this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Ungültige Anmeldedaten.');
    }
    const payload = { sub: user.id, email: user.email, username: user.email, role: user.role };
    return {
      token: this.jwtService.sign(payload),
      id: user.id,
      email: user.email,
      username: user.email,
      role: user.role,
      displayName: user.displayName || user.email,
    };
  }

  // ---- Teacher self-registration ----

  async registerTeacher(data: { email: string; password: string; displayName?: string }) {
    if (!data.email || !data.email.includes('@')) {
      throw new BadRequestException('Gültige E-Mail-Adresse erforderlich.');
    }
    if (!data.password || data.password.length < 6) {
      throw new BadRequestException('Passwort muss mindestens 6 Zeichen lang sein.');
    }
    await this.checkAllowed(data.email, 'teacher');

    const existing = await this.userRepo.findOne({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Diese E-Mail-Adresse ist bereits registriert.');

    const user = this.userRepo.create({
      id: crypto.randomUUID(),
      email: data.email,
      username: data.email,
      passwordHash: this.hashPassword(data.password),
      role: 'teacher',
      displayName: data.displayName || data.email,
    });
    const saved = await this.userRepo.save(user);
    const payload = { sub: saved.id, email: saved.email, username: saved.email, role: saved.role };
    return {
      token: this.jwtService.sign(payload),
      id: saved.id,
      email: saved.email,
      username: saved.email,
      role: saved.role,
      displayName: saved.displayName,
    };
  }

  // ---- Admin creates another admin ----

  async createAdmin(data: { email: string; password: string; displayName?: string }) {
    if (!data.email || !data.email.includes('@')) {
      throw new BadRequestException('Gültige E-Mail-Adresse erforderlich.');
    }
    if (!data.password || data.password.length < 6) {
      throw new BadRequestException('Passwort muss mindestens 6 Zeichen lang sein.');
    }
    await this.checkAllowed(data.email, 'admin');

    const existing = await this.userRepo.findOne({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Diese E-Mail-Adresse ist bereits registriert.');

    const user = this.userRepo.create({
      id: crypto.randomUUID(),
      email: data.email,
      username: data.email,
      passwordHash: this.hashPassword(data.password),
      role: 'admin',
      displayName: data.displayName || data.email,
    });
    const saved = await this.userRepo.save(user);
    return { id: saved.id, email: saved.email, role: saved.role, displayName: saved.displayName };
  }

  // ---- Forgot password (stub: logs new password instead of sending email) ----

  async forgotPassword(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (user) {
      const newPassword = crypto.randomBytes(6).toString('hex');
      user.passwordHash = this.hashPassword(newPassword);
      await this.userRepo.save(user);
      // EMAIL STUB: Replace with real SMTP sending in production
      console.log(`[EMAIL STUB] Passwort-Reset für ${email}: Neues Passwort = ${newPassword}`);
    }
    // Always return success to prevent user enumeration
    return { success: true, message: 'Falls die E-Mail-Adresse registriert ist, wurde ein neues Passwort versandt.' };
  }

  // ---- Delete own account ----

  async deleteAccount(userId: string) {
    await this.userRepo.delete({ id: userId });
    return { success: true };
  }

  // ---- Change password ----

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    if (!oldPassword || !newPassword) {
      throw new BadRequestException('Altes und neues Passwort sind erforderlich.');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('Das neue Passwort muss mindestens 6 Zeichen lang sein.');
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('Benutzer nicht gefunden.');
    }
    if (!user.passwordHash || !this.verifyPassword(oldPassword, user.passwordHash)) {
      throw new UnauthorizedException('Das alte Passwort ist nicht korrekt.');
    }
    user.passwordHash = this.hashPassword(newPassword);
    await this.userRepo.save(user);
    return { success: true, message: 'Passwort erfolgreich geändert.' };
  }

  // ---- Ensure at least one admin exists (called on app startup) ----

  async ensureAdminExists() {
    const adminCount = await this.userRepo.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
      const defaultPassword = 'admin123';
      const user = this.userRepo.create({
        id: crypto.randomUUID(),
        email: 'admin@localhost',
        username: 'admin',
        passwordHash: this.hashPassword(defaultPassword),
        role: 'admin',
        displayName: 'Administrator',
      });
      await this.userRepo.save(user);
      console.log('[SETUP] Standard-Admin angelegt: admin@localhost / admin123');
    }
  }
}
