import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Abfragemodi, die ein Link freischalten kann. */
export type LinkMode = 'quiz' | 'exam' | 'learn';

/**
 * Auswahl eines Themas innerhalb eines Links.
 *
 * `all` bedeutet "ganzes Thema": später ergänzte Module sind automatisch
 * dabei. Sonst zählt `moduleIds` – dort stehen Module *und* Submodule
 * gemischt, denn beide sind LearningModule-Zeilen.
 */
export interface LinkTopicSelection {
  topicId: string;
  all: boolean;
  moduleIds?: string[];
}

/**
 * Themen-Link: ein benannter Zugang für Schüler, z. B. "TG12 Informatik
 * Arduino". Er bündelt eine beliebige Auswahl aus den Themen der Lehrkraft
 * und legt fest, in welchen Modi gearbeitet werden darf.
 *
 * Der Link löst den früheren globalen Prüfungsmodus ab: Ob eine Gruppe eine
 * Klassenarbeit schreibt oder übt, hängt jetzt am Link, nicht am Konto der
 * Lehrkraft.
 */
@Entity('topic_links')
export class TopicLink extends BaseEntity {
  @Column()
  name: string;

  @Column()
  ownerId: string;

  /**
   * Zugangstoken für `/?l=<token>`. Wie beim Quick-Link gilt: Der Link ist
   * der Schlüssel. Über "neu erzeugen" lässt er sich jederzeit entwerten.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  token: string | null;

  /** Deaktivierte Links bleiben erhalten, weisen Schüler aber ab. */
  @Column({ default: true })
  active: boolean;

  /**
   * Erlaubte Modi. Ist genau einer gesetzt, startet der Link direkt hinein;
   * bei mehreren wählt der Schüler nach der Namenseingabe.
   */
  @Column('simple-json')
  modes: LinkMode[];

  @Column('simple-json')
  selection: LinkTopicSelection[];

  /** Optionales Passwort, zusätzlich zur Namenseingabe. */
  @Column({ type: 'varchar', nullable: true })
  accessPassword: string | null;

  /**
   * Nur für die Klassenarbeit: Pro Schülername ist ein Durchlauf erlaubt.
   * Ein zweiter Versuch wird abgewiesen. Das ist eine Hürde, keine
   * fälschungssichere Sperre – der Name kommt schließlich vom Schüler.
   */
  @Column({ default: false })
  singleAttempt: boolean;

  @Column('simple-json', { nullable: true })
  tagIds: string[] | null;
}
