import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Ein Schüler in einer Klassenarbeit (Klassenlink, „nur ein Durchlauf“):
 * begonnen, Zwischenstand, abgegeben. Ein zweiter Start geht nur, wenn die
 * Lehrkraft den Wiedereinstieg freigibt – dann geht es mit dem Zwischenstand
 * weiter. Siehe docs/bearbeitungen.md#klassenarbeit.
 */
@Entity('exam_attempts')
@Index(['linkId', 'studentId'], { unique: true })
export class ExamAttempt extends BaseEntity {
  @Index()
  @Column()
  teacherId: string;

  @Column()
  linkId: string;

  @Column({ type: 'varchar', default: '' })
  linkName: string;

  @Column()
  studentId: string;

  @Column({ default: '' })
  studentName: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  classId: string | null;

  /** Ablauf des Schülerausweises der laufenden Anmeldung – nur sie darf speichern. */
  @Column({ type: 'bigint' })
  session: number;

  @Column({ type: 'datetime', nullable: true })
  submittedAt: Date | null;

  /** Von der Lehrkraft freigegeben: Der nächste Start setzt fort. */
  @Column({ default: false })
  reentryAllowed: boolean;

  /** Wie oft schon wieder eingestiegen. */
  @Column({ type: 'integer', default: 0 })
  reentries: number;

  /**
   * Zwischenstand des Durchlaufs: { steps: [Schlüssel je Schritt], index,
   * answers, embeddedAnswers } – Klassenarbeiten blättern nicht zurück,
   * also reicht „bis hier beantwortet“.
   */
  @Column('simple-json', { nullable: true })
  progress: any;
}
