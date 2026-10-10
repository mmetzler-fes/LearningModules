import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Kategorie zur Einordnung von Lernthemen – einheitlich für alle Lehrkräfte
 * und, über die Kennung, auch zwischen verbundenen Servern
 * (docs/kategorien.md).
 *
 * Zwei Facetten:
 *   subject – Fach, bis zu 3 Ebenen
 *   stage   – Bildungsstufe, bis zu 2 Ebenen
 *
 * Herkunft (`source`):
 *   oeh    – Ebene 1 aus den OpenEduHub-Vokabularen (CC0), Kennung
 *            `oeh-d:<id>` bzw. `oeh-c:<id>`, mit `uri`
 *   shared – gemeinsame Ergänzung, mit der App ausgeliefert (`lm:…`)
 *   local  – auf diesem Server ergänzt (`local:<uuid>`), vom Admin oder als
 *            Vorschlag einer Lehrkraft
 *
 * Die Kennung ist der Primärschlüssel und ändert sich nie. Ausgelieferte
 * Kategorien (oeh, shared) übernimmt der Server bei jedem Start aus
 * src/categories/vocab – Namen und Ebenen kommen von dort; der Admin kann sie
 * nur ausblenden.
 */
export type CategoryFacet = 'subject' | 'stage';
export type CategorySource = 'oeh' | 'shared' | 'local';
export type CategoryStatus = 'active' | 'proposed' | 'hidden';

@Entity('categories')
@Index(['facet', 'parentId'])
export class Category {
  @PrimaryColumn()
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'varchar', length: 10 })
  facet: CategoryFacet;

  @Column({ type: 'varchar', nullable: true })
  parentId: string | null;

  @Column()
  label: string;

  @Column({ type: 'varchar', length: 10 })
  source: CategorySource;

  /** Weltweit gültige Adresse (bei OpenEduHub), sonst leer. */
  @Column({ type: 'varchar', nullable: true })
  uri: string | null;

  /**
   * active   – für alle wählbar
   * proposed – von einer Lehrkraft vorgeschlagen: sie selbst kann ihn sofort
   *            verwenden, alle anderen erst nach Bestätigung durch den Admin
   * hidden   – vom Admin ausgeblendet (nicht mehr wählbar; Zuordnungen bleiben)
   */
  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: CategoryStatus;

  /** Wer den Vorschlag gemacht hat. */
  @Column({ type: 'varchar', nullable: true })
  proposedBy: string | null;

  @Column({ type: 'integer', default: 0 })
  orderIndex: number;
}
