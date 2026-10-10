import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Übergabe aller Inhalte einer Lehrkraft an eine andere (docs/uebergabe.md).
 * Erst wenn der Empfänger annimmt, wandert etwas.
 *
 *   pending   – angefragt
 *   accepted  – angenommen und ausgeführt
 *   declined  – abgelehnt
 *   withdrawn – vom Absender zurückgezogen
 */
export type HandoverStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

@Entity('content_handovers')
@Index(['toUserId', 'status'])
export class ContentHandover extends BaseEntity {
  @Column()
  fromUserId: string;

  @Column()
  toUserId: string;

  /** Auch die Urheberschaft (Creator) der eigenen Module übergeben. */
  @Column({ default: false })
  withCreator: boolean;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: HandoverStatus;

  /** Ein Satz an den Empfänger (optional). */
  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  /** Was übergeben wurde (nach dem Annehmen), für die Rückmeldung. */
  @Column('simple-json', { nullable: true })
  summary: any;

  @Column({ type: 'datetime', nullable: true })
  decidedAt: Date | null;
}
