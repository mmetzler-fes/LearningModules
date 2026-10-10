import { Entity, Column, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { LearningTopic } from './learning-topic.entity';

@Entity('modules')
export class LearningModule extends BaseEntity {
  @Column()
  type: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: true })
  moduleSelected: boolean;

  @Column('simple-json', { nullable: true })
  content: any; // Specific module data (answers, questions, etc.)

  @ManyToOne(() => LearningTopic, (t) => t.modules)
  topic: LearningTopic;

  @Column({ nullable: true })
  topicId: string;

  // Support for nested modules (composite/H5P)
  @ManyToOne(() => LearningModule, (m) => m.subModules)
  parent: LearningModule;

  @Column({ nullable: true })
  parentId: string;

  @OneToMany(() => LearningModule, (m) => m.parent)
  subModules: LearningModule[];

  @Column({ default: 0 })
  orderIndex: number;

  /**
   * Schlagworte zur Einordnung (Tag-IDs, siehe Tag-Entitaet). Bewusst am
   * Modul und nicht nur am Thema: Ein Thema "Python" enthaelt Module zu
   * Schleifen, Listen und OOP, die sich sonst nicht auseinanderhalten lassen.
   */
  @Column('simple-json', { nullable: true })
  tagIds: string[] | null;

  /**
   * Wer dieses Modul verfasst hat. Bleibt bei Kopie, Kauf, Bearbeitung und
   * Verschieben erhalten – nur der Creator darf das Modul im Shop anbieten
   * und unverschlüsselt exportieren. Siehe docs/shop-und-rechte.md.
   *
   * Gesetzt wird er ausschließlich vom Server: beim Anlegen auf den
   * Anlegenden, danach nie wieder (außer beim Zusammenführen zweier Konten).
   */
  @Column({ type: 'varchar', nullable: true })
  creatorId: string | null;

  /**
   * Herkunft einer Kopie: das ursprüngliche Modul, aus dem sie – auch über
   * mehrere Stufen – entstanden ist. Leer bei einem Original. Bleibt bei
   * jeder weiteren Kopie gleich, damit Nutzung und Bewertung beim Creator des
   * Originals ankommen (siehe docs/nutzung-und-bewertung.md).
   */
  @Column({ type: 'varchar', nullable: true })
  originId: string | null;
}
