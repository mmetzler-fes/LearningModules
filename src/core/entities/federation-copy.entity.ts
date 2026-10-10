import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Jemand auf einem verbundenen Server hat ein Angebot von hier kopiert. Zählt
 * unter „Geteilt & genutzt“ für die Creator – wie eine Kopie hier im Haus.
 */
@Entity('federation_copies')
@Index(['offerId'])
export class FederationCopy extends BaseEntity {
  @Column()
  peerId: string;

  @Column()
  offerId: string;

  /** `remote:<peerId>:<userId>` (siehe RemotePerson) */
  @Column()
  personId: string;

  /** Die hiesigen Lernthemen, deren Module kopiert wurden. */
  @Column('simple-json')
  topicIds: string[];
}
