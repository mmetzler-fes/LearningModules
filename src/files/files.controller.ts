import {
  Controller, Get, Post, Delete, Param, Request, Res, UseGuards, GoneException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * Hochladen ist abgeschaltet: Dokumente liegen nicht mehr auf diesem
   * Server, sondern dort, wo die Lehrkraft sie selbst verantwortet
   * (Schulserver, Nextcloud …). Das Modul "Dokument / PDF" nimmt nur noch
   * eine Adresse. Bereits hochgeladene Dateien bleiben über GET abrufbar,
   * bis ihre Module auf eine eigene Adresse umgestellt sind.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async upload() {
    throw new GoneException(
      'Dateien werden nicht mehr auf dem App-Server gespeichert. Bitte die Adresse einer PDF-Datei angeben, z. B. einen Nextcloud-Freigabelink.',
    );
  }

  /** Die eigenen Dateien – zum Nachschauen und Aufräumen. */
  @Get()
  @UseGuards(JwtAuthGuard)
  async listMine(@Request() req: any) {
    return this.filesService.listMine(req.user);
  }

  /**
   * Abruf ohne Anmeldung: Schüler sind nicht angemeldet, der Token im Pfad
   * ist der Schlüssel.
   *
   * Die Kopfzeilen sind hier wichtiger als sie aussehen. Die Datei kommt von
   * unserer eigenen Herkunft; ohne festen Typ und nosniff könnte ein Browser
   * etwas anderes darin vermuten und als Skript ausführen. Der Name dient
   * nur der Anzeige – gesucht wird ausschliesslich über den Token.
   */
  @Get(':token/:name')
  async serve(@Param('token') token: string, @Res() res: Response) {
    const { row, filePath } = await this.filesService.findForDelivery(token);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(row.size));
    res.setHeader('Content-Disposition', `inline; filename="${row.originalName}"`);
    createReadStream(filePath).pipe(res);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.filesService.remove(id, req.user);
  }
}
