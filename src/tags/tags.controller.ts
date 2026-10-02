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

  // ---- Tag-Struktur der Schule (nur Schuladmin; geprüft im Service) ----

  @Get('school')
  async findSchoolTags(@Request() req: any) {
    return this.tagsService.findSchoolTags(req.user);
  }

  @Post('school')
  async createSchoolTag(@Request() req: any, @Body() body: { name: string; color?: string; isArea?: boolean; areaIds?: string[] }) {
    return this.tagsService.createSchoolTag(req.user, body);
  }

  @Patch('school/:id')
  async updateSchoolTag(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { name?: string; color?: string; isArea?: boolean; areaIds?: string[] },
  ) {
    return this.tagsService.updateSchoolTag(id, req.user, body);
  }

  @Delete('school/:id')
  async removeSchoolTag(@Param('id') id: string, @Request() req: any) {
    return this.tagsService.removeSchoolTag(id, req.user);
  }

  // ---- Eigene Tags ----

  @Post()
  async create(@Request() req: any, @Body() body: { name: string; color?: string; isArea?: boolean; areaIds?: string[] }) {
    return this.tagsService.create(req.user, body);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { name?: string; color?: string; isArea?: boolean; areaIds?: string[] },
  ) {
    return this.tagsService.update(id, req.user, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.tagsService.remove(id, req.user);
  }
}
