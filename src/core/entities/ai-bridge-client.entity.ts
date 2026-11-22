import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 🤖 Registrierter OAuth-Client für die KI-Schnittstelle (RFC 7591 Dynamic Client Registration).
 * Erlaubt externen KIs (Claude.ai, ChatGPT, Claude Code …) sich als Anwendung anzumelden.
 */
@Entity('ai_bridge_clients')
export class AiBridgeClientRow extends BaseEntity {
  @Column()
  clientName: string;

  /** Zugelassene Rücksprung-Adressen (RFC 7591). */
  @Column('simple-json')
  redirectUris: string[];

  @Column({ type: 'varchar', nullable: true })
  clientSecretHash: string | null;
}
