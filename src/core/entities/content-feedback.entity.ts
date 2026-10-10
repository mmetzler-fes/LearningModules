import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Rückmeldung einer Lehrkraft zu einem Lernthema, das sie aus dem Shop
 * nutzt oder kopiert hat: Nützlichkeit in Sternen, ein Danke und auf Wunsch
 * ein Satz an die Creator. Je Lehrkraft und Lernthema eine Rückmeldung, die
 * sich jederzeit ändern lässt.
 *
 * `topicId` ist immer das Original: Wer eine Kopie bewertet, bewertet das
 * Lernthema, aus dem sie stammt.
 */
@Entity('content_feedback')
@Index(['userId', 'topicId'], { unique: true })
export class ContentFeedback extends BaseEntity {
  @Column()
  userId: string;

  @Index()
  @Column()
  topicId: string;

  /** 1 bis 5; null, wenn nur gedankt wurde. */
  @Column({ type: 'integer', nullable: true })
  stars: number | null;

  @Column({ default: false })
  thanks: boolean;

  /** Sehen nur die Creator und der Anbieter – mit Namen. */
  @Column({ type: 'varchar', nullable: true })
  comment: string | null;
}
