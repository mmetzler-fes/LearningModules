import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { PreviousShare } from './nextcloud-link.entity';

/**
 * Nextcloud einer Schule für die Bilder ihrer Lehrkräfte (docs/nextcloud.md):
 * ein freigegebener Ordner mit Passwort, eingerichtet vom Schuladmin. Darin
 * Bilder/<Lehrkraft>/<Thema>/. Eine eigene Freigabe der Lehrkraft geht vor.
 *
 * Die Kennung steckt in den Bild-Links (/api/nextcloud/sch/<id>/…) – sie
 * bleibt, auch wenn der Schuladmin in eine andere Freigabe umzieht.
 */
@Entity('school_nextcloud')
@Index(['schoolId'], { unique: true })
export class SchoolNextcloud extends BaseEntity {
  @Column()
  schoolId: string;

  /** https://cloud.example.org – ggf. mit Unterpfad. */
  @Column({ default: '' })
  baseUrl: string;

  /** Kürzel der Ordnerfreigabe (…/s/<Kürzel>), mit „Hochladen und Bearbeiten“; null = getrennt. */
  @Column({ type: 'varchar', nullable: true })
  shareToken: string | null;

  /** Passwort der Freigabe, verschlüsselt mit dem App-Secret. Wird nie ausgegeben. */
  @Column({ type: 'text', nullable: true })
  passwordSealed: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  davMode: 'classic' | 'files' | null;

  @Column({ type: 'datetime', nullable: true })
  verifiedAt: Date | null;

  /** Die Freigabe ließ sich bei der letzten Prüfung ohne Passwort öffnen (Warnung). */
  @Column({ type: 'datetime', nullable: true })
  insecureAt: Date | null;

  /** Öffentliche Adresse dieser App beim Verbinden – für die Bild-Links. */
  @Column({ type: 'varchar', nullable: true })
  appBase: string | null;

  /** Letzter Umzug: { at, from, copied, error? }. */
  @Column('simple-json', { nullable: true })
  moveResult: any;

  /** Frühere Freigaben, solange Links daran hingen – Quelle für fehlende Bilder (wie bei NextcloudLink). */
  @Column('simple-json', { nullable: true })
  previousShares: PreviousShare[] | null;
}
