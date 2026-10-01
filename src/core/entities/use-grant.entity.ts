import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Nutzungsrecht (Modus "Use") an einem fremden Thema.
 *
 * Es gibt keine Kopie: Der Inhaber verwendet das Original in eigenen Themen-
 * und Quick-Links, Änderungen des Verfassers wirken sofort. Er ist damit
 * Owner im Sinne des Rechtemodells, aber weder Creator noch Buyer: benutzen
 * ja, bearbeiten und weitergeben nein.
 *
 * `scope` legt fest, welche Module des Themas sichtbar sind:
 *   creator – nur die von `creatorId` verfassten (Angebot eines Creators;
 *             fremde Module im selben Thema gehören nicht dazu)
 *   all     – alle (Weitergabe eines Buyers an seine Kolleginnen)
 */
@Entity('use_grants')
@Index(['userId', 'topicId', 'offerId'], { unique: true })
export class UseGrant extends BaseEntity {
  @Column()
  userId: string;

  @Column()
  topicId: string;

  @Column({ type: 'varchar', nullable: true })
  offerId: string | null;

  @Column({ type: 'varchar', length: 10 })
  scope: 'creator' | 'all';

  @Column({ type: 'varchar', nullable: true })
  creatorId: string | null;

  /** Bezahlte Punkte. Nur kostenlose Rechte kann der Anbieter wieder entziehen. */
  @Column({ type: 'integer', default: 0 })
  pricePaid: number;
}
