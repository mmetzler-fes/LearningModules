import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('results')
export class Result extends BaseEntity {
  @Column({ nullable: true })
  userId: string; // kept for legacy data

  @Column({ nullable: true })
  studentName: string; // name of the student (no account)

  @Column({ nullable: true })
  teacherId: string; // the teacher whose topic was used

  @Column({ nullable: true })
  schoolId: string; // kept for migration compatibility

  @Column({ nullable: true })
  topicId: string;

  @Column({ nullable: true })
  moduleId: string;

  @Column()
  score: number;

  @Column()
  maxScore: number;

  @Column('simple-json', { nullable: true })
  payload: any;

  /** Themen-Link, über den der Durchlauf gestartet wurde (falls vorhanden). */
  @Column({ nullable: true })
  linkId: string;

  /**
   * Name des Links zum Zeitpunkt des Durchlaufs. Bewusst mitkopiert, damit
   * die Ergebnisliste lesbar bleibt, wenn der Link umbenannt oder gelöscht wird.
   */
  @Column({ nullable: true })
  linkName: string;

  /**
   * Art des Links: 'quick' fuer einen Quick-Link, sonst leer (Themen-Link
   * bzw. ohne Link). Beim Quick-Link steht in linkName der Titel des Themas,
   * zu dem er erzeugt wurde - die Ergebnisliste gruppiert danach.
   */
  @Column({ nullable: true })
  linkKind: string;

  /**
   * Schuljahr des Durchlaufs ("SJ26-27"), beim Speichern festgehalten –
   * nicht aus dem Datum errechnet, denn der Admin stellt das Schuljahr von
   * Hand um, irgendwann in oder nach den Sommerferien.
   */
  @Column({ type: 'varchar', nullable: true })
  schoolYear: string | null;

  /** Klasse des Klassenlinks, über den der Durchlauf lief. Leer = ohne Klasse. */
  @Column({ type: 'varchar', nullable: true })
  classId: string | null;

  /** Eintrag der Schülerliste, dem der Durchlauf zugeordnet ist (Klassenlink). */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  studentId: string | null;

  /** Klassenname zum Zeitpunkt des Durchlaufs – mitkopiert wie `linkName`. */
  @Column({ type: 'varchar', nullable: true })
  className: string | null;

  /** Modus des Durchlaufs: 'quiz' | 'exam' | 'learn' | 'companion' | 'contest'. */
  @Column({ nullable: true })
  mode: string;

  @Column({ nullable: true })
  ipAddress: string;
}
