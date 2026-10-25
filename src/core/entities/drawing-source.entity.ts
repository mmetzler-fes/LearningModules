import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Zeichnung mit Quelle: In der Nextcloud der Lehrkraft liegen `<name>.odg`
 * (LibreOffice Draw, zum Bearbeiten – etwa über den Sync-Client) und daneben
 * `<name>.svg`, das die Dokumente zeigen. Ändert sich die .odg (ETag), zeichnet
 * der Renderer das SVG neu, und die Links in den Modulen bekommen eine neue
 * Fassung (?v=). Siehe docs/zeichnungen.md.
 */
@Entity('drawing_sources')
@Index(['ownerId', 'folder', 'odgName'], { unique: true })
export class DrawingSource extends BaseEntity {
  @Index()
  @Column()
  ownerId: string;

  /** Lernthema, für das die Zeichnung angelegt wurde (Ordner Bilder/<Thema>). */
  @Column({ type: 'varchar', nullable: true })
  topicId: string | null;

  /** Ordner unter Bilder/ in der Ablage der Lehrkraft. */
  @Column()
  folder: string;

  @Column()
  odgName: string;

  @Column()
  svgName: string;

  /** Link, unter dem das SVG angezeigt wird (ohne ?v=). */
  @Column()
  svgUrl: string;

  @Column()
  odgUrl: string;

  /** ETag (bzw. Änderungszeit) der .odg beim letzten Zeichnen. */
  @Column({ type: 'varchar', default: '' })
  etag: string;

  @Column({ type: 'integer', default: 1 })
  version: number;
}
