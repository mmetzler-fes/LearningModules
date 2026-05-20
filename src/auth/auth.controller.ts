import { Controller, Get, Post, Delete, Body, UseGuards, Request, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Teacher / Admin login via email + password */
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
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

  /** Change password of logged-in user */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changePassword(@Request() req: any, @Body() body: { oldPassword?: string; newPassword?: string }) {
    return this.authService.changePassword(req.user.userId, body.oldPassword || '', body.newPassword || '');
  }

  /** Teacher deletes their own account */
  @Delete('account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@Request() req: any) {
    return this.authService.deleteAccount(req.user.userId);
  }

  /** Get exam mode setting for logged-in teacher/admin */
  @Get('exam-mode')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async getExamMode(@Request() req: any) {
    return this.authService.getExamMode(req.user.userId);
  }

  /** Set exam mode setting for logged-in teacher/admin */
  @Post('exam-mode')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async setExamMode(@Request() req: any, @Body() body: { enabled: boolean }) {
    return this.authService.setExamMode(req.user.userId, !!body.enabled);
  }
}
