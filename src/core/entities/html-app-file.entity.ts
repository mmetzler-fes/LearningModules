import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Hochgeladene HTML-App (docs/html-apps.md). Eine Zeile ändert sich nie: Ein
 * Update ist eine neue Datei, das Modul zeigt dann auf sie. Die Datei liegt
 * nicht im Modul, sonst käme sie bei jeder Themenliste mit.
 */
@Entity('html_app_files')
export class HtmlAppFile extends BaseEntity {
  @Index()
  @Column()
  ownerId: string;

  @Column()
  sha: string;

  @Column({ type: 'integer' })
  size: number;

  @Column({ type: 'text' })
  html: string;

  /** Geprüfter Steckbrief, `null` bei einer App ohne Schnittstelle. */
  @Column('simple-json', { nullable: true })
  manifest: any;

  /**
   * Ein Admin hat diese Fassung aus dem Shop genommen. Die Sperre gilt für den Hash, also auch für
   * dieselbe Datei eines anderen Kontos. Sie betrifft nur den Shop: Eigene Klassen und Kopien laufen weiter.
   */
  @Column({ type: 'datetime', nullable: true })
  shopBlockedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  shopBlockedBy: string | null;
}
