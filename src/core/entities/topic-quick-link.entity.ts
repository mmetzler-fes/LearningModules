import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Quick-Link einer Lehrkraft auf ein Thema.
 *
 * Früher hing der Token als Spalte am Thema – damit gab es genau einen
 * Quick-Link, und der gehörte zwangsläufig dem Eigentümer. Wer ein Thema nur
 * verwenden durfte, konnte keinen QR-Code verteilen, obwohl genau das der
 * Zweck der Nutzungsfreigabe ist.
 *
 * Jetzt gilt dieselbe Trennung wie beim Themen-Link: Der Inhalt gehört dem
 * Eigentümer, der Zugang gehört der Lehrkraft, die ihn verteilt. Ergebnisse
 * landen deshalb bei `ownerId` dieses Eintrags – bei der Lehrkraft, die den
 * Link ausgegeben hat, nicht beim Verfasser der Aufgaben.
 */
@Entity('topic_quick_links')
@Index(['topicId', 'ownerId'], { unique: true })
export class TopicQuickLink extends BaseEntity {
  @Column()
  topicId: string;

  /** Die Lehrkraft, die diesen Link verteilt – ihr werden die Ergebnisse gutgeschrieben. */
  @Column()
  ownerId: string;

  /** Der Link ist der Schlüssel; "neu erzeugen" entwertet den alten sofort. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  token: string;
}
