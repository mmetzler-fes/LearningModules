import { Controller, Post, Delete, Body, UseGuards, Request, HttpCode } from '@nestjs/common';
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

  /** Teacher deletes their own account */
  @Delete('account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@Request() req: any) {
    return this.authService.deleteAccount(req.user.userId);
  }
}
