import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Knoten der Planungsebene (docs/planung.md): Ordner (Bildungsgang, Beruf …),
 * Plan, darin Bereiche und Abschnitte wie im Notizbuch, und Teilplan-Verweise
 * (`include`, ein anderer Plan an dieser Stelle). Die Lernthemen eines Plans
 * stehen in PlanEntry – nur Verweise, nie Kopien. Regeln: src/plans/plan-rules.ts.
 */
@Entity('plan_nodes')
@Index(['ownerId', 'parentId'])
export class PlanNode extends BaseEntity {
  @Column()
  ownerId: string;

  @Column({ type: 'varchar', length: 10 })
  kind: 'folder' | 'plan' | 'area' | 'section' | 'include';

  @Column()
  title: string;

  @Column({ type: 'varchar', nullable: true })
  parentId: string | null;

  @Column({ type: 'integer', default: 0 })
  orderIndex: number;

  /** Nur bei `include`: der eingebundene Plan. */
  @Column({ type: 'varchar', nullable: true })
  refId: string | null;

  /** Aus dem Notizbuch übernommen (NotebookNode-ID oder `offer:<id>`); dann wächst er mit (`seen`). */
  @Column({ type: 'varchar', nullable: true })
  sourceNodeId: string | null;

  /** Schon übernommene Lernthemen und Knoten des Notizbuchs – Neues kommt dazu, Entferntes nicht wieder. */
  @Column('simple-json', { nullable: true })
  seen: string[] | null;
}
