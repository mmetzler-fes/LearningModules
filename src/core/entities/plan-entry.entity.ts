import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Lernthema in einem Plan, Bereich oder Abschnitt der Planungsebene – ein Verweis aufs Notizbuch. */
@Entity('plan_entries')
@Index(['ownerId', 'nodeId'])
export class PlanEntry extends BaseEntity {
  @Column()
  ownerId: string;

  @Column()
  nodeId: string;

  @Column()
  topicId: string;

  @Column({ type: 'integer', default: 0 })
  orderIndex: number;
}
