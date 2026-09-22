import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Eine von einer Lehrkraft hochgeladene Datei – derzeit ausschliesslich PDF.
 *
 * Der Inhalt liegt als Datei unter data/uploads, hier steht nur, was dazu
 * gehört. Bewusst nicht als Blob in der Datenbank: Die SQLite-Datei bleibt
 * damit klein und schnell zu sichern, und ein Backup kann Datenbank und
 * Dokumente getrennt behandeln.
 *
 * Der Token ist der Zugangsschlüssel für Schüler, die nicht angemeldet sind –
 * dasselbe Verfahren wie beim Quick-Link eines Themas. Wer den Link hat, kommt
 * an die Datei; für Vertrauliches ist das folglich nichts.
 */
@Entity('uploads')
export class UploadedFile extends BaseEntity {
  @Index({ unique: true })
  @Column()
  token: string;

  @Column()
  ownerId: string;

  /** Name beim Hochladen – nur zur Anzeige, nie als Pfad verwendet. */
  @Column()
  originalName: string;

  @Column()
  mimeType: string;

  @Column({ type: 'integer', default: 0 })
  size: number;
}
