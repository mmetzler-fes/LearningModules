import { Controller, Get, Post, Delete, Body, UseGuards, Request, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AllowPendingPassword } from './guards/allow-pending-password.decorator';
import { TwoFactorService } from '../accounts/two-factor.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /** Teacher / Admin login via email + password */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
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

  /** Teacher self-registration */
  @Post('register')
  async register(@Body() body: { email: string; password: string; displayName?: string }) {
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
    return this.authService.changePassword(req.user.userId, body.oldPassword || '', body.newPassword || '');
  }

  /**
   * E-Mail-Adresse ändern: `{ newEmail, password, targetPassword? }`.
   * Siehe AuthService.changeEmail für die beiden Wege.
   */
  @Post('change-email')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changeEmail(@Request() req: any, @Body() body: { newEmail?: string; password?: string; targetPassword?: string }) {
    return this.authService.changeEmail(req.user.userId, body || {});
  }

  /** Eigenes Konto löschen – Creator werden nur deaktiviert. */
  @Delete('account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@Request() req: any) {
    return this.authService.deleteAccount(req.user.userId);
  }
}
