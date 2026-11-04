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
   * Shop-Freigabe durch einen Admin: der Hash, den er gesehen hat. Sie gilt nur, solange er zum
   * Hash der Datei passt; eine neue Fassung ist eine neue Datei und braucht eine neue Freigabe.
   */
  @Column({ type: 'varchar', nullable: true })
  shopApprovedSha: string | null;

  @Column({ type: 'varchar', nullable: true })
  shopApprovedBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  shopApprovedAt: Date | null;
}
