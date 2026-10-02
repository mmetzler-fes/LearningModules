import { Injectable, BadRequestException, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { renderQr } from '../core/share/link-url';
import {
  generateSecret, verifyCode, otpauthUrl, generateRecoveryCodes, hashRecoveryCode,
} from '../auth/totp';

const ISSUER = 'LernModule';
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

/**
 * Zwei-Faktor-Anmeldung mit einer Authenticator-App (TOTP).
 *
 * Freiwillig für jedes Konto. Ablauf der Einrichtung: Geheimnis erzeugen
 * (vorläufig), QR-Code scannen, ersten Code bestätigen – erst dann ist 2FA
 * aktiv. So sperrt sich niemand mit einem halb eingerichteten Handy aus.
 *
 * Das Geheimnis liegt mit dem Masterkey verschlüsselt in der Datenbank. Wer
 * ein Backup einspielen kann, hat den Masterkey ohnehin – die Codes gelten
 * dann auch auf dem neuen Server. Mit dem App-Secret verschlüsselt, wären nach
 * einem Umzug alle ausgesperrt, der Admin eingeschlossen.
 */
@Injectable()
export class TwoFactorService {
  /** Fehlversuche je Konto. Im Speicher genügt: ein Neustart setzt nur die Zählung zurück. */
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly masterKey: MasterKeyService,
  ) {}

  private seal(secret: string): string {
    return this.masterKey.encrypt('totp', secret).toString('base64');
  }

  private unseal(sealed: string): string {
    return this.masterKey.decrypt(Buffer.from(sealed, 'base64'), 'totp');
  }

  private async load(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('Benutzer nicht gefunden.');
    return user;
  }

  // ---- Schutz vor Durchprobieren ----

  private assertNotLocked(userId: string) {
    const f = this.failures.get(userId);
    if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
      const minutes = Math.ceil((f.until - Date.now()) / 60000);
      throw new HttpException(
        `Zu viele falsche Codes. Bitte in ${minutes} Minute${minutes === 1 ? '' : 'n'} erneut versuchen.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordFailure(userId: string) {
    const f = this.failures.get(userId);
    const fresh = !f || f.until <= Date.now();
    this.failures.set(userId, { count: fresh ? 1 : f.count + 1, until: Date.now() + LOCK_MS });
  }

  /**
   * Prüft einen TOTP-Code oder – wenn erlaubt – einen Wiederherstellungscode
   * gegen das aktive Geheimnis. Ein verwendeter Wiederherstellungscode
   * verfällt. Wirft bei falschem Code.
   */
  private async checkCode(user: User, code: string, allowRecovery: boolean): Promise<'totp' | 'recovery'> {
    this.assertNotLocked(user.id);
    const clean = String(code || '').trim();
    if (user.totpSecret) {
      const step = verifyCode(this.unseal(user.totpSecret), clean, user.totpLastStep ?? null);
      if (step !== null) {
        user.totpLastStep = step;
        await this.userRepo.save(user);
        this.failures.delete(user.id);
        return 'totp';
      }
    }
    if (allowRecovery && /[a-z]/i.test(clean)) {
      const hash = hashRecoveryCode(clean);
      if ((user.totpRecovery || []).includes(hash)) {
        user.totpRecovery = (user.totpRecovery || []).filter((h) => h !== hash);
        await this.userRepo.save(user);
        this.failures.delete(user.id);
        return 'recovery';
      }
    }
    this.recordFailure(user.id);
    throw new UnauthorizedException(
      allowRecovery ? 'Der Code stimmt nicht. Auch ein Wiederherstellungscode ist möglich.' : 'Der Code stimmt nicht.',
    );
  }

  // ---- Anmeldung ----

  /** Zweiter Schritt der Anmeldung. Liefert, womit bestätigt wurde. */
  async verifyLogin(user: User, code: string) {
    if (!user.totpEnabled) return { method: 'none' as const, recoveryLeft: 0 };
    const method = await this.checkCode(user, code, true);
    return { method, recoveryLeft: (user.totpRecovery || []).length };
  }

  /**
   * Zweiter Faktor für eine heikle Aktion (Masterkey, Backup): Bei aktiver
   * 2FA muss ein gültiger Code dabei sein, sonst genügt das Passwort.
   */
  async confirmSecondFactor(userId: string, code: string) {
    const user = await this.load(userId);
    if (!user.totpEnabled) return;
    if (!String(code || '').trim()) throw new UnauthorizedException('Bitte den Code aus der Authenticator-App eingeben.');
    await this.checkCode(user, code, true);
  }

  // ---- Einrichten und Verwalten (eigenes Konto) ----

  async status(userId: string) {
    const user = await this.load(userId);
    return {
      enabled: !!user.totpEnabled,
      enabledAt: user.totpEnabledAt,
      recoveryLeft: user.totpEnabled ? (user.totpRecovery || []).length : 0,
    };
  }

  /** Neues (vorläufiges) Geheimnis samt QR-Code. Ein aktives bleibt bis zur Bestätigung gültig. */
  async setup(userId: string) {
    const user = await this.load(userId);
    if (user.totpEnabled) throw new BadRequestException('2FA ist bereits eingerichtet. Zum Wechsel des Geräts erst ausschalten.');
    const secret = generateSecret();
    user.totpPending = this.seal(secret);
    await this.userRepo.save(user);
    const url = otpauthUrl(ISSUER, user.email, secret);
    return { secret, otpauthUrl: url, qrSvg: await renderQr(url) };
  }

  /** Erster Code aus der App bestätigt die Einrichtung; danach gibt es die Wiederherstellungscodes – einmalig. */
  async enable(userId: string, code: string) {
    const user = await this.load(userId);
    if (user.totpEnabled) throw new BadRequestException('2FA ist bereits eingerichtet.');
    if (!user.totpPending) throw new BadRequestException('Bitte die Einrichtung neu starten.');
    this.assertNotLocked(user.id);
    const step = verifyCode(this.unseal(user.totpPending), code);
    if (step === null) {
      this.recordFailure(user.id);
      throw new BadRequestException('Der Code stimmt nicht. Uhrzeit des Handys prüfen und den aktuellen Code eingeben.');
    }
    const codes = generateRecoveryCodes();
    user.totpSecret = user.totpPending;
    user.totpPending = null;
    user.totpEnabled = true;
    user.totpEnabledAt = new Date();
    user.totpLastStep = step;
    user.totpRecovery = codes.map(hashRecoveryCode);
    await this.userRepo.save(user);
    this.failures.delete(user.id);
    return { success: true, recoveryCodes: codes };
  }

  /** Neue Wiederherstellungscodes; die alten verfallen. Braucht einen aktuellen Code aus der App. */
  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await this.load(userId);
    if (!user.totpEnabled) throw new BadRequestException('2FA ist nicht eingerichtet.');
    await this.checkCode(user, code, false);
    const codes = generateRecoveryCodes();
    user.totpRecovery = codes.map(hashRecoveryCode);
    await this.userRepo.save(user);
    return { success: true, recoveryCodes: codes };
  }

  /** Ausschalten durch den Benutzer selbst – Passwort prüft der Aufrufer, den Code prüfen wir. */
  async disable(userId: string, code: string) {
    const user = await this.load(userId);
    if (!user.totpEnabled) return { success: true };
    await this.checkCode(user, code, true);
    await this.clear(user);
    return { success: true };
  }

  /** Zurücksetzen durch Hauptadmin oder Schuladmin, etwa bei verlorenem Handy. */
  async reset(userId: string) {
    const user = await this.load(userId);
    await this.clear(user);
    this.failures.delete(user.id);
    return { success: true };
  }

  private async clear(user: User) {
    user.totpEnabled = false;
    user.totpSecret = null;
    user.totpPending = null;
    user.totpLastStep = null;
    user.totpRecovery = null;
    user.totpEnabledAt = null;
    await this.userRepo.save(user);
  }
}
