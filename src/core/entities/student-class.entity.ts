import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Klasse einer Lehrkraft in einem Schuljahr, z. B. "TG12" im "SJ26-27".
 *
 * Eine Klasse gehört genau zu einem Schuljahr. Beim Schuljahreswechsel wird
 * sie nicht umbenannt, sondern als neue Klasse übernommen (`predecessorId`) –
 * sonst stünden die Ergebnisse des alten Jahres plötzlich unter dem neuen
 * Namen.
 *
 * Schülerlisten sind bewusst je Lehrkraft und nicht schulweit: Nicht jede
 * Lehrkraft soll alle Schülerdaten sehen. Der Preis ist, dass zwei
 * Lehrkräfte derselben Klasse jeweils eine eigene Liste pflegen.
 */
@Entity('classes')
@Index(['ownerId', 'schoolYear'])
export class StudentClass extends BaseEntity {
  @Column()
  name: string;

  /** Lehrkraft, der die Klasse gehört. */
  @Column({ type: 'varchar', nullable: true })
  ownerId: string | null;

  /** Schuljahr im Format "SJ26-27". */
  @Column({ type: 'varchar', nullable: true })
  schoolYear: string | null;

  /**
   * Strikte Anmeldung: Schüler kommen nur mit einem Namen hinein, der genau
   * einem Eintrag der Schülerliste zugeordnet werden kann.
   */
  @Column({ default: false })
  strict: boolean;

  /**
   * Klassen-ID aus dem SchülerLernTool. Daran erkennt ein späteres Einlesen
   * dieselbe Klasse wieder, auch wenn sie umbenannt wurde.
   */
  @Column({ type: 'varchar', nullable: true })
  importId: string | null;

  /**
   * Schuljahreswechsel erledigt: 'copied' = ins neue Jahr übernommen,
   * 'dropped' = nicht mehr benötigt. Leer = der Assistent fragt noch.
   */
  @Column({ type: 'varchar', nullable: true })
  rolledOver: string | null;

  /** Klasse des Vorjahres, aus der diese übernommen wurde. */
  @Column({ type: 'varchar', nullable: true })
  predecessorId: string | null;

  // ---- Altbestand aus der Zeit vor den Schülerfreigaben ----

  @Column({ nullable: true })
  schoolId: string;

  @Column({ nullable: true })
  createdByEmail?: string;

  @Column({ type: 'varchar', nullable: true })
  createdBy: string | null;
}
