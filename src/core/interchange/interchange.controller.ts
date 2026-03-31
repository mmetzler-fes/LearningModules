import { Controller, Get, Post, Body, Param, UseGuards, Request, Res, Header, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { H5pService } from './h5p/h5p.service';
import { ImportService } from './import/import.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SchoolIsolationGuard } from '../../auth/guards/school-isolation.guard';

@Controller('interchange')
@UseGuards(JwtAuthGuard, SchoolIsolationGuard)
export class InterchangeController {
  constructor(
    private readonly h5pService: H5pService,
    private readonly importService: ImportService,
  ) {}

  // H5P-Export vorübergehend deaktiviert, damit das Programm lauffähig bleibt
  // @Get('topics/:id/export-h5p')
  // @Header('Content-Type', 'application/octet-stream')
  // async exportH5p(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
  //   const buffer = await this.h5pService.generateH5pBuffer(id);
  //   const filename = `export_${id}.h5p`;
  //   
  //   res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  //   res.send(buffer);
  // }

  @Post('import-json')
  @UseInterceptors(FileInterceptor('file'))
  async importJson(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    const jsonString = file.buffer.toString('utf-8');
    return this.importService.importTopicFromJson(jsonString, req.user);
  }
}
