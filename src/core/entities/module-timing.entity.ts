import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Eine Messung: so lange brauchte ein Schüler im Quiz oder in der
 * Lernbegleitung bis zur ersten Antwort auf eine Aufgabe. Bei Wahr/Falsch
 * mit mehreren Fragen gilt die Messung je Frage – wie die Zeit in der
 * Quiz-Arena.
 *
 * Bewusst ohne Namen und ohne Bezug zum Ergebnis: Gebraucht wird nur die
 * Verteilung je Modul, und die über alle Lehrkräfte, die es einsetzen.
 */
@Entity('module_timings')
export class ModuleTiming extends BaseEntity {
  @Index()
  @Column()
  moduleId: string;

  @Column('integer')
  ms: number;

  /** 'quiz' oder 'companion'. */
  @Column({ type: 'varchar' })
  mode: string;
}
