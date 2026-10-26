import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Bereich oder Abschnitt im Klassennotizbuch einer Klasse – wie im Notizbuch
 * (docs/klassennotizbuch.md), nur für diese Klasse. Die Klasse selbst ist das
 * „Book“; `parentId` leer = oberste Ebene. Ein Abschnitt enthält nur
 * Lernthemen (Zuweisungen), ein Bereich auch Bereiche und Abschnitte.
 */
@Entity('class_notebook_nodes')
export class ClassNotebookNode extends BaseEntity {
  @Index()
  @Column()
  classId: string;

  @Column({ type: 'varchar', length: 10 })
  kind: 'area' | 'section';

  @Column()
  title: string;

  @Column({ type: 'varchar', nullable: true })
  parentId: string | null;

  @Column({ type: 'integer', default: 0 })
  orderIndex: number;
}
