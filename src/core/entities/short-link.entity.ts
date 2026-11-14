import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Kurzlink einer Lehrkraft: `/k/<code>` leitet auf eine lange Adresse weiter –
 * z. B. eine LibreSpice-Schaltung, die ganz in der Adresse steckt. Das Ziel
 * lässt sich später ändern; der Kurzlink (und ein gedruckter QR-Code) bleibt.
 */
@Entity('short_links')
export class ShortLink extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  code: string;

  @Index()
  @Column()
  ownerId: string;

  @Column('text')
  url: string;

  /** Eigene Bezeichnung, nur für die Liste der Lehrkraft. */
  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column('integer', { default: 0 })
  hits: number;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt: Date | null;
}
