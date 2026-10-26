import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Platz einer Zuweisung (Klassenlink, `id` = seine ID) im Baum des
 * Klassennotizbuchs. Fehlt er, steht sie auf der obersten Ebene am Ende.
 */
@Entity('class_notebook_places')
export class ClassNotebookPlace extends BaseEntity {
  @Index()
  @Column()
  classId: string;

  @Column({ type: 'varchar', nullable: true })
  nodeId: string | null;

  @Column({ type: 'integer', default: 0 })
  orderIndex: number;
}
