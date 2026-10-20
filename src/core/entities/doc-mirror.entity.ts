import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Was die App von einem Dokument (Modultyp „Dokument“) in die Nextcloud
 * geschrieben hat: Pfade und ETags je Datei, dazu der Prüfwert des Inhalts.
 * Grundlage für den Abgleich (src/worksheets/doc-mirror.ts): umziehen statt
 * neu schreiben, nie fremde oder von Hand geänderte Dateien überschreiben.
 */
@Entity('doc_mirrors')
@Index(['ownerId', 'moduleId'], { unique: true })
export class DocMirror extends BaseEntity {
  @Column()
  ownerId: string;

  @Column()
  moduleId: string;

  /** Ablage, in die geschrieben wurde (eigene Freigabe oder Schul-Nextcloud). */
  @Column()
  storeKey: string;

  /** [{ art, path: string[], etag }] relativ zum Ordner Arbeitsblätter/ */
  @Column('simple-json')
  files: Array<{ art: string; path: string[]; etag: string }>;

  @Column({ type: 'varchar', nullable: true })
  hash: string | null;

  @Column({ type: 'varchar', length: 10, default: 'ok' })
  status: 'ok' | 'error';

  @Column({ type: 'varchar', nullable: true })
  error: string | null;
}
