import { Controller, Post } from '@nestjs/common';
import { DemoDataService } from './demo-data.service';

@Controller('admin')
export class DemoDataController {
  constructor(private readonly demoDataService: DemoDataService) {}

  @Post('demo-data')
  async createDemoData() {
    return this.demoDataService.createDemoData();
  }
}
