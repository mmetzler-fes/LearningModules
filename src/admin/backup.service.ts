import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MasterKeyService } from '../core/crypto/master-key.service';

/**
 * Gesamtsicherung: die Datenbank in einer Datei, verschlüsselt mit dem
 * Masterkey. Unverschlüsselt verlässt ein Backup die App nie – es enthält
 * fremdes Material und Schülerergebnisse.
 *
 * Alles, was zu den Inhalten gehört, steht in der Datenbank – auch Bilder
 * und Arbeitsblätter. Dateien legt die App nicht mehr ab; Backups aus der
 * Zeit des PDF-Uploads lassen sich trotzdem einspielen, ihre Dokumente
 * werden dabei übergangen.
 *
 * Die Datenbank wird mit `VACUUM INTO` kopiert. Das liefert einen
 * konsistenten Stand, auch während andere Anfragen laufen.
 *
 * Der Restore ersetzt alles. Der vorherige Stand bleibt als
 * `*.before-restore` neben der Datenbank liegen – für den Fall, dass die
 * falsche Datei erwischt wurde. Masterkeys und App-Secret sind nicht Teil
 * des Backups; sie gehören zum Server, nicht zu den Daten.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly masterKey: MasterKeyService,
  ) {}

  private dbPath(): string {
    return path.resolve(process.cwd(), String((this.dataSource.options as any).database));
  }

  async create(): Promise<Buffer> {
    const tmp = path.join(os.tmpdir(), `lm-backup-${crypto.randomUUID()}.sqlite`);
    try {
      await this.dataSource.query(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      return this.masterKey.encrypt('backup', {
        version: 2,
        createdAt: new Date().toISOString(),
        database: fs.readFileSync(tmp).toString('base64'),
      });
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }

  async restore(buffer: Buffer) {
    const data = this.masterKey.decrypt(buffer, 'backup');
    const database = Buffer.from(String(data?.database || ''), 'base64');
    if (!database.subarray(0, 16).equals(Buffer.from('SQLite format 3\0', 'binary'))) {
      throw new BadRequestException('Das Backup enthält keine gültige Datenbank.');
    }

    const dbPath = this.dbPath();
    await this.dataSource.destroy();
    try {
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, `${dbPath}.before-restore`);
      fs.writeFileSync(dbPath, database);
    } finally {
      await this.dataSource.initialize();
    }

    this.logger.warn(`Backup vom ${data.createdAt} eingespielt`);
    return { success: true, createdAt: data.createdAt };
  }
}
