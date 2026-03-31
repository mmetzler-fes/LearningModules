import { Controller, Post, Body, Get } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: any) {
    // Basic login endpoint for the redesign
    return this.authService.login(body.username, body.password);
  }

  @Get('settings')
  getAuthSettings() {
    return {
      allowEmptyStudentPassword: true,
      showTeacherLogin: true,
    };
  }
}
