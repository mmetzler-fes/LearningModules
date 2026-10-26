import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Eintrag im Bereich „Nur für Lehrer“: ein Lernthema oder ein Knoten des Notizbuchs (Verweis). */
export interface ClassNotebookItem {
  type: 'topic' | 'node';
  id: string;
}

/**
 * Klassennotizbuch: je Klasse genau eines, angelegt beim ersten Aufruf
 * (docs/klassennotizbuch.md). Inhalte und Schülerdaten liegen woanders – die
 * Zuweisungen sind die Klassenlinks der Klasse, die Schülerdaten Ergebnisse
 * und Bearbeitungen. Hier stehen nur der Zugang der Schüler und was die
 * Lehrkraft für sich darin ablegt.
 */
@Entity('class_notebooks')
export class ClassNotebook extends BaseEntity {
  @Index({ unique: true })
  @Column()
  classId: string;

  @Column()
  ownerId: string;

  /** Klassenbuch-Link `/?k=<token>`: Name und PIN, dann alles der Klasse. „Neu“ entwertet ihn. */
  @Index({ unique: true })
  @Column()
  token: string;

  /**
   * Erstanmeldung offen bis: Solange zeigt die App Schülern, die ihre PIN
   * noch nie gesehen haben, die PIN beim Anmelden. Schaltet sich am Ende des
   * Tages selbst aus.
   */
  @Column({ type: 'datetime', nullable: true })
  firstLoginUntil: Date | null;

  /** Bereich „Nur für Lehrer“: Verweise auf Lernthemen und Knoten des Notizbuchs. */
  @Column('simple-json', { nullable: true })
  teacherItems: ClassNotebookItem[] | null;
}
