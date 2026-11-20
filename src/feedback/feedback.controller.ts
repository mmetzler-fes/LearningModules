import { Body, Controller, Delete, Get, Param, Patch, Post, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { FeedbackService } from './feedback.service';

@Controller()
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** 💬 Melden – mit oder ohne Anmeldung. */
  @Post('feedback')
  @UseGuards(OptionalJwtGuard)
  create(@Body() body: any, @Request() req: any) {
    return this.feedback.create(body, req.user, String(req.ip || ''));
  }

  @Get('admin/feedback')
  @UseGuards(JwtAuthGuard)
  list(@Request() req: any) {
    return this.feedback.list(req.user);
  }

  @Get('admin/feedback/:id/image')
  @UseGuards(JwtAuthGuard)
  async image(@Request() req: any, @Param('id') id: string, @Res() res: Response) {
    const img = await this.feedback.image(req.user, id);
    res.setHeader('Content-Type', img.type);
    res.send(img.data);
  }

  @Patch('admin/feedback/:id')
  @UseGuards(JwtAuthGuard)
  update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.feedback.update(req.user, id, body);
  }

  @Delete('admin/feedback/:id')
  @UseGuards(JwtAuthGuard)
  remove(@Request() req: any, @Param('id') id: string) {
    return this.feedback.remove(req.user, id);
  }
}
