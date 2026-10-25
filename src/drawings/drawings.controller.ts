import { Controller, Get, Post, Body, Param, Query, Request, UseGuards, UseInterceptors, UploadedFile, HttpCode } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DrawingsService } from './drawings.service';

@Controller('drawings')
@UseGuards(JwtAuthGuard)
export class DrawingsController {
  constructor(private readonly drawings: DrawingsService) {}

  /** Zeichnungen mit Quelle in einem Lernthema. */
  @Get()
  list(@Request() req: any, @Query('topicId') topicId: string) {
    return this.drawings.list(req.user, String(topicId || ''));
  }

  /** `{ topicId?, force? }` – geänderte .odg neu zeichnen. */
  @Post('sync')
  @HttpCode(200)
  sync(@Request() req: any, @Body() body: { topicId?: string; force?: boolean }) {
    return this.drawings.sync(req.user, body?.topicId || undefined, !!body?.force);
  }

  /** Geänderte .odg hochladen (Feld `file`). */
  @Post(':id/odg')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  upload(@Request() req: any, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.drawings.upload(req.user, id, file?.buffer);
  }
}
