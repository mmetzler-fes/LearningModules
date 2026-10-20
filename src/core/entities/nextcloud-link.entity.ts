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
   * Früher: offene Lesefreigabe nur des Unterordners Bilder (Schüler luden
   * direkt aus der Nextcloud). Gibt es nicht mehr – beim Start werden solche
   * Links auf den Weg über den Server umgehängt und das Kürzel geleert.
   */
  @Column({ type: 'varchar', nullable: true })
  imageShareToken: string | null;

  /** Wann die Lesefreigabe entfiel – für einen Hinweis im Dialog („kann gelöscht werden“). */
  @Column({ type: 'datetime', nullable: true })
  readShareLostAt: Date | null;

  /** Die Freigabe ließ sich bei der letzten Prüfung ohne Passwort öffnen (Warnung im Dialog). */
  @Column({ type: 'datetime', nullable: true })
  insecureAt: Date | null;

  /** Letzter Umzug in eine andere Freigabe: { at, from, copied, error? } (Hinweis im Dialog). */
  @Column('simple-json', { nullable: true })
  moveResult: any;

  /**
   * Früher: Unterordner im Nextcloud-Ordner der Schule (Admin-Backup), wenn
   * die Lehrkraft keine eigene Freigabe hatte: Bilder/<serverFolder>/<Thema>/.
   * Neue Bilder landen dort nicht mehr; alte Links bleiben gültig.
   */
  @Column({ type: 'varchar', nullable: true })
  serverFolder: string | null;

  /**
   * Ordner der Lehrkraft in der Nextcloud ihrer Schule: Bilder/<schoolFolder>/<Thema>/.
   * Einmal festgelegt; der Name steht in den Bild-Links (/api/nextcloud/sch/…).
   */
  @Column({ type: 'varchar', nullable: true })
  schoolFolder: string | null;

  /** Bilder aus serverFolder in die eigene Freigabe übernommen und Links umgestellt. */
  @Column({ type: 'datetime', nullable: true })
  legacyMovedAt: Date | null;

  /** Zahlen bzw. Fehler des letzten Übernahme-Versuchs (attemptAt, copied, reused, modules, error …). */
  @Column('simple-json', { nullable: true })
  legacyResult: any;

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
