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

  /**
   * PIN zum Weiterbearbeiten (4 Ziffern), eine je Schüler für alle Links. Die
   * Lehrkraft sieht sie in der Klassenliste; der Schüler bekommt sie einmal
   * angezeigt – beim ersten Speichern überhaupt (`pinShownAt`). Danach fragt
   * jeder Link danach (docs/bearbeitungen.md).
   */
  @Column({ type: 'varchar', length: 4, nullable: true })
  pin: string | null;

  @Column({ type: 'datetime', nullable: true })
  pinShownAt: Date | null;
}
