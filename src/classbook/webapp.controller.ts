import { Controller, Get, Header, NotFoundException, Query } from '@nestjs/common';
import { studentManifest, studentStartUrl } from './student-manifest';
import { ClassbookService } from './classbook.service';

@Controller('public')
export class WebappController {
  constructor(private readonly classbook: ClassbookService) {}

  /** `?start=/?k=<token>` → Manifest, dessen App am Link startet (Name: die Klasse). */
  @Get('manifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  async manifest(@Query('start') start: string) {
    const url = studentStartUrl(start);
    if (!url) throw new NotFoundException();
    let title = '';
    if (url.startsWith('/?k=')) {
      title = await this.classbook.info(url.slice(4)).then((i) => i.className, () => '');
    }
    return studentManifest(url, title);
  }
}
