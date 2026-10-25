import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Bearbeitung eines Dokuments durch einen Schüler: was er mit dem Stift
 * hineingeschrieben hat (Striche, Textfelder, Karo-Höhen – der Stand des
 * Stift-Editors), nicht das Dokument selbst. Je Link, Schüler und Modul ein
 * Eintrag; gehört der Lehrkraft, die den Link verteilt hat. Nur über einen
 * Klassenlink (Schülerausweis), siehe docs/bearbeitungen.md.
 */
@Entity('document_works')
@Index(['linkId', 'studentId', 'moduleId'], { unique: true })
export class DocumentWork extends BaseEntity {
  @Index()
  @Column()
  teacherId: string;

  @Column()
  linkId: string;

  /** Name des Links beim ersten Speichern – mitkopiert wie im Ergebnis. */
  @Column({ type: 'varchar', default: '' })
  linkName: string;

  @Index()
  @Column()
  studentId: string;

  /** Name aus der Klassenliste zum Zeitpunkt des Speicherns. */
  @Column({ default: '' })
  studentName: string;

  @Column({ type: 'varchar', nullable: true })
  classId: string | null;

  @Column({ type: 'varchar', nullable: true })
  className: string | null;

  @Column()
  moduleId: string;

  /** Lernthema des Dokuments – zum Öffnen in der Ansicht der Lehrkraft. */
  @Column({ type: 'varchar', nullable: true })
  topicId: string | null;

  /** Titel des Dokuments beim Speichern. */
  @Column({ default: '' })
  moduleTitle: string;

  /** 'exam' über den Link der Klassenarbeit, sonst 'practice'. */
  @Column({ type: 'varchar', default: 'practice' })
  access: 'practice' | 'exam';

  /** Stand des Stift-Editors: { v, bg, pages, layer, ruler, updatedAt }. */
  @Column('simple-json', { nullable: true })
  data: any;

  @Column({ type: 'integer', default: 0 })
  bytes: number;
}
