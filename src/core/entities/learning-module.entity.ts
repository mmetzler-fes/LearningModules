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
}
