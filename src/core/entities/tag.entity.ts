import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Schlagwort zur Einordnung von Lernthemen und Themen-Links,
 * z. B. "Informatik" oder "Arduino".
 *
 * Tags gehören einer Lehrkraft. Zwei Lehrkräfte dürfen denselben Namen
 * vergeben, ohne sich gegenseitig in die Quere zu kommen; innerhalb eines
 * Kontos ist der Name dagegen eindeutig (siehe TagsService).
 */
@Entity('tags')
@Index(['ownerId', 'name'])
export class Tag extends BaseEntity {
  @Column()
  name: string;

  @Column()
  ownerId: string;

  /** Optionale Farbe (#rrggbb) für die Darstellung als Chip. */
  @Column({ type: 'varchar', nullable: true })
  color: string | null;
}
