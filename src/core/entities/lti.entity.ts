import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * LTI 1.3 (docs/lti.md): eine Lernplattform (z. B. Moodle) einer Schule, eingetragen vom Schuladmin.
 * Werte aus Moodle: Plattform-ID (issuer), Client-ID, Deployment-ID(s) und drei Adressen.
 */
@Entity('lti_platforms')
@Index(['issuer', 'clientId'], { unique: true })
export class LtiPlatform extends BaseEntity {
  @Column()
  schoolId: string;

  @Column({ default: 'Moodle' })
  name: string;

  /** „Plattform-ID“ in Moodle, z. B. https://moodle.schule.de */
  @Column()
  issuer: string;

  @Column()
  clientId: string;

  @Column('simple-json', { nullable: true })
  deploymentIds: string[] | null;

  /** „Authentifizierungsanfrage-URL“ (OIDC). */
  @Column({ default: '' })
  authLoginUrl: string;

  /** „Zugriffstoken-URL“ (für die Noten). */
  @Column({ default: '' })
  tokenUrl: string;

  /** „Öffentlicher Schlüsselsatz-URL“. */
  @Column({ default: '' })
  jwksUrl: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastLaunchAt: Date | null;
}

/** Moodle-Kurs ↔ Klasse in LearningModules (beim Anlegen der Aktivität gewählt: neu oder bestehend). */
@Entity('lti_courses')
@Index(['platformId', 'contextId'], { unique: true })
export class LtiCourse extends BaseEntity {
  @Column()
  platformId: string;

  @Column()
  contextId: string;

  @Column({ default: '' })
  contextTitle: string;

  @Column()
  classId: string;

  /** Lehrkraft, die die Verbindung angelegt hat (Besitzerin der Klasse). */
  @Column()
  ownerId: string;
}

/** Wohin das beste Ergebnis eines Schülers zu einem Klassenlink zurückgeht (Moodle-Bewertungsaspekt). */
@Entity('lti_grades')
@Index(['linkId', 'studentId', 'lineitem'], { unique: true })
export class LtiGrade extends BaseEntity {
  @Column()
  platformId: string;

  @Column()
  lineitem: string;

  @Column()
  linkId: string;

  @Column()
  classId: string;

  @Column()
  studentId: string;

  /** Moodle-Kennung des Schülers (sub). */
  @Column()
  userSub: string;

  /** Zuletzt gemeldetes bestes Ergebnis in Prozent. */
  @Column({ type: 'float', nullable: true })
  sentPercent: number | null;

  @Column({ type: 'datetime', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lastError: string | null;
}
