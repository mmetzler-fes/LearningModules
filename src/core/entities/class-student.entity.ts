import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Herkunft eines Eintrags: `confirmed` hat die Lehrkraft angelegt,
 * importiert oder bestätigt. `pending` ist bei der Anmeldung eines Schülers
 * entstanden und wartet darauf, bestätigt oder mit einem vorhandenen
 * Eintrag zusammengeführt zu werden – sonst landen Tippfehler wie "Adrain"
 * als eigene Schüler in der Liste.
 */
export type ClassStudentStatus = 'confirmed' | 'pending';

/** Ein Schüler in der Schülerliste einer Klasse. */
@Entity('class_students')
export class ClassStudent extends BaseEntity {
  @Index()
  @Column()
  classId: string;

  /** Vorname(n), Doppelvornamen in einem Feld ("Anna Lena"). */
  @Column({ default: '' })
  firstName: string;

  @Column({ default: '' })
  lastName: string;

  @Column({ type: 'varchar', default: 'confirmed' })
  status: ClassStudentStatus;

  /**
   * Schüler-ID aus der Klassenliste des SchülerLernTools. Damit aktualisiert
   * ein erneuter Import den vorhandenen Eintrag, statt ihn doppelt anzulegen.
   */
  @Column({ type: 'varchar', nullable: true })
  importId: string | null;
}
