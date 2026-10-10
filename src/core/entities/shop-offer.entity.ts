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

/**
 * Was ein Angebot umfasst:
 *   topic   – ein Lernthema (`topicId`)
 *   node    – ein Book, Bereich oder Abschnitt aus den Notebooks des
 *             Anbieters (`nodeId`) – mit allem, was später hineinkommt
 *   modules – eine feste Auswahl von Modulen (`moduleIds`), auch aus
 *             mehreren Lernthemen
 */
export type OfferScope = 'topic' | 'node' | 'modules';

@Entity('shop_offers')
@Index(['sellerId'])
export class ShopOffer extends BaseEntity {
  /** Bei `scopeType` 'topic' das Lernthema, sonst leer. */
  @Column({ default: '' })
  topicId: string;

  @Column({ type: 'varchar', length: 10, default: 'topic' })
  scopeType: OfferScope;

  @Column({ type: 'varchar', nullable: true })
  nodeId: string | null;

  /** Elternmodule einer festen Auswahl (Untermodule kommen mit). */
  @Column('simple-json', { nullable: true })
  moduleIds: string[] | null;

  /** Anzeigename bei Auswahl-Angeboten; sonst gilt der Titel von Thema bzw. Knoten. */
  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  /**
   * Fremde Module (als Kopie erworben) zur Nutzung mit anbieten. Kopieren
   * lassen sie sich nie – nur die eigenen. Ältere Angebote: aus.
   */
  @Column({ default: false })
  includeForeign: boolean;

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
   * `buyer` gibt es nur noch bei älteren Angeboten (Weitergabe einer
   * gekauften Kopie, alle Module, kostenlos). Neue Angebote sind `creator`
   * und nehmen fremde Module über `includeForeign` mit.
   *
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

  /**
   * Einordnung des Angebots (Fach, Bildungsstufe). Zusammen mit den
   * Kategorien der enthaltenen Lernthemen ergibt sie, wo es im Shop
   * gefunden wird. Beim Anbieten ist mindestens ein Fach nötig.
   */
  @Column('simple-json', { nullable: true })
  categoryIds: string[] | null;

  /**
   * Auch für verbundene Server (docs/vernetzung.md). Nur bei Angeboten für
   * alle; hinaus gehen nur die eigenen Module des Anbieters.
   */
  @Column({ default: false })
  federated: boolean;
}
