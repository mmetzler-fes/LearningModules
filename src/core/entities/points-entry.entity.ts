import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Eine Buchung auf einem Punktekonto. Der Kontostand selbst steht am
 * Benutzer; die Buchungen machen ihn nachvollziehbar.
 */
export type PointsReason =
  | 'start'
  | 'purchase'
  | 'sale'
  | 'yearly-decay'
  | 'yearly-bonus'
  | 'merge'
  | 'admin';

@Entity('points_entries')
@Index(['userId'])
export class PointsEntry extends BaseEntity {
  @Column()
  userId: string;

  @Column({ type: 'integer' })
  delta: number;

  /** Kontostand nach der Buchung. */
  @Column({ type: 'integer' })
  balance: number;

  @Column({ type: 'varchar', length: 20 })
  reason: PointsReason;

  /** Lesbarer Zusatz, z. B. der Thementitel. */
  @Column({ type: 'varchar', nullable: true })
  note: string | null;
}
