import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * ✍️ Tafelbild: Beschriftung der Lehrkraft auf einem Dokument für genau eine
 * Klasse – das Dokument selbst bleibt unbeschriftet. `id` = `${classId}:${moduleId}`.
 * Der Stand wie bei DocumentInk; `studentVisible`: Schüler der Klasse sehen es (●).
 */
@Entity('class_boards')
export class ClassBoard extends BaseEntity {
  @Index()
  @Column()
  classId: string;

  @Column()
  moduleId: string;

  @Column()
  ownerId: string;

  @Column({ default: false })
  studentVisible: boolean;

  @Column('simple-json', { nullable: true })
  data: any;
}
