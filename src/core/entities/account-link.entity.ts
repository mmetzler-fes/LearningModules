import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Dieselbe Lehrkraft auf einem verbundenen Server (docs/uebergabe.md):
 * bestätigt über einen Code, nicht über die E-Mail-Adresse – die könnte ein
 * fremder Admin für jedes Konto eintragen.
 *
 * Jeder der beiden Server hat seine Zeile. `autoSync` gilt für diese Seite:
 * Inhalte vom anderen Server regelmäßig hierher holen.
 */
@Entity('account_links')
@Index(['localUserId', 'peerId'], { unique: true })
export class AccountLink extends BaseEntity {
  @Column()
  localUserId: string;

  @Column()
  peerId: string;

  /** Kennung des Kontos auf dem anderen Server. */
  @Column()
  remoteUserId: string;

  @Column({ default: '' })
  remoteName: string;

  @Column({ default: false })
  autoSync: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastSyncAt: Date | null;

  /** Ergebnis des letzten Abgleichs (Zahlen, Konflikte, Fehler). */
  @Column('simple-json', { nullable: true })
  lastResult: any;
}
