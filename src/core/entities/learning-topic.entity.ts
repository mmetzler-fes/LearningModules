import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { LearningModule } from './learning-module.entity';

@Entity('topics')
export class LearningTopic extends BaseEntity {
  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: false })
  selected: boolean;

  @Column()
  ownerId: string;

  @Column({ nullable: true })
  schoolId: string; // kept for migration compatibility

  @Column({ type: 'varchar', length: 20, default: 'locked' })
  visibility: 'public' | 'password' | 'locked';

  @Column({ nullable: true })
  accessPassword: string;

  @Column({ nullable: true })
  subscribeKey: string;

  /**
   * Token für den Quick-Link: Schüler starten damit ohne Lehrer-E-Mail und
   * ohne Subscribe-Key direkt das Quiz. Der Link ist der Schlüssel – wer ihn
   * hat, kommt rein. Über "neu erzeugen" lässt er sich jederzeit entwerten.
   */
  @Column({ type: 'varchar', nullable: true })
  quickToken: string | null;

  /**
   * Freigabe zum Kopieren: Liste von Benutzer-IDs, oder ['*'] für alle
   * Kolleginnen und Kollegen. Wer freigegeben bekommt, kann sich eine eigene
   * Kopie ziehen und ist deren Eigentümer – das Original bleibt unberührt.
   */
  @Column('simple-json', { nullable: true })
  sharedWith: string[] | null;

  /**
   * Zugriff auf das Original, ohne es zu kopieren. Damit kann eine Kollegin
   * das Thema in ihren eigenen Themen-Links verwenden; die Ergebnisse landen
   * trotzdem bei ihr, denn dafür zählt der Eigentümer des Links.
   *
   * Die Stufen sind bewusst geordnet: 'write' schließt 'read' ein.
   *   read  – Inhalte sehen und in eigenen Links verwenden
   *   write – zusätzlich Module bearbeiten, anlegen, löschen, umsortieren
   *
   * 'write' ist im Datenmodell vorgesehen, in der Oberfläche aber noch nicht
   * wählbar. Eigentümervorbehalte bleiben in jedem Fall: Thema löschen,
   * Freigabe ändern und Quick-Link verwalten kann nur der Ersteller.
   *
   * userId '*' steht für alle Kolleginnen und Kollegen.
   */
  @Column('simple-json', { nullable: true })
  sharedAccess: Array<{ userId: string; level: 'read' | 'write' }> | null;

  /**
   * Herkunft einer Kopie: das Thema, aus dem sie gezogen wurde.
   *
   * Nur die *direkte* Abstammung, kein Stammbaum. Die Kopie einer Kopie nennt
   * ihre unmittelbare Quelle, nicht deren Quelle – sonst sammelte ein altes
   * Thema über Jahre eine Ahnenreihe an, die niemand mehr überblickt.
   *
   * Die vier Felder stehen bewusst nebeneinander statt als Verweis allein:
   * Die Nennung soll erhalten bleiben, auch wenn das Original oder sein
   * Verfasser längst gelöscht ist. Deshalb wandern Titel und Name als Text
   * mit und werden nicht bei jeder Anzeige neu aufgelöst.
   *
   * Keines der vier Felder steht in EDITABLE_FIELDS oder OWNER_FIELDS – die
   * Herkunft lässt sich darum auch vom neuen Eigentümer nicht abstreifen.
   */
  @Column({ type: 'varchar', nullable: true })
  copiedFromId: string | null;

  @Column({ type: 'varchar', nullable: true })
  copiedFromOwnerId: string | null;

  /** Name des Verfassers zum Zeitpunkt der Kopie – bleibt auch danach stehen. */
  @Column({ type: 'varchar', nullable: true })
  copiedFromAuthor: string | null;

  /** Titel der Quelle zum Zeitpunkt der Kopie. */
  @Column({ type: 'varchar', nullable: true })
  copiedFromTitle: string | null;

  /** Schlagworte zur Einordnung (Tag-IDs, siehe Tag-Entität). */
  @Column('simple-json', { nullable: true })
  tagIds: string[] | null;

  @Column('simple-json', { nullable: true })
  permissions: {
    visibleTo: 'all' | 'none' | 'classes' | 'school';
    classIds?: string[];
  };

  @OneToMany('LearningModule', (m: any) => m.topic, { cascade: true })
  modules: LearningModule[];
}
