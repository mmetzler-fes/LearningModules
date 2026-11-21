import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Klasse in der Klassenliste der Schule (Schuladmin → 🎓 Klassen der Schule): eingelesen aus einer
 * Tabelle mit Nachname, Vorname, Klasse und UserID. Lehrkräfte übernehmen sie in eine eigene Klasse
 * (StudentClass.schoolClassId) – direkt, wenn `autoRegister` an ist, sonst nach Freigabe durch den
 * Schuladmin (SchoolClassRequest). Die eigene Schülerliste der Lehrkraft bleibt eine Kopie; sie wird
 * mit „Klasse aktualisieren → Über den Schuladmin“ wieder angeglichen.
 */
@Entity('school_classes')
@Index(['schoolId', 'schoolYear'])
export class SchoolClass extends BaseEntity {
  @Column()
  schoolId: string;

  /** Schuljahr im Format "SJ26-27". */
  @Column()
  schoolYear: string;

  @Column()
  name: string;

  /** Versetzt aus dieser Klasse des Vorjahres (Schuladmin → ⏭ Versetzen). */
  @Column({ type: 'varchar', nullable: true })
  predecessorId: string | null;

  /** Autoregistrierung: Lehrkräfte übernehmen die Klasse ohne Freigabe. */
  @Column({ default: false })
  autoRegister: boolean;
}
