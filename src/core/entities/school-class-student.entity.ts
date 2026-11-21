import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Schüler in der Klassenliste der Schule (siehe SchoolClass). */
@Entity('school_class_students')
export class SchoolClassStudent extends BaseEntity {
  @Index()
  @Column()
  schoolClassId: string;

  @Column({ default: '' })
  firstName: string;

  @Column({ default: '' })
  lastName: string;

  /** UserID der Tabelle = Benutzername des Schulkontos (Teil vor dem @, klein). */
  @Column({ type: 'varchar', nullable: true })
  loginId: string | null;
}
