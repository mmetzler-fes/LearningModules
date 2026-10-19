import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Nextcloud einer Lehrkraft (docs/nextcloud.md): ein freigegebener Ordner
 * mit Passwort – die App sieht nur ihn, kein Konto. Darin Bilder/<Thema>/
 * und Backups/.
 */
@Entity('nextcloud_links')
@Index(['userId'], { unique: true })
export class NextcloudLink extends BaseEntity {
  @Column()
  userId: string;

  /** https://cloud.example.org – ggf. mit Unterpfad, ohne /index.php. */
  @Column({ default: '' })
  baseUrl: string;

  /** Kürzel der Ordnerfreigabe (…/s/<Kürzel>), mit „Hochladen und Bearbeiten“. */
  @Column({ type: 'varchar', nullable: true })
  shareToken: string | null;

  /** Passwort der Freigabe, verschlüsselt mit dem App-Secret. Wird nie ausgegeben. */
  @Column({ type: 'text', nullable: true })
  passwordSealed: string | null;

  /** Welcher WebDAV-Weg der Freigabe funktioniert (je nach Nextcloud-Version). */
  @Column({ type: 'varchar', length: 10, nullable: true })
  davMode: 'classic' | 'files' | null;

  /**
   * Optional: offene Lesefreigabe nur des Unterordners Bilder. Dann laden
   * Schüler Bilder direkt aus der Nextcloud; sonst reicht der Server sie durch.
   */
  @Column({ type: 'varchar', nullable: true })
  imageShareToken: string | null;

  /**
   * Unterordner im Nextcloud-Ordner der Schule (Admin-Backup), wenn die
   * Lehrkraft keine eigene Freigabe hat: Bilder/<serverFolder>/<Thema>/.
   * Wird einmal festgelegt und bleibt – sonst gingen Links kaputt.
   */
  @Column({ type: 'varchar', nullable: true })
  serverFolder: string | null;

  /** Öffentliche Adresse dieser App beim Verbinden – für die Bild-Links über den Server. */
  @Column({ type: 'varchar', nullable: true })
  appBase: string | null;

  @Column({ type: 'datetime', nullable: true })
  verifiedAt: Date | null;

  // ---- Backup der eigenen Inhalte nach <folder>/Backups (täglich) ----

  @Column({ default: false })
  backupEnabled: boolean;

  @Column({ type: 'integer', default: 18 })
  backupHour: number;

  @Column({ type: 'datetime', nullable: true })
  backupAttemptAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  backupSuccessAt: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  backupStatus: 'ok' | 'error' | null;

  @Column({ type: 'text', nullable: true })
  backupError: string | null;

  /** Zahlen des letzten erfolgreichen Laufs. */
  @Column('simple-json', { nullable: true })
  backupResult: any;

  /** Je Thema: Dateiname und Prüfsumme des zuletzt gesicherten Stands. */
  @Column('simple-json', { nullable: true })
  backupFiles: Record<string, { file: string; hash: string }> | null;

  /** Mail zur aktuellen Fehlerserie schon verschickt. */
  @Column({ default: false })
  backupFailureNotified: boolean;
}
