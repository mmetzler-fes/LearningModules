import { Entity, Column } from 'typeorm';
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

  /** Modus des Durchlaufs: 'quiz' | 'exam' | 'learn'. */
  @Column({ nullable: true })
  mode: string;

  @Column({ nullable: true })
  ipAddress: string;
}
