import {
  Controller, Get, Post, Delete, Body, Param, UseGuards, Request,
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../core/entities/user.entity';
import { SystemConfig } from '../core/entities/system-config.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig) private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    private readonly authService: AuthService,
  ) {}

  // ---- Admin only guard helper ----
  private requireAdmin(req: any) {
    if (req.user.role !== 'admin') throw new ForbiddenException('Nur Admins haben Zugriff.');
  }

  // ---- List all admins and teachers ----
  @Get('users')
  async getAllUsers(@Request() req: any) {
    this.requireAdmin(req);
    const users = await this.userRepo.find();
    return users.map(({ passwordHash, resetPasswordToken, ...u }) => u);
  }

  // ---- Create a new user (teacher or admin) with a generated initial password ----
  @Post('users')
  async createUser(
    @Request() req: any,
    @Body() body: { email: string; role?: UserRole; displayName?: string },
  ) {
    this.requireAdmin(req);
    return this.authService.createUser({
      email: body.email,
      role: body.role === 'admin' ? 'admin' : 'teacher',
      displayName: body.displayName,
    });
  }

  // ---- Reset a user's password to a new generated one ----
  @Post('users/:id/reset-password')
  async resetUserPassword(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    return this.authService.resetUserPassword(id);
  }

  // ---- Delete admin or teacher (min. 1 admin must remain) ----
  @Delete('users/:id')
  async deleteUser(@Request() req: any, @Param('id') id: string) {
    this.requireAdmin(req);
    const target = await this.userRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Benutzer nicht gefunden.');
    if (target.role === 'admin') {
      const adminCount = await this.userRepo.count({ where: { role: 'admin' } });
      if (adminCount <= 1) throw new BadRequestException('Es muss mindestens ein Admin vorhanden bleiben.');
    }
    await this.userRepo.delete({ id });
    return { success: true };
  }

  // ---- Whitelist / Blacklist management ----

  @Get('whitelist-blacklist')
  async getWhitelistBlacklist(@Request() req: any) {
    this.requireAdmin(req);
    const keys = ['teacher_whitelist', 'teacher_blacklist', 'admin_whitelist', 'admin_blacklist'];
    const result: Record<string, string[]> = {};
    for (const key of keys) {
      const entry = await this.configRepo.findOne({ where: { key } });
      result[key] = entry?.value || [];
    }
    return result;
  }

  @Post('whitelist-blacklist')
  async setWhitelistBlacklist(
    @Request() req: any,
    @Body() body: {
      teacher_whitelist?: string[];
      teacher_blacklist?: string[];
      admin_whitelist?: string[];
      admin_blacklist?: string[];
    },
  ) {
    this.requireAdmin(req);
    const keys = ['teacher_whitelist', 'teacher_blacklist', 'admin_whitelist', 'admin_blacklist'] as const;
    for (const key of keys) {
      if (body[key] !== undefined) {
        let entry = await this.configRepo.findOne({ where: { key } });
        if (!entry) {
          entry = this.configRepo.create({ key, value: body[key] });
        } else {
          entry.value = body[key];
        }
        await this.configRepo.save(entry);
      }
    }
    return { success: true };
  }

  // ---- Read-only view of ALL topics across all teachers/admins ----
  @Get('topics')
  async getAllTopicsReadOnly(@Request() req: any) {
    this.requireAdmin(req);
    const topics = await this.topicRepo.find({ relations: ['modules'], order: { id: 'ASC' } });
    const users = await this.userRepo.find();
    const userMap = new Map(users.map((u) => [u.id, u.email]));
    return topics.map(({ accessPassword: _ap, ...t }) => ({
      ...t,
      ownerEmail: userMap.get(t.ownerId) || t.ownerId,
    }));
  }
}
