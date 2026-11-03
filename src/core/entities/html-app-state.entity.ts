import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** Gespeicherter Stand einer HTML-App (`LM.saveState`), je Modul und Schüler. */
@Entity('html_app_states')
@Index(['moduleId', 'studentId'], { unique: true })
export class HtmlAppState extends BaseEntity {
  @Column()
  moduleId: string;

  @Column()
  studentId: string;

  @Column({ type: 'text' })
  data: string;

  /** Abschnitte, die der Schüler geöffnet hat (`LM.enter`): „👁 geöffnet“ in der Klassenübersicht. */
  @Column('simple-json', { nullable: true })
  opened: string[] | null;
}
