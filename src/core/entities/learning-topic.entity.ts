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
   * Altlast der früheren Freigabe (kopieren bzw. verwenden). Seit dem Shop
   * liest nur noch die RightsMigrationService diese Felder: Sie überführt
   * Bestände in Angebote und Nutzungsrechte und leert sie danach.
   */
  @Column('simple-json', { nullable: true })
  sharedWith: string[] | null;

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
   * Wer Creator welches Moduls ist, steht ohnehin am Modul selbst.
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

  /**
   * Kategorien (Fach, Bildungsstufe; siehe Category). Dazu kommen beim Suchen
   * die Kategorien der Tags, die das Lernthema trägt.
   */
  @Column('simple-json', { nullable: true })
  categoryIds: string[] | null;

  /**
   * Abgleich mit dem eigenen Konto auf einem verbundenen Server
   * (docs/uebergabe.md): woher das Lernthema kommt
   * (`remote:<server>:<Lernthema dort>`), der Stand beim letzten Abgleich
   * (Prüfsumme – weicht der jetzige ab, wurde hier geändert) und wann.
   */
  @Column({ type: 'varchar', nullable: true })
  syncSource: string | null;

  @Column({ type: 'varchar', nullable: true })
  syncHash: string | null;

  @Column({ type: 'datetime', nullable: true })
  syncedAt: Date | null;
}
