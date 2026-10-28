import { Controller, Get, Header, NotFoundException, Query } from '@nestjs/common';
import { studentManifest, studentStartUrl } from './student-manifest';

@Controller('public')
export class WebappController {
  /** `?start=/?k=<token>` → Manifest, dessen App am Schüler-Link startet. */
  @Get('manifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  manifest(@Query('start') start: string) {
    const url = studentStartUrl(start);
    if (!url) throw new NotFoundException();
    return studentManifest(url);
  }
}
