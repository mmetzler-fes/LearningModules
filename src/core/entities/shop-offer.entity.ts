import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Angebot im Lernmodule-Shop. Jede Weitergabe von Inhalten läuft hierüber –
 * auch das Teilen an eine Gruppe ist ein (meist kostenloses) Angebot, das nur
 * diese Gruppe sieht.
 *
 * Zwei Arten, weil die Rechte verschieden sind:
 *
 *   creator – der Verfasser bietet seine eigenen Module eines Themas an,
 *             zum Kopieren und/oder Verwenden, mit oder ohne Punkte.
 *             Fremde Module im selben Thema gehören nie zum Angebot.
 *   buyer   – wer eine Kopie gekauft hat, darf sie kostenlos zur Nutzung
 *             weitergeben, an höchstens N Personen (Admin-Einstellung).
 *             Kopieren ist hier ausgeschlossen.
 *
 * Pro Thema gibt es höchstens ein Angebot je Art.
 */
export type OfferKind = 'creator' | 'buyer';

@Entity('shop_offers')
@Index(['topicId', 'kind'], { unique: true })
export class ShopOffer extends BaseEntity {
  @Column()
  topicId: string;

  @Column()
  sellerId: string;

  @Column({ type: 'varchar', length: 10 })
  kind: OfferKind;

  @Column({ default: false })
  allowCopy: boolean;

  @Column({ default: false })
  allowUse: boolean;

  @Column({ type: 'integer', default: 0 })
  priceCopy: number;

  @Column({ type: 'integer', default: 0 })
  priceUse: number;

  /**
   * Wer das Angebot sieht: ['*'] für alle, sonst Benutzer-IDs und
   * 'group:<id>'. Eine Gruppe wirkt fortlaufend, wie bisher bei Freigaben.
   */
  @Column('simple-json')
  audience: string[];

  /** Zurückgezogene Angebote bleiben stehen – gekaufte Rechte hängen daran. */
  @Column({ default: true })
  active: boolean;

  /**
   * Gesetzt, wenn das Angebot beim Deaktivieren des Verkäufers auf
   * "alle, 0 Punkte" umgestellt wurde. Darin steht der vorherige Zustand
   * (oder null, wenn es vorher keins gab), damit die Reaktivierung ihn
   * wiederherstellen kann.
   */
  @Column({ default: false })
  fromDeactivation: boolean;

  @Column('simple-json', { nullable: true })
  savedState: any;
}
