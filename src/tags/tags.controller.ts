import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { TagsService } from './tags.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.tagsService.findAll(req.user);
  }

  @Post()
  async create(@Request() req: any, @Body() body: { name: string; color?: string }) {
    return this.tagsService.create(req.user, body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Request() req: any, @Body() body: { name?: string; color?: string }) {
    return this.tagsService.update(id, req.user, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.tagsService.remove(id, req.user);
  }
}
