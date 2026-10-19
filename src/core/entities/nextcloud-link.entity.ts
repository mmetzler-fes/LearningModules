import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Nextcloud einer Lehrkraft (docs/nextcloud.md): Bilder der Module liegen
 * dort statt in der Datenbank – je Lernthema ein Ordner
 * <folder>/Bilder/<Thema>/, gelesen über eine reine Lesefreigabe.
 */
@Entity('nextcloud_links')
@Index(['userId'], { unique: true })
export class NextcloudLink extends BaseEntity {
  @Column()
  userId: string;

  /** https://cloud.example.org – ggf. mit Unterpfad, ohne /index.php. */
  @Column({ default: '' })
  baseUrl: string;

  /** Anmeldename, wie eingegeben. */
  @Column({ default: '' })
  username: string;

  /** Benutzer-ID für WebDAV (kann vom Anmeldenamen abweichen, z. B. bei LDAP). */
  @Column({ type: 'varchar', nullable: true })
  davUser: string | null;

  /** App-Passwort, verschlüsselt mit dem App-Secret. Wird nie ausgegeben. */
  @Column({ type: 'text', nullable: true })
  passwordSealed: string | null;

  /** Hauptordner in der Nextcloud, darin Bilder/<Thema>/. */
  @Column({ default: 'LearningModules' })
  folder: string;

  /** Kürzel der Lesefreigabe von <folder>/Bilder (…/s/<Kürzel>). */
  @Column({ type: 'varchar', nullable: true })
  imageShareToken: string | null;

  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  @Column({ type: 'datetime', nullable: true })
  verifiedAt: Date | null;
}
