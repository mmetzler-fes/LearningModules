import { Controller, Get, Post, Patch, Delete, Body, UseGuards, Request, HttpCode, Headers, Param } from '@nestjs/common';
import { cleanLabel, deviceLabel } from './device-label';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AllowPendingPassword } from './guards/allow-pending-password.decorator';
import { TwoFactorService } from '../accounts/two-factor.service';
import { TERMS_VERSION, termsMarkdown } from './terms';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /** Teacher / Admin login via email + password */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email: string; password: string; remember?: boolean; device?: string }, @Headers('user-agent') ua?: string) {
    return this.authService.login(body.email, body.password, !!body.remember, { device: cleanLabel(body.device) || deviceLabel(ua) });
  }

  // ---- Anmeldungen je Gerät ----

  /** Frisches Token für diese Anmeldung (die App fragt einmal am Tag). */
  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @AllowPendingPassword()
  @HttpCode(200)
  async refresh(@Request() req: any) {
    return this.authService.refresh(req.user.userId, req.user.sid);
  }

  /** Abmelden: diese Anmeldung beenden. */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @AllowPendingPassword()
  @HttpCode(200)
  async logout(@Request() req: any) {
    if (req.user.sid) await this.authService.endSession(req.user.userId, req.user.sid);
    return { success: true };
  }

  /** Angemeldete Geräte des eigenen Kontos. */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async sessions(@Request() req: any) {
    return this.authService.listSessions(req.user.userId, req.user.sid);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async endSession(@Request() req: any, @Param('id') id: string) {
    return this.authService.endSession(req.user.userId, id);
  }

  /** `{ others: true }`: überall sonst abmelden; ohne: überall, auch hier. */
  @Post('sessions/end-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async endAllSessions(@Request() req: any, @Body() body: { others?: boolean }) {
    return this.authService.endAllSessions(req.user.userId, req.user.sid, body?.others === true);
  }

  /** Aktuelle Fassung der Nutzungsbedingungen (öffentlich, etwa zum Nachlesen vor der Anmeldung). */
  @Get('terms')
  terms() {
    return { version: TERMS_VERSION, markdown: termsMarkdown() };
  }

  /** Zustimmung bei der Anmeldung: `{ challenge, accept: true }` – liefert die Sitzung. */
  @Post('login/terms')
  @HttpCode(200)
  async loginTerms(@Body() body: { challenge?: string; accept?: boolean }) {
    return this.authService.acceptTerms(body?.challenge || '', body?.accept === true);
  }

  /**
   * Angemeldetes Konto zum vorhandenen Token – damit ein Neuladen der Seite
   * nicht zum Login zurückführt. Auch mit offenem Initialpasswort erlaubt,
   * sonst käme man nach dem Reload nicht mehr zum Passwortwechsel.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowPendingPassword()
  async me(@Request() req: any) {
    return this.authService.me(req.user.userId, req.user.role, req.user.mustChangePassword);
  }

  /** Persönliche Einstellungen der Oberfläche (z. B. Kopfzeile im Stift-Editor). */
  @Patch('settings')
  @UseGuards(JwtAuthGuard)
  async settings(@Request() req: any, @Body() body: Record<string, unknown>) {
    return this.authService.updateSettings(req.user.userId, body || {});
  }

  /** Zweiter Schritt der Anmeldung bei aktiver 2FA. */
  @Post('login/2fa')
  @HttpCode(200)
  async loginTwoFactor(@Body() body: { challenge?: string; code?: string }) {
    return this.authService.completeTwoFactorLogin(body?.challenge || '', body?.code || '');
  }

  // ---- 2FA des eigenen Kontos ----

  @Get('2fa')
  @UseGuards(JwtAuthGuard)
  async twoFactorStatus(@Request() req: any) {
    return this.twoFactor.status(req.user.userId);
  }

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async twoFactorSetup(@Request() req: any) {
    return this.twoFactor.setup(req.user.userId);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async twoFactorEnable(@Request() req: any, @Body() body: { code?: string }) {
    return this.twoFactor.enable(req.user.userId, body?.code || '');
  }

  @Post('2fa/recovery-codes')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async twoFactorRecovery(@Request() req: any, @Body() body: { code?: string }) {
    return this.twoFactor.regenerateRecoveryCodes(req.user.userId, body?.code || '');
  }

  /** Ausschalten braucht Passwort und Code – ein offen gelassener Rechner allein reicht nicht. */
  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async twoFactorDisable(@Request() req: any, @Body() body: { password?: string; code?: string }) {
    await this.authService.assertOwnPassword(req.user.userId, body?.password || '');
    return this.twoFactor.disable(req.user.userId, body?.code || '');
  }

  /** Selbstregistrierung: Initialpasswort per Mail, keine Anmeldung ohne sie. */
  @Post('register')
  async register(@Body() body: { email: string; displayName?: string }) {
    return this.authService.registerTeacher(body);
  }

  /** Forgot password – generates new random password (stub: logged to console) */
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  /** Change password of logged-in user – auch mit offenem Initialpasswort erlaubt */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @AllowPendingPassword()
  @HttpCode(200)
  async changePassword(@Request() req: any, @Body() body: { oldPassword?: string; newPassword?: string }) {
    return this.authService.changePassword(req.user.userId, body.oldPassword || '', body.newPassword || '', !!req.user.remember, req.user.sid);
  }

  /**
   * E-Mail-Adresse ändern: `{ newEmail, password, targetPassword? }`.
   * Siehe AuthService.changeEmail für die beiden Wege.
   */
  @Post('change-email')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changeEmail(@Request() req: any, @Body() body: { newEmail?: string; password?: string; targetPassword?: string }) {
    return this.authService.changeEmail(req.user.userId, body || {}, !!req.user.remember, req.user.sid);
  }

  /** Eigenes Konto löschen – Creator werden nur deaktiviert. */
  @Delete('account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@Request() req: any) {
    return this.authService.deleteAccount(req.user.userId);
  }
}
