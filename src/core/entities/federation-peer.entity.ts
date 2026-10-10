import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Ein verbundener LearningModules-Server (docs/vernetzung.md).
 *
 * Status:
 *   outgoing – wir haben angefragt, der andere Admin hat noch nicht angenommen
 *   incoming – der andere hat angefragt, unser Admin entscheidet
 *   active   – verbunden: Kataloge werden ausgetauscht, Anfragen sind signiert
 *   ended    – getrennt oder abgelehnt (bleibt stehen, damit Herkunftsangaben
 *              lesbar bleiben; eine neue Anfrage macht daraus wieder outgoing)
 */
export type PeerStatus = 'outgoing' | 'incoming' | 'active' | 'ended';

@Entity('federation_peers')
export class FederationPeer {
  /** Die Server-Kennung des anderen (UUID). */
  @PrimaryColumn()
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** Öffentliche Adresse, z. B. https://lm.schule.de */
  @Column()
  url: string;

  /** Anzeigename, z. B. „FES Esslingen“. */
  @Column()
  name: string;

  /** Öffentlicher Ed25519-Schlüssel (SPKI, base64). */
  @Column('text')
  publicKey: string;

  @Column({ type: 'varchar', length: 10 })
  status: PeerStatus;

  @Column({ type: 'datetime', nullable: true })
  lastSyncAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lastError: string | null;

  /** Zahl der Angebote beim letzten Abgleich. */
  @Column({ type: 'integer', default: 0 })
  offerCount: number;
}
