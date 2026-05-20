import { Controller, Get, Delete, Param, UseGuards, Request } from '@nestjs/common';
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
