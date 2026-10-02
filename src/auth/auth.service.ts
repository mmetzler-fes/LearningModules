import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { MailService } from '../core/mail/mail.service';
import { AccountsService } from '../accounts/accounts.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly accounts: AccountsService,
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
    if (user.active === false) {
      throw new UnauthorizedException('Dieses Konto ist deaktiviert. Bitte an den Admin wenden.');
    }
    return this.buildSession(user);
  }

  /**
   * Benutzerdaten zum vorhandenen Token, ohne neues Token. Rolle und
   * Passwortsperre kommen aus dem Token, denn danach richten sich die Guards.
   */
  async me(userId: string, role: string, mustChangePassword: boolean) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Dieses Konto gibt es nicht mehr.');
    return {
      id: user.id,
      email: user.email,
      username: user.email,
      role,
      displayName: user.displayName || user.email,
      mustChangePassword,
    };
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
  async createUser(data: { email: string; role: UserRole; displayName?: string; password?: string }) {
    if (!data.email || !data.email.includes('@')) {
      throw new BadRequestException('Gültige E-Mail-Adresse erforderlich.');
    }
    const role: UserRole = data.role === 'admin' ? 'admin' : 'teacher';
    await this.checkAllowed(data.email, role);

    const existing = await this.userRepo.findOne({ where: { email: data.email } });
    if (existing) throw new BadRequestException('Diese E-Mail-Adresse ist bereits registriert.');

    // Beim Stapel-Import darf der Admin ein Passwort vorgeben – dann hat er
    // die Liste bereits selbst und braucht keine zurück. Ohne Angabe erzeugt
    // der Server eines, wie bisher.
    const supplied = (data.password || '').trim();
    if (supplied && supplied.length < 8) {
      throw new BadRequestException('Ein vorgegebenes Passwort braucht mindestens 8 Zeichen.');
    }
    const initialPassword = supplied || this.generatePassword();
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
    if (user && user.active !== false) {
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

  /**
   * Wer Creator ist, wird nur deaktiviert – seine Inhalte gehen für 0 Punkte
   * in den Shop. Alle anderen werden gelöscht.
   */
  async deleteAccount(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Benutzer nicht gefunden.');
    return this.accounts.removeAccount(user, userId);
  }

  // ---- E-Mail-Adresse ändern ----

  /**
   * Wechsel auf eine neue E-Mail-Adresse.
   *
   * Gibt es die Adresse schon, werden die Konten nach Eingabe ihres
   * Passworts zusammengeführt: Alles geht an das Konto mit der neuen Adresse.
   *
   * Gibt es sie nicht, wird dort ein Konto mit Initialpasswort angelegt und
   * das Passwort an die neue Adresse geschickt. Erst wenn sich der Benutzer
   * damit anmeldet und ein eigenes Passwort vergibt, wird das alte Konto
   * übernommen – so ist bewiesen, dass die neue Adresse ihm gehört.
   */
  async changeEmail(userId: string, body: { newEmail?: string; password?: string; targetPassword?: string }) {
    const me = await this.userRepo.findOne({ where: { id: userId } });
    if (!me) throw new BadRequestException('Benutzer nicht gefunden.');
    if (!body.password || !this.verifyPassword(body.password, me.passwordHash)) {
      throw new UnauthorizedException('Das aktuelle Passwort ist nicht korrekt.');
    }
    const newEmail = String(body.newEmail || '').trim();
    if (!newEmail.includes('@')) throw new BadRequestException('Gültige E-Mail-Adresse erforderlich.');
    if (newEmail.toLowerCase() === me.email.toLowerCase()) {
      throw new BadRequestException('Das ist bereits deine E-Mail-Adresse.');
    }
    await this.checkAllowed(newEmail, me.role === 'admin' ? 'admin' : 'teacher');

    const target = await this.userRepo.findOne({ where: { email: newEmail } });

    if (target && target.pendingMergeFrom === me.id) {
      // Schon angefordert, aber noch nicht bestätigt: neues Initialpasswort.
      return this.sendPendingPassword(target, true);
    }

    if (target) {
      if (target.active === false) throw new BadRequestException('Das Konto mit dieser Adresse ist deaktiviert.');
      if (!body.targetPassword) {
        return { success: false, needsTargetPassword: true, message: 'Diese Adresse hat bereits ein Konto. Bitte dessen Passwort eingeben, um die Konten zusammenzuführen.' };
      }
      if (!this.verifyPassword(body.targetPassword, target.passwordHash)) {
        throw new UnauthorizedException('Das Passwort des Kontos mit der neuen Adresse ist nicht korrekt.');
      }
      await this.accounts.merge(me, target);
      const merged = await this.userRepo.findOne({ where: { id: target.id } });
      return { success: true, merged: true, session: this.buildSession(merged!) };
    }

    const pending = this.userRepo.create({
      id: crypto.randomUUID(),
      email: newEmail,
      username: newEmail,
      passwordHash: '',
      role: me.role,
      displayName: me.displayName,
      mustChangePassword: true,
      pendingMergeFrom: me.id,
      // Kein zweites Startguthaben – die Punkte kommen beim Zusammenführen.
      points: 0,
    });
    return this.sendPendingPassword(pending, false);
  }

  private async sendPendingPassword(account: User, resend: boolean) {
    const password = this.generatePassword();
    account.passwordHash = this.hashPassword(password);
    account.mustChangePassword = true;
    await this.userRepo.save(account);
    const mail = await this.mailService.sendInitialPassword({
      to: account.email,
      displayName: account.displayName || account.email,
      password,
      role: account.role,
    });
    return {
      success: true,
      pending: true,
      resent: resend,
      newEmail: account.email,
      mailSent: mail.delivered,
      mailInfo: mail.reason,
      // Ohne Mailversand bleibt nur der Weg über den Bildschirm.
      initialPassword: mail.delivered ? undefined : password,
    };
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

    // Konto für einen E-Mail-Wechsel: Mit dem eigenen Passwort ist die neue
    // Adresse bestätigt – jetzt wird das alte Konto übernommen.
    let mergedFrom: string | undefined;
    if (user.pendingMergeFrom) {
      const old = await this.userRepo.findOne({ where: { id: user.pendingMergeFrom } });
      if (old) {
        await this.accounts.merge(old, user);
        mergedFrom = old.email;
      }
    }
    const fresh = (await this.userRepo.findOne({ where: { id: userId } }))!;
    // Neues Token, damit das mustChangePassword-Flag im JWT nicht mehr sperrt.
    const session = this.buildSession(fresh);
    return {
      success: true,
      message: mergedFrom
        ? `Passwort geändert. Das Konto ${mergedFrom} wurde übernommen – die neue Adresse gilt ab sofort.`
        : 'Passwort erfolgreich geändert.',
      token: session.token,
      mergedFrom,
      session,
    };
  }

  // ---- Ensure at least one admin exists (called on app startup) ----

  async ensureAdminExists() {
    const adminCount = await this.userRepo.count({ where: { role: 'admin', active: true } });
    if (adminCount === 0) {
      const defaultPassword = 'admin123';
      if (await this.userRepo.findOne({ where: { email: 'admin@localhost' } })) {
        console.log('[SETUP] Kein aktiver Admin, admin@localhost existiert aber – bitte per Datenbank reaktivieren.');
        return;
      }
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
