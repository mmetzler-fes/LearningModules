import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { MailService } from '../core/mail/mail.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  // ---- Password generation ----

  /**
   * Erzeugt ein aussprechbares Initialpasswort, das sich am Telefon oder auf
   * einem Zettel fehlerfrei weitergeben lässt: keine verwechselbaren Zeichen
   * (0/O, 1/l/I), Gruppen durch Bindestriche getrennt.
   */
  private generatePassword(): string {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789ACDEFGHJKLMNPQRSTUVWXYZ';
    const groups: string[] = [];
    for (let g = 0; g < 3; g++) {
      let group = '';
      for (let i = 0; i < 4; i++) {
        group += alphabet[crypto.randomInt(alphabet.length)];
      }
      groups.push(group);
    }
    return groups.join('-');
  }

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

  /**
   * Checks whether an email matches a single pattern entry.
   * Supported formats:
   *   *.fes-es.de        — any email at fes-es.de or any subdomain
   *   @fes-es.de         — any email at exactly fes-es.de
   *   fes-es.de          — same as @fes-es.de
   *   user@fes-es.de     — exact email address
   */
  private emailMatchesPattern(email: string, pattern: string): boolean {
    const p = pattern.toLowerCase().trim();
    const e = email.toLowerCase().trim();
    if (!p) return false;

    // @domain.de – muss VOR der Prüfung auf eine exakte Adresse stehen, sonst
    // landet "@fes-es.de" im Exakt-Vergleich und passt auf gar nichts.
    if (p.startsWith('@')) {
      return (e.split('@')[1] || '') === p.slice(1);
    }

    // Exact email address match
    if (p.includes('@') && !p.startsWith('*')) {
      return e === p;
    }

    // Wildcard subdomain: *.fes-es.de
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      const emailDomain = e.split('@')[1] || '';
      return emailDomain === base || emailDomain.endsWith('.' + base);
    }

    // @domain.com or plain domain.com
    const domain = p.replace(/^@/, '');
    const emailDomain = e.split('@')[1] || '';
    return emailDomain === domain;
  }

  async checkAllowed(email: string, listType: 'teacher' | 'admin'): Promise<void> {
    const whitelistEntry = await this.configRepo.findOne({ where: { key: `${listType}_whitelist` } });
    const blacklistEntry = await this.configRepo.findOne({ where: { key: `${listType}_blacklist` } });

    const whitelist: string[] = whitelistEntry?.value || [];
    const blacklist: string[] = blacklistEntry?.value || [];

    // Blacklist takes priority
    if (blacklist.length > 0) {
      const blocked = blacklist.some((entry) => this.emailMatchesPattern(email, entry));
      if (blocked) throw new ForbiddenException('Diese E-Mail-Adresse ist gesperrt.');
    }

    // If whitelist is defined, only listed patterns are allowed
    if (whitelist.length > 0) {
      const allowed = whitelist.some((entry) => this.emailMatchesPattern(email, entry));
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
    return this.buildSession(user);
  }

  /** Token + Benutzerdaten für die Antwort an das Frontend. */
  private buildSession(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      username: user.email,
      role: user.role,
      mustChangePassword: !!user.mustChangePassword,
    };
    return {
      token: this.jwtService.sign(payload),
      id: user.id,
      email: user.email,
      username: user.email,
      role: user.role,
      displayName: user.displayName || user.email,
      mustChangePassword: !!user.mustChangePassword,
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
    return this.buildSession(saved);
  }

  // ---- Admin legt einen Benutzer an (Lehrer oder Admin) ----

  /**
   * Erzeugt ein Konto mit einem zufälligen Initialpasswort.
   *
   * Konnte das Passwort per Mail zugestellt werden, taucht es in der Antwort
   * NICHT auf. Ohne Versandweg wird es einmalig zurückgegeben, damit der Admin
   * es dem neuen Benutzer persönlich übergeben kann.
   */
  async createUser(data: { email: string; role: UserRole; displayName?: string }) {
    if (!data.email || !data.email.includes('@')) {
      throw new BadRequestException('Gültige E-Mail-Adresse erforderlich.');
    }
    const role: UserRole = data.role === 'admin' ? 'admin' : 'teacher';
    await this.checkAllowed(data.email, role);

    const existing = await this.userRepo.findOne({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Diese E-Mail-Adresse ist bereits registriert.');

    const initialPassword = this.generatePassword();
    const displayName = data.displayName || data.email;
    const user = this.userRepo.create({
      id: crypto.randomUUID(),
      email: data.email,
      username: data.email,
      passwordHash: this.hashPassword(initialPassword),
      role,
      displayName,
      mustChangePassword: true,
    });
    const saved = await this.userRepo.save(user);

    const mail = await this.mailService.sendInitialPassword({
      to: saved.email,
      displayName,
      password: initialPassword,
      role,
    });

    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      displayName: saved.displayName,
      mailSent: mail.delivered,
      mailInfo: mail.reason,
      // Nur sichtbar, solange die Mail nicht zugestellt werden konnte:
      initialPassword: mail.delivered ? undefined : initialPassword,
    };
  }

  /** Bestehendes Konto auf ein neues Initialpasswort zurücksetzen (Admin). */
  async resetUserPassword(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Benutzer nicht gefunden.');

    const newPassword = this.generatePassword();
    user.passwordHash = this.hashPassword(newPassword);
    user.mustChangePassword = true;
    await this.userRepo.save(user);

    const mail = await this.mailService.sendPasswordReset({
      to: user.email,
      displayName: user.displayName || user.email,
      password: newPassword,
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      mailSent: mail.delivered,
      mailInfo: mail.reason,
      initialPassword: mail.delivered ? undefined : newPassword,
    };
  }

  // ---- Forgot password ----

  async forgotPassword(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (user) {
      const newPassword = this.generatePassword();
      user.passwordHash = this.hashPassword(newPassword);
      user.mustChangePassword = true;
      await this.userRepo.save(user);
      await this.mailService.sendPasswordReset({
        to: user.email,
        displayName: user.displayName || user.email,
        password: newPassword,
      });
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
    user.mustChangePassword = false;
    await this.userRepo.save(user);
    // Neues Token, damit das mustChangePassword-Flag im JWT nicht mehr sperrt.
    const session = this.buildSession(user);
    return { success: true, message: 'Passwort erfolgreich geändert.', token: session.token };
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
        mustChangePassword: true,
      });
      await this.userRepo.save(user);
      console.log('[SETUP] Standard-Admin angelegt: admin@localhost / admin123 (muss beim ersten Login geändert werden)');
    }
  }
}
