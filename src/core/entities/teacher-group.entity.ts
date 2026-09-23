import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Eine benannte Gruppe von Lehrkräften – typischerweise eine Fachschaft
 * ("Informatik", "Mathematik") oder ein Jahrgangsteam.
 *
 * Zweck ist allein die Freigabe: Statt zwölf Haken einzeln zu setzen, gibt
 * man an "Fachschaft Informatik" frei. Ändert sich die Besetzung, wirkt das
 * sofort auf alle bestehenden Freigaben – genau das unterscheidet eine Gruppe
 * von einer einmaligen Mehrfachauswahl.
 *
 * Gepflegt wird sie vom Admin. Das ist bewusst zentral: Dürfte jede Lehrkraft
 * eigene Verteiler anlegen, gäbe es nach einem Jahr acht Versionen von
 * "Mathe", und niemand wüsste, welche die richtige ist.
 *
 * In den Freigabelisten eines Themas steht eine Gruppe als `group:<id>` –
 * dieselben Felder wie für Einzelpersonen, damit das Modell nicht doppelt
 * geführt werden muss.
 */
@Entity('teacher_groups')
export class TeacherGroup extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  /** Benutzer-IDs der Mitglieder. */
  @Column('simple-json', { nullable: true })
  memberIds: string[] | null;
}
