import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export type UserRole = 'admin' | 'teacher';

@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true, nullable: true })
  username: string; // kept for backward compat; login is via email

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', length: 20 })
  role: UserRole;

  @Column({ nullable: true })
  displayName: string;

  // Legacy columns kept nullable for migration compatibility
  @Column({ nullable: true })
  schoolId: string;

  @Column({ nullable: true })
  supervisorId: string;

  @Column('simple-json', { nullable: true })
  accessFilters: any;

  @Column('simple-json', { nullable: true })
  classIds: string[];

  // Password reset
  @Column({ nullable: true })
  resetPasswordToken: string;

  @Column({ nullable: true, type: 'datetime' })
  resetPasswordExpires: Date;
}
