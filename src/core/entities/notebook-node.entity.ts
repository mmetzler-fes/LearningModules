import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Ordner der Notebook-Ansicht: Book, Bereich oder Abschnitt (wie in OneNote).
 *
 * Die Struktur gehört allein der Lehrkraft, die sie anlegt – niemand sonst
 * sieht ihre Ordnung. Am Inhalt ändert sie nichts: Lernthemen hängen über
 * NotebookPlacement darin, Rechte und Shop richten sich weiter nach dem Thema.
 * Regeln zur Schachtelung: src/notebooks/notebook-rules.ts.
 */
@Entity('notebook_nodes')
@Index(['ownerId', 'parentId'])
export class NotebookNode extends BaseEntity {
  @Column()
  ownerId: string;

  @Column({ type: 'varchar', length: 10 })
  kind: 'book' | 'area' | 'section';

  @Column()
  title: string;

  /** Übergeordneter Knoten; null bei Books. */
  @Column({ type: 'varchar', nullable: true })
  parentId: string | null;

  @Column({ type: 'integer', default: 0 })
  orderIndex: number;

  /**
   * Tags des Knotens. Sie vererben sich nach unten: Jedes Lernthema darin
   * trägt sie zusätzlich (siehe NotebookPlacement.inheritedTagIds).
   */
  @Column('simple-json', { nullable: true })
  tagIds: string[] | null;
}
