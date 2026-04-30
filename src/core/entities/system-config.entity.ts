import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Key-value store for system configuration.
 * Used for whitelist/blacklist of teacher and admin email registrations.
 *
 * Keys:
 *   'teacher_whitelist' : string[] - allowed email domains/addresses for teacher registration
 *   'teacher_blacklist' : string[] - blocked email domains/addresses for teacher registration
 *   'admin_whitelist'   : string[] - allowed email domains/addresses for admin creation
 *   'admin_blacklist'   : string[] - blocked email domains/addresses for admin creation
 */
@Entity('system_config')
export class SystemConfig {
  @PrimaryColumn()
  key: string;

  @Column('simple-json', { nullable: true })
  value: any;
}
