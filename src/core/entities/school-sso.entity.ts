import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Anmeldung mit dem Schulkonto (OpenID Connect, docs/sso.md) – eingerichtet vom Schuladmin.
 * Zurzeit Microsoft (Entra ID): Mandant, App-Registrierung und Client-Geheimnis (verschlüsselt).
 * Die bisherige Anmeldung (Passwort bzw. Name und PIN) bleibt immer daneben.
 */
@Entity('school_sso')
@Index(['schoolId'], { unique: true })
export class SchoolSso extends BaseEntity {
  @Column()
  schoolId: string;

  @Column({ default: 'microsoft' })
  provider: string;

  /** Mandant: GUID oder Domäne (z. B. schule.de). Nur Konten dieses Mandanten kommen hinein. */
  @Column({ default: '' })
  tenant: string;

  @Column({ default: '' })
  clientId: string;

  /** Client-Geheimnis, verschlüsselt mit dem Hauptschlüssel. Wird nie ausgegeben. */
  @Column({ type: 'text', nullable: true })
  secretSealed: string | null;

  @Column({ default: false })
  forTeachers: boolean;

  @Column({ default: false })
  forStudents: boolean;

  /** Letzte erfolgreiche Anmeldung darüber (zur Kontrolle im Admin-Bereich). */
  @Column({ type: 'datetime', nullable: true })
  lastLoginAt: Date | null;
}
