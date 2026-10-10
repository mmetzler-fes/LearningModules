import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Schlagwort zur Einordnung von Lernthemen und Themen-Links,
 * z. B. "Informatik" oder "Arduino".
 *
 * Tags gehören einer Lehrkraft. Zwei Lehrkräfte dürfen denselben Namen
 * vergeben, ohne sich gegenseitig in die Quere zu kommen; innerhalb eines
 * Kontos ist der Name dagegen eindeutig (siehe TagsService).
 *
 * Zwei Ebenen: Ein Tag kann ein Themengebiet sein (z. B. "Informatik"),
 * die übrigen Tags lassen sich einem oder mehreren Themengebieten zuordnen
 * (z. B. "Arduino" unter "Informatik" und "Technik"). Lernthemen und Links
 * erscheinen dann unter jedem Themengebiet, das sie direkt oder über einen
 * ihrer Tags tragen.
 *
 * Schul-Tags: Der Schuladmin gibt eine Struktur für alle Lehrkräfte der
 * Schule vor (ownerId = "school:<id>", schoolId gesetzt). Lehrkräfte sehen
 * und vergeben sie, ändern sie aber nicht; eigene Tags dürfen sie unter
 * Schul-Themengebiete hängen.
 */
@Entity('tags')
@Index(['ownerId', 'name'])
export class Tag extends BaseEntity {
  @Column()
  name: string;

  @Column()
  ownerId: string;

  /** Gesetzt bei einer Vorgabe der Schule, sonst leer (Tag einer Lehrkraft). */
  @Column({ type: 'varchar', nullable: true })
  schoolId: string | null;

  /** Optionale Farbe (#rrggbb) für die Darstellung als Chip. */
  @Column({ type: 'varchar', nullable: true })
  color: string | null;

  /** Themengebiet = Gliederungsüberschrift für Lernthemen, Links und Tags. */
  @Column({ default: false })
  isArea: boolean;

  /** Themengebiete, zu denen dieser Tag gehört (nur bei normalen Tags). */
  @Column('simple-json', { nullable: true })
  areaIds: string[] | null;

  /**
   * Kategorien, für die dieser Tag steht: Jedes Lernthema mit diesem Tag gilt
   * als so eingeordnet (z. B. Tag „TIA-Portal“ → SPS-Programmierung).
   */
  @Column('simple-json', { nullable: true })
  categoryIds: string[] | null;
}
