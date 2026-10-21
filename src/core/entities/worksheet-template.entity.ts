import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * LibreOffice-Vorlage (.ott) für den Druck von Dokumenten: eigene einer
 * Lehrkraft (ownerId) oder der Schule (schoolId, vom Schuladmin). Je Art
 * (Arbeitsblatt, Klassenarbeit) kann eine je Bereich der Standard sein.
 * Welche gilt, entscheidet TemplatesService.resolve().
 */
@Entity('worksheet_templates')
@Index(['ownerId'])
@Index(['schoolId'])
export class WorksheetTemplate extends BaseEntity {
  @Column({ type: 'varchar', nullable: true })
  ownerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  schoolId: string | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 20 })
  kind: 'arbeitsblatt' | 'klassenarbeit';

  /** Die .ott als base64 – klein, und so im Backup enthalten. */
  @Column('text')
  data: string;

  @Column({ type: 'integer', default: 0 })
  size: number;

  @Column({ default: false })
  isDefault: boolean;

  /** Ergebnis der Prüfung beim Hochladen (Platzhalter, Absatzvorlagen). */
  @Column('simple-json', { nullable: true })
  inspect: Record<string, any> | null;
}
