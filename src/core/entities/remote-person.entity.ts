import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Eine Lehrkraft auf einem verbundenen Server – als Creator kopierter Module
 * (`LearningModule.creatorId` = diese Kennung) oder als jemand, der hier etwas
 * kopiert hat. Nur Name und Herkunft, kein Konto. Wer über mehrere Server
 * hinweg kopiert, steht hier nur als „Lehrkraft“ mit einer Pseudonym-Kennung.
 */
@Entity('remote_persons')
export class RemotePerson {
  /** `remote:<peerId>:<userId>` */
  @PrimaryColumn()
  id: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column()
  peerId: string;

  @Column()
  name: string;

  /**
   * Server, auf dem die Person ist, wenn er nicht `peerId` ist – im
   * Vertrauensnetzwerk ist das ein Server, mit dem wir nicht direkt verbunden
   * sind. Angezeigt wird dann „Name @ dieser Server“.
   */
  @Column({ type: 'varchar', nullable: true })
  serverName: string | null;
}
