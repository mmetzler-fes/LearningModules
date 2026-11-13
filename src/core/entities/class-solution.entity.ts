import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 🔑 Lehrerlösung für eine Klasse freigegeben: Die Schüler dieser Klasse sehen die
 * Beschriftung der Lehrkraft (DocumentInk) des Dokuments – nur zum Ansehen.
 * Gibt es die Zeile, ist sie an (●). `id` = `${classId}:${moduleId}`.
 */
@Entity('class_solutions')
export class ClassSolution extends BaseEntity {
  @Index()
  @Column()
  classId: string;

  @Column()
  moduleId: string;
}
