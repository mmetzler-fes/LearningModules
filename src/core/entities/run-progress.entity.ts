import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Wie weit ein Schüler im letzten Durchlauf eines Klassenlinks ist – für die
 * Live-Ansicht der Lehrkraft. Ein Eintrag je Link und Schüler; ein neuer
 * Start beginnt ihn von vorn. Keine Antworten, nur der Fortschritt.
 */
@Entity('run_progress')
@Index(['linkId', 'studentId'], { unique: true })
export class RunProgress extends BaseEntity {
  @Index()
  @Column()
  teacherId: string;

  @Column()
  linkId: string;

  @Column({ type: 'varchar', default: '' })
  linkName: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  classId: string | null;

  @Column()
  studentId: string;

  @Column({ default: '' })
  studentName: string;

  @Column({ type: 'varchar', default: '' })
  mode: string;

  /** Titel der Aufgaben in der Reihenfolge des Durchlaufs. */
  @Column('simple-json', { nullable: true })
  steps: string[] | null;

  /** Je Aufgabe: 'd' bearbeitet, 's' übersprungen (Weiter ohne Eingabe), 'p' teilweise (Dokument mit Quizzen), '' noch nicht dran. */
  @Column('simple-json', { nullable: true })
  states: string[] | null;

  /** Index der aktuellen Aufgabe (davor: bearbeitet bzw. übersprungen, siehe `states`). */
  @Column({ type: 'integer', default: 0 })
  done: number;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;
}
