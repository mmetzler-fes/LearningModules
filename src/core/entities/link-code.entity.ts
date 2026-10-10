import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

/** Einmal-Code zum Verknüpfen zweier Konten (15 Minuten gültig). */
@Entity('link_codes')
export class LinkCode {
  @PrimaryColumn()
  code: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  userId: string;

  /** Der Server, auf dem der Code eingegeben werden soll. */
  @Column()
  peerId: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;
}
