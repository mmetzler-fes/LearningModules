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

  /** Schule der Lehrkraft (siehe School); leer = keiner Schule zugeordnet. */
  @Column({ type: 'varchar', nullable: true })
  schoolId: string | null;

  /** Zusatzrecht: verwaltet die eigene Schule (Whitelist, Lehrkräfte, Gruppen). */
  @Column({ default: false })
  isSchoolAdmin: boolean;

  /**
   * Die Schule wurde von Hand gesetzt oder entzogen. Dann ordnet die
   * Whitelist nicht mehr automatisch zu – sonst landete jemand, den der
   * Schuladmin gerade entfernt hat, beim nächsten Login wieder in der Schule.
   */
  @Column({ default: false })
  schoolManual: boolean;

  // ---- Zwei-Faktor-Anmeldung (TOTP, siehe auth/totp.ts) ----

  @Column({ default: false })
  totpEnabled: boolean;

  /** Geheimnis, verschlüsselt mit dem Masterkey – übersteht so auch einen Restore. */
  @Column({ type: 'text', nullable: true })
  totpSecret: string | null;

  /** Geheimnis während der Einrichtung, bis der erste Code bestätigt ist. */
  @Column({ type: 'text', nullable: true })
  totpPending: string | null;

  /** Zuletzt verwendeter Zeitschritt – derselbe Code gilt nur einmal. */
  @Column({ type: 'integer', nullable: true })
  totpLastStep: number | null;

  /** Hashes der noch unbenutzten Wiederherstellungscodes. */
  @Column('simple-json', { nullable: true })
  totpRecovery: string[] | null;

  @Column({ type: 'datetime', nullable: true })
  totpEnabledAt: Date | null;

  // Legacy columns kept nullable for migration compatibility

  @Column({ nullable: true })
  supervisorId: string;

  @Column('simple-json', { nullable: true })
  accessFilters: any;

  @Column('simple-json', { nullable: true })
  classIds: string[];

  /** Altlast der früheren Freigaben (persönlich ausgeblendet/entfernt); ungenutzt. */
  @Column('simple-json', { nullable: true })
  hiddenSharedTopics: string[];

  @Column('simple-json', { nullable: true })
  removedSharedTopics: string[];

  /**
   * Punktekonto für den Shop. `null` heißt: noch nie angefasst – dann gilt
   * beim ersten Zugriff das vom Admin eingestellte Startguthaben (siehe
   * PointsService). So muss das Anlegen eines Kontos nichts vom Shop wissen.
   */
  @Column({ type: 'integer', nullable: true })
  points: number | null;

  /**
   * Deaktivierte Konten können sich nicht anmelden, ihre Links sind gesperrt.
   * Ein Creator wird beim Löschen nur deaktiviert – seine Inhalte bleiben
   * erhalten und stehen für 0 Punkte im Shop. Der Admin kann ihn reaktivieren.
   */
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'datetime', nullable: true })
  deactivatedAt: Date | null;

  /**
   * IDs von Konten, die in dieses zusammengeführt wurden. Verschlüsselte
   * Exporte dieser Konten lassen sich deshalb hier weiter importieren.
   */
  @Column('simple-json', { nullable: true })
  formerIds: string[] | null;

  /**
   * E-Mail-Wechsel auf eine neue Adresse: Dieses Konto wurde dafür angelegt
   * und übernimmt das genannte, sobald hier das Initialpasswort geändert ist.
   * Erst damit ist bewiesen, dass die neue Adresse dem Benutzer gehört.
   */
  @Column({ type: 'varchar', nullable: true })
  pendingMergeFrom: string | null;

  // Password reset
  @Column({ nullable: true })
  resetPasswordToken: string;

  @Column({ nullable: true, type: 'datetime' })
  resetPasswordExpires: Date;
}
