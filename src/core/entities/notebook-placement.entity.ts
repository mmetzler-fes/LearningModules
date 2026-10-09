import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Platz eines Lernthemas in der Notebook-Struktur einer Lehrkraft.
 *
 * Getrennt vom Thema, weil auch Themen mit Nutzungsrecht (Use) darin stehen:
 * Sie gehören jemand anderem, einordnen darf sie trotzdem jede Lehrkraft für
 * sich. Jedes Thema hat je Lehrkraft genau einen Platz.
 */
@Entity('notebook_placements')
@Index(['ownerId', 'topicId'], { unique: true })
export class NotebookPlacement extends BaseEntity {
  @Column()
  ownerId: string;

  @Column()
  topicId: string;

  /** Book, Bereich oder Abschnitt; null = „Unsortiert“. */
  @Column({ type: 'varchar', nullable: true })
  nodeId: string | null;

  @Column({ type: 'integer', default: 0 })
  orderIndex: number;

  /**
   * Tags, die das Thema nur über seinen Platz trägt (von Book, Bereich,
   * Abschnitt geerbt). Beim Umziehen fallen genau diese weg; was das Thema
   * selbst trägt, bleibt. Nur bei eigenen Themen – fremde ändern wir nicht.
   */
  @Column('simple-json', { nullable: true })
  inheritedTagIds: string[] | null;
}
