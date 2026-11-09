import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 🤖 Sitzung der KI-Schnittstelle (src/ai-bridge): zeitlich begrenzter Zugriff
 * einer externen KI auf einen Ausschnitt von Lernnotizbuch und Planung. In der
 * Datenbank, damit „Rückgängig“ auch nach einem Neustart des Servers geht.
 * Gespeichert ist nur der Hash des Tokens.
 */
@Entity('ai_bridge_sessions')
export class AiBridgeSessionRow extends BaseEntity {
  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column()
  tokenPreview: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  /** Freigegebene Bereiche und Rechte (`AiBridgeScope`). */
  @Column('simple-json')
  scope: any;

  /** Änderungen in umgekehrter Reihenfolge rückgängig machbar (`UndoAction[]`). */
  @Column('simple-json')
  undoStack: any[];

  /** Protokoll für die Lehrkraft (`AiBridgeLogItem[]`). */
  @Column('simple-json')
  log: any[];

  /** Zweck, z. B. `regenerate` (Blatt neu aufbereiten) – bestimmt die Anleitung. */
  @Column({ type: 'varchar', nullable: true })
  purpose: string | null;
}
