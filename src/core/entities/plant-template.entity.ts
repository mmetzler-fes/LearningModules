import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Anlage aus der Bibliothek des SPS-Labors (lm-editor/src/labs/plant-core.js): Anlage, die Einträge der
 * Zuordnungstabelle, die sie braucht, wahlweise die Schrittkette. Docs: docs/plant-library.md.
 */
@Entity('plant_template')
export class PlantTemplate extends BaseEntity {
  @Index()
  @Column()
  ownerId: string;

  @Column({ default: '' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  /** { plant, io, init?, steps?, back? } */
  @Column('simple-json')
  data: Record<string, any>;

  /** Für alle Lehrkräfte dieses Servers sichtbar (zum Einsetzen, nicht zum Ändern). */
  @Column({ default: false })
  shared: boolean;
}
