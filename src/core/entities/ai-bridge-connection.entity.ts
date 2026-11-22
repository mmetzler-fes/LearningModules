import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 🤖 Aktive OAuth-Verbindung einer externen KI („Verbundene KIs“).
 * Jede Verbindung koppelt eine KI an die dauerhafte KI-Sitzung der Lehrkraft.
 * Trennen macht die Verbindung sofort ungültig.
 */
@Entity('ai_bridge_connections')
export class AiBridgeConnectionRow extends BaseEntity {
  @Index()
  @Column()
  userId: string;

  @Column()
  clientId: string;

  /** Name der KI, z. B. „Claude.ai“ oder „ChatGPT“. */
  @Column()
  clientName: string;

  /** Zugehörige dauerhafte KI-Sitzung (`AiBridgeSessionRow.id`). */
  @Column()
  sessionId: string;

  @Index()
  @Column()
  accessTokenHash: string;

  @Column({ type: 'datetime' })
  accessTokenExpiresAt: Date;

  @Index()
  @Column()
  refreshTokenHash: string;

  @Column({ type: 'datetime' })
  lastActiveAt: Date;

  /** Wenn gesetzt: Verbindung getrennt / widerrufen. */
  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;
}
