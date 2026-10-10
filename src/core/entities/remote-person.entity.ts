import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Eine Lehrkraft auf einem verbundenen Server – als Creator kopierter Module
 * (`LearningModule.creatorId` = diese Kennung) oder als jemand, der hier etwas
 * kopiert hat. Nur Name und Herkunft, kein Konto.
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
}
