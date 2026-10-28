import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Eintrag im Bereich „Nur für Lehrer“: ein Lernthema oder ein Knoten des Notizbuchs (Verweis). */
export interface ClassNotebookItem {
  type: 'topic' | 'node';
  id: string;
}

/** Merker: Hier ist die Klasse gerade – ein Modul einer Zuweisung. */
export interface ClassNotebookMarker {
  linkId: string;
  topicId: string;
  moduleId: string;
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

  /** Klassencode zum Eintippen in der Schüler-App (statt QR), z. B. „K7M4QX9P“. „Neu“ erneuert ihn mit dem Link. */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  code: string | null;

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

  /** 📍 Wo die Klasse gerade ist: Bei den Schülern ist dieses Modul aufgeklappt und hat den Fokus. */
  @Column('simple-json', { nullable: true })
  marker: ClassNotebookMarker | null;
}
