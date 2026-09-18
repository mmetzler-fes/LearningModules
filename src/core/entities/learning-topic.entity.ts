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

  @Column('simple-json', { nullable: true })
  permissions: {
    visibleTo: 'all' | 'none' | 'classes' | 'school';
    classIds?: string[];
  };

  @OneToMany('LearningModule', (m: any) => m.topic, { cascade: true })
  modules: LearningModule[];
}
