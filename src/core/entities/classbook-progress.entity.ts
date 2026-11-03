import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { ClassNotebookMarker } from './class-notebook.entity';

/**
 * Wie weit ein Schüler mit „Weiter“ durch den 📍-Pfad eines Klassennotizbuchs
 * gekommen ist. Ein Eintrag je Klasse und Schüler. Zeigt der aktuelle Merker
 * der Klasse (`ClassNotebook.marker`) nicht mehr auf `anchor`, ist die Zeile
 * veraltet – dann gilt `position` als 0, ohne dass sie gelöscht werden muss
 * (das nächste „Weiter“ überschreibt sie mit dem neuen Anker).
 */
@Entity('classbook_progress')
@Index(['classId', 'studentId'], { unique: true })
export class ClassbookProgress extends BaseEntity {
  @Index()
  @Column()
  classId: string;

  @Column()
  studentId: string;

  @Column('simple-json')
  anchor: ClassNotebookMarker;

  /** Index ins mit `leavesInOrder(anchor)` aufgelöste Blatt-Array. */
  @Column({ type: 'integer', default: 0 })
  position: number;
}
