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

  /**
   * Gesetzt, wenn das Konto noch mit einem vom System erzeugten
   * Initialpasswort arbeitet. Der Benutzer kommt dann erst nach einer
   * Passwortänderung an die übrigen Funktionen.
   */
  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  // Legacy columns kept nullable for migration compatibility
  @Column({ nullable: true })
  schoolId: string;

  @Column({ nullable: true })
  supervisorId: string;

  @Column('simple-json', { nullable: true })
  accessFilters: any;

  @Column('simple-json', { nullable: true })
  classIds: string[];

  /**
   * Freigegebene Themen fremder Lehrkräfte, die ich in meiner Liste
   * ausgeblendet habe. Rein persönlich: Die Freigabe der Kollegin und ihr
   * Thema bleiben davon unberührt.
   */
  @Column('simple-json', { nullable: true })
  hiddenSharedTopics: string[];

  // Password reset
  @Column({ nullable: true })
  resetPasswordToken: string;

  @Column({ nullable: true, type: 'datetime' })
  resetPasswordExpires: Date;
}
