import { Controller, Get, Post, Body, Param, UseGuards, Request, Delete, Patch } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('topics')
@UseGuards(JwtAuthGuard)
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.topicsService.findAll(req.user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.findOne(id, req.user);
  }

  @Get(':id/modules')
  async getModules(@Param('id') id: string, @Request() req: any) {
    const topic = await this.topicsService.findOne(id, req.user);
    return topic.modules || [];
  }

  @Post()
  async create(@Request() req: any, @Body() topicData: any) {
    return this.topicsService.create(req.user, topicData);
  }

  @Post(':id/modules')
  async addModule(@Param('id') id: string, @Request() req: any, @Body() moduleData: any) {
    return this.topicsService.addModule(id, req.user, moduleData);
  }

  @Delete(':id')
  async removeTopic(@Param('id') id: string, @Request() req: any) {
    return this.topicsService.remove(id, req.user);
  }

  @Patch(':id')
  async updateTopic(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.update(id, req.user, body);
  }

  @Delete(':id/modules/:moduleId')
  async removeModule(@Param('id') id: string, @Param('moduleId') moduleId: string, @Request() req: any) {
    return this.topicsService.removeModule(id, moduleId, req.user);
  }

  @Patch(':id/modules/:moduleId/toggle')
  async toggleModuleSelection(@Param('id') id: string, @Param('moduleId') moduleId: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.toggleModule(id, moduleId, body.selected, req.user);
  }

  @Patch(':id/modules/bulk-toggle')
  async bulkToggleModules(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.bulkToggleModules(id, body.moduleIds, body.selected, req.user);
  }

  @Post(':id/modules/reorder')
  async reorderModules(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.topicsService.reorderModules(id, body.moduleIds, req.user);
  }
}
