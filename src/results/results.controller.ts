import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ResultsService } from './results.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('results')
@UseGuards(JwtAuthGuard)
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  /** Get all results visible to the authenticated teacher/admin */
  @Get()
  async findAll(@Request() req: any) {
    return this.resultsService.findAll(req.user);
  }

  /** Eigene Ergebnisse als wieder einlesbare Datei; `?years=SJ23-24,SJ24-25` beschränkt. */
  @Get('export')
  async exportResults(@Request() req: any, @Query('years') years?: string) {
    return this.resultsService.exportResults(req.user, years ? years.split(',').map((y) => y.trim()).filter(Boolean) : undefined);
  }

  /** Ergebnis-Datei einlesen. */
  @Post('import')
  async importResults(@Request() req: any, @Body() body: any) {
    return this.resultsService.importResults(req.user, body);
  }

  /** Klassenergebnisse: Klasse, Schülerliste und die Ergebnisse ihrer Klassenlinks. */
  @Get('class/:classId')
  async forClass(@Param('classId') classId: string, @Request() req: any) {
    return this.resultsService.forClass(classId, req.user);
  }

  /** Delete a single result */
  @Delete(':id')
  async deleteOne(@Param('id') id: string, @Request() req: any) {
    return this.resultsService.deleteOne(id, req.user);
  }

  /** Delete all results visible to the authenticated teacher/admin */
  @Delete()
  async deleteAll(@Request() req: any) {
    return this.resultsService.deleteAll(req.user);
  }
}
