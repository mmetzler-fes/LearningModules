import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Abfragemodi, die ein Link freischalten kann. `companion` ist die
 * Lernbegleitung (Eule mit Kommentaren, Lernpunkten, Joker und Zeitstrafe),
 * `contest` die Quiz-Arena mit Wartebereich und Siegertreppchen.
 */
export type LinkMode = 'quiz' | 'exam' | 'learn' | 'companion' | 'contest';

/**
 * Lernbegleitung: Abweichungen dieses Links von den Vorgaben der Lehrkraft
 * bzw. der Schule. `null` oder fehlend heißt: Vorgabe übernehmen.
 */
export interface LinkCompanionSettings {
  jokerMax?: number | null;
  penaltyStart?: number | null;
  penaltyMax?: number | null;
}

/** Quiz-Arena: Punkte und Zeit je Aufgabe. */
export interface LinkContestSettings {
  /** Höchstpunktzahl je Aufgabe (richtig und sofort beantwortet). */
  maxPoints: number;
  /** Zeit je Aufgabe in Sekunden, wenn für die Aufgabe nichts eigenes gilt. */
  defaultSeconds: number;
  /** Eigene Zeit je Aufgabe: Modul-ID → Sekunden. */
  seconds: Record<string, number>;
  /** Tusch bei der Siegerehrung. */
  sound: boolean;
}

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

  /**
   * Eigener Zugang zur Klassenarbeit (`/?l=<examToken>`). Getrennt vom
   * Übungslink, damit niemand mit dem Übungslink die Klassenarbeit öffnet –
   * und damit sie sich unabhängig zurückziehen lässt.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  examToken: string | null;

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

  @Column('simple-json', { nullable: true })
  companionSettings: LinkCompanionSettings | null;

  @Column('simple-json', { nullable: true })
  contestSettings: LinkContestSettings | null;

  /**
   * Schlüssel für die Leitung der Quiz-Arena (`/?wh=<token>`). Getrennt vom
   * Schüler-Token, sonst könnte jeder Schüler die Quiz-Arena starten. Bleibt
   * stabil, damit eine gespeicherte Startdatei immer wieder funktioniert.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  contestHostToken: string | null;
}
