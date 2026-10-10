import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Wie oft ein Inhalt im Unterricht bearbeitet wurde – gezählt am Original,
 * nicht an der Kopie: `originId` ist das ursprüngliche Modul (siehe
 * `LearningModule.originId`). So kommt die Wirkung beim Creator an, auch wenn
 * eine Kolleg*in mit einer Kopie arbeitet und auch wenn die Kopie später
 * gelöscht wird.
 *
 * Nur Zähler, keine Namen und keine Ergebnisse: je Original, Lehrkraft,
 * Klasse und Monat die Zahl der Bearbeitungen. Das genügt für „in 5 Klassen
 * bei 3 Lehrkräften“ und lässt sich später an andere Server melden, ohne
 * dass Schülerdaten das Haus verlassen.
 */
@Entity('usage_counts')
@Index(['originId', 'teacherId', 'classId', 'period'], { unique: true })
export class UsageCount extends BaseEntity {
  /** Ursprüngliches Elternmodul (Untermodule zählen für ihr Elternmodul). */
  @Column()
  originId: string;

  /** Lehrkraft, über deren Link die Schüler gearbeitet haben. */
  @Column()
  teacherId: string;

  /** Klasse des Klassenlinks; leer ohne Klasse. */
  @Column({ default: '' })
  classId: string;

  /** Monat, z. B. „2026-10“. */
  @Column({ type: 'varchar', length: 7 })
  period: string;

  @Column({ type: 'integer', default: 0 })
  runs: number;
}
