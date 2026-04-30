import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('admin/schools')
@UseGuards(JwtAuthGuard)
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Get()
  async findAll() {
    return this.schoolsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.schoolsService.findOne(id);
  }

  @Post()
  async create(@Body() school: any) {
    return this.schoolsService.create(school);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() update: any) {
    return this.schoolsService.update(id, update);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.schoolsService.remove(id);
  }
}
