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
  schoolId: string; // The school this topic belongs to

  @Column('simple-json', { nullable: true })
  permissions: {
    visibleTo: 'all' | 'none' | 'classes' | 'school';
    classIds?: string[];
  };

  @OneToMany('LearningModule', (m: any) => m.topic, { cascade: true })
  modules: LearningModule[];
}
