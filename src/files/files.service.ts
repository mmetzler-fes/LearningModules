import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadedFile } from '../core/entities/uploaded-file.entity';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesService {
  /** Grösse pro Datei. Ein Arbeitsblatt bleibt weit darunter. */
  static readonly MAX_BYTES = 20 * 1024 * 1024;

  constructor(
    @InjectRepository(UploadedFile)
    private readonly fileRepo: Repository<UploadedFile>,
  ) {}

  /**
   * Ablageort der Dateien. data/ ist im Container als Volume eingehängt –
   * neben der Datenbank, damit ein Backup beides an einer Stelle findet.
   */
  private get storageDir(): string {
    return path.join(process.cwd(), 'data', 'uploads');
  }

  /** Dateiname auf der Platte. Von uns vergeben, nie aus dem Upload übernommen. */
  private pathFor(id: string): string {
    return path.join(this.storageDir, `${id}.pdf`);
  }

  /**
   * Nimmt eine hochgeladene Datei an.
   *
   * Geprüft wird der Inhalt, nicht die Endung: Eine Datei heisst schnell
   * ".pdf", ohne eine zu sein. Ein PDF beginnt mit "%PDF-".
   */
  async store(file: Express.Multer.File, user: any) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Keine Datei empfangen.');
    }
    if (file.buffer.length > FilesService.MAX_BYTES) {
      throw new BadRequestException(
        `Die Datei ist zu gross (max. ${Math.round(FilesService.MAX_BYTES / 1024 / 1024)} MB).`,
      );
    }
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('Das ist keine PDF-Datei.');
    }

    const id = crypto.randomUUID();
    // 16 Zeichen aus dem URL-sicheren Alphabet – wie beim Quick-Link: genug,
    // damit niemand den Link errät, und kurz genug zum Weitergeben.
    const token = crypto.randomBytes(12).toString('base64url');

    await fs.promises.mkdir(this.storageDir, { recursive: true });
    await fs.promises.writeFile(this.pathFor(id), file.buffer);

    const row = await this.fileRepo.save(
      this.fileRepo.create({
        id,
        token,
        ownerId: user.userId,
        originalName: this.displayName(file.originalname),
        mimeType: 'application/pdf',
        size: file.buffer.length,
      }),
    );

    return {
      success: true,
      id: row.id,
      name: row.originalName,
      size: row.size,
      url: this.urlFor(row),
    };
  }

  /**
   * Der Name, unter dem die Datei erscheint. Alles, was in einem Pfad oder
   * einem Header Ärger macht, fliegt raus – der Name landet später in einer
   * URL und in Content-Disposition.
   */
  private displayName(raw: string): string {
    const base = path.basename(String(raw || 'dokument.pdf'));
    const clean = base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120).trim();
    if (!clean || clean === '.' || clean === '..') return 'dokument.pdf';
    return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`;
  }

  /** Öffentlich abrufbare Adresse. Der Name dahinter ist nur Zierde. */
  urlFor(row: UploadedFile): string {
    return `/api/files/${row.token}/${encodeURIComponent(row.originalName)}`;
  }

  /** Datei zum Ausliefern suchen. Der Token allein berechtigt. */
  async findForDelivery(token: string) {
    const row = await this.fileRepo.findOne({ where: { token } });
    if (!row) throw new NotFoundException('Datei nicht gefunden.');

    const filePath = this.pathFor(row.id);
    if (!fs.existsSync(filePath)) {
      // Kann passieren, wenn data/uploads von aussen aufgeräumt wurde.
      throw new NotFoundException('Die Datei liegt nicht mehr auf dem Server.');
    }
    return { row, filePath };
  }

  /** Eigene Dateien, neueste zuerst. */
  async listMine(user: any) {
    const rows = await this.fileRepo.find({
      where: { ownerId: user.userId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.originalName,
      size: row.size,
      url: this.urlFor(row),
      createdAt: row.createdAt,
    }));
  }

  /**
   * Datei löschen. Nur der Eigentümer (oder ein Admin) darf das.
   *
   * Ob die Datei noch in einem Modul verlinkt ist, wird hier nicht geprüft –
   * das Modul hält nur eine URL, keine Beziehung. Deshalb die Warnung in der
   * Oberfläche statt einer falschen Sicherheit an dieser Stelle.
   */
  async remove(id: string, user: any) {
    const row = await this.fileRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Datei nicht gefunden.');
    if (row.ownerId !== user.userId && user.role !== 'admin') {
      throw new ForbiddenException('Das kann nur der Eigentümer der Datei.');
    }
    await fs.promises.rm(this.pathFor(row.id), { force: true });
    await this.fileRepo.remove(row);
    return { success: true };
  }
}
