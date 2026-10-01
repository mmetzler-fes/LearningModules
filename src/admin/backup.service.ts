import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MasterKeyService } from '../core/crypto/master-key.service';

/**
 * Gesamtsicherung: Datenbank und hochgeladene Dokumente in einer Datei,
 * verschlüsselt mit dem Masterkey. Unverschlüsselt verlässt ein Backup die
 * App nie – es enthält fremdes Material und Schülerergebnisse.
 *
 * Die Datenbank wird mit `VACUUM INTO` kopiert. Das liefert einen
 * konsistenten Stand, auch während andere Anfragen laufen.
 *
 * Der Restore ersetzt alles. Der vorherige Stand bleibt als
 * `*.before-restore` neben den Daten liegen – für den Fall, dass die falsche
 * Datei erwischt wurde. Masterkeys und App-Secret sind nicht Teil des
 * Backups; sie gehören zum Server, nicht zu den Daten.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly uploadsDir = path.join(process.cwd(), 'data', 'uploads');

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
      const database = fs.readFileSync(tmp);
      const uploads = fs.existsSync(this.uploadsDir)
        ? fs.readdirSync(this.uploadsDir)
            .filter((f) => fs.statSync(path.join(this.uploadsDir, f)).isFile())
            .map((name) => ({ name, data: fs.readFileSync(path.join(this.uploadsDir, name)).toString('base64') }))
        : [];
      return this.masterKey.encrypt('backup', {
        version: 1,
        createdAt: new Date().toISOString(),
        database: database.toString('base64'),
        uploads,
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
    const uploads: Array<{ name: string; data: string }> = Array.isArray(data.uploads) ? data.uploads : [];

    const dbPath = this.dbPath();
    const tmpUploads = `${this.uploadsDir}.restoring`;
    fs.rmSync(tmpUploads, { recursive: true, force: true });
    fs.mkdirSync(tmpUploads, { recursive: true });
    for (const u of uploads) {
      // Nur der Dateiname zählt – ein Pfad im Backup darf nirgendwohin zeigen.
      const name = path.basename(String(u.name || ''));
      if (!name || name === '.' || name === '..') continue;
      fs.writeFileSync(path.join(tmpUploads, name), Buffer.from(String(u.data || ''), 'base64'));
    }

    await this.dataSource.destroy();
    try {
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, `${dbPath}.before-restore`);
      fs.writeFileSync(dbPath, database);
    } finally {
      await this.dataSource.initialize();
    }

    const before = `${this.uploadsDir}.before-restore`;
    fs.rmSync(before, { recursive: true, force: true });
    if (fs.existsSync(this.uploadsDir)) fs.renameSync(this.uploadsDir, before);
    fs.renameSync(tmpUploads, this.uploadsDir);

    this.logger.warn(`Backup vom ${data.createdAt} eingespielt (${uploads.length} Dokumente)`);
    return { success: true, createdAt: data.createdAt, uploads: uploads.length };
  }
}
