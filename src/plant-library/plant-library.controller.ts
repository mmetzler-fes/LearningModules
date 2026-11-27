import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlantLibraryService } from './plant-library.service';

/** Bibliothek der Anlagen des SPS-Labors: /api/plant-library. */
@Controller('plant-library')
@UseGuards(JwtAuthGuard)
export class PlantLibraryController {
  constructor(private readonly library: PlantLibraryService) {}

  @Get()
  list(@Request() req: any) {
    return this.library.list(req.user);
  }

  @Post()
  save(@Request() req: any, @Body() body: any) {
    return this.library.save(req.user, body);
  }

  @Patch(':id')
  share(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.library.share(req.user, id, !!body?.shared);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.library.remove(req.user, id);
  }
}
