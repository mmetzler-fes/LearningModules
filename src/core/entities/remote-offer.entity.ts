import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * Angebot eines verbundenen Servers, wie es beim letzten Katalogabgleich
 * ankam. Nur die Beschreibung – den Inhalt holt erst ein Copy.
 */
@Entity('remote_offers')
@Index(['peerId'])
export class RemoteOffer {
  /** `<peerId>:<offerId>` */
  @PrimaryColumn()
  id: string;

  @Column()
  peerId: string;

  @Column()
  offerId: string;

  /** Katalogeintrag (siehe FederationService.catalogEntry), Kategorien schon auf hiesige abgebildet. */
  @Column('simple-json')
  data: any;

  @Column({ type: 'datetime' })
  fetchedAt: Date;
}
