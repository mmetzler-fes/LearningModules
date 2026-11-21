import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type SchoolClassRequestStatus = 'pending' | 'approved' | 'declined';

/**
 * Eine Lehrkraft will eine Klasse der Schulliste übernehmen (SchoolClass). Ohne Autoregistrierung
 * wartet sie auf die Freigabe des Schuladmins; `approved` gilt dann auch für späteres Aktualisieren.
 * `classId`: eigene Klasse, die damit verbunden werden soll – leer = beim Freigeben neu anlegen.
 */
@Entity('school_class_requests')
@Index(['schoolClassId', 'teacherId'])
export class SchoolClassRequest extends BaseEntity {
  @Column()
  schoolClassId: string;

  @Index()
  @Column()
  teacherId: string;

  @Column({ type: 'varchar', nullable: true })
  classId: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: SchoolClassRequestStatus;
}
