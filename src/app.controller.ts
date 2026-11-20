import { join } from 'path';
import { uiVersion } from './core/ui-version';

let cachedVersion = '';
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Version der Oberfläche – die App bietet bei einer neuen das Aktualisieren an (js/update-check.js). */
  @Get('ui-version')
  uiVersion() {
    if (!cachedVersion) cachedVersion = uiVersion(join(__dirname, '..', 'src', 'renderer'));
    return { version: cachedVersion };
  }
}
