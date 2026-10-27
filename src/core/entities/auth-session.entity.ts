import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Eine Anmeldung auf einem Gerät (auth/sessions.service.ts). Das Token trägt
 * ihre ID (`sid`); gilt sie nicht mehr, ist auch das Token wertlos – so wirkt
 * „Abmelden“ auf einem anderen Gerät sofort. Mit „Angemeldet bleiben“ läuft
 * sie 90 Tage nach der letzten Nutzung ab, sonst nach 12 Stunden.
 */
@Entity('auth_sessions')
export class AuthSession extends BaseEntity {
  @Index()
  @Column()
  userId: string;

  @Column({ default: false })
  remember: boolean;

  /** Gerät und Browser, z. B. „iPad · Safari (App)“ – nur zum Wiedererkennen in der Liste. */
  @Column({ type: 'varchar', length: 80, default: '' })
  label: string;

  @Column({ type: 'datetime' })
  lastSeenAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;
}
