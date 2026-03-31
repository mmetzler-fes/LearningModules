import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('classes')
export class StudentClass extends BaseEntity {
  @Column()
  name: string;

  @Column({ nullable: true })
  schoolId: string;

  @Column({ nullable: true })
  createdByEmail?: string;

  @Column()
  createdBy: string; // User ID
}
