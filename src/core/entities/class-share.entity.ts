import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Angebot, eine Klasse mit einer Kollegin oder einem Kollegen zu teilen.
 * Beim Annehmen entsteht eine eigene Kopie (Name und Schülerliste); danach
 * sind beide Klassen unabhängig, die Ergebnisse bleiben getrennt.
 *
 * Name, Schuljahr und Absender sind mitkopiert – das Angebot bleibt lesbar,
 * auch wenn die Klasse inzwischen umbenannt wurde.
 */
@Entity('class_shares')
export class ClassShare extends BaseEntity {
  @Column()
  classId: string;

  @Column()
  fromUserId: string;

  @Index()
  @Column()
  toUserId: string;

  /** 'offered' | 'accepted' | 'declined' */
  @Column({ type: 'varchar', default: 'offered' })
  status: string;

  @Column({ default: '' })
  className: string;

  @Column({ type: 'varchar', nullable: true })
  schoolYear: string | null;

  @Column({ default: '' })
  fromName: string;
}
