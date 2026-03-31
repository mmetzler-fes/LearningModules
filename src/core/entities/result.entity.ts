import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('results')
export class Result extends BaseEntity {
  @Column()
  userId: string; // The student

  @Column({ nullable: true })
  teacherId: string; // The supervising teacher who sees this result

  @Column({ nullable: true })
  schoolId: string;

  @Column()
  topicId: string;

  @Column()
  moduleId: string;

  @Column()
  score: number;

  @Column()
  maxScore: number;

  @Column('simple-json', { nullable: true })
  payload: any;
}
