import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export type UserRole = 'admin' | 'schooladmin' | 'teacher' | 'student';

@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true })
  username: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', length: 20 })
  role: UserRole;

  @Column({ nullable: true })
  displayName: string;

  @Column({ nullable: true })
  schoolId: string; // Shared across all school-level users

  @Column({ nullable: true })
  supervisorId: string; // The teacher ID (for students)

  @Column('simple-json', { nullable: true })
  accessFilters: {
    ips: string[];
    browserUsers: string[];
    browserDomains: string[];
  };

  @Column('simple-json', { nullable: true })
  classIds: string[];
}
