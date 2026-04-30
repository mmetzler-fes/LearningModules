import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('results')
export class Result extends BaseEntity {
  @Column({ nullable: true })
  userId: string; // kept for legacy data

  @Column({ nullable: true })
  studentName: string; // name of the student (no account)

  @Column({ nullable: true })
  teacherId: string; // the teacher whose topic was used

  @Column({ nullable: true })
  schoolId: string; // kept for migration compatibility

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
