import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * GitHub-Backup einer Lehrkraft (docs/github-backup.md): eigene Inhalte
 * regelmäßig als JSON in ein Repository der Lehrkraft schreiben.
 */
@Entity('github_backups')
@Index(['userId'], { unique: true })
export class GithubBackup extends BaseEntity {
  @Column()
  userId: string;

  /** "besitzer/repo" */
  @Column({ default: '' })
  repo: string;

  /** Personal Access Token, verschlüsselt mit dem App-Secret. Wird nie ausgegeben. */
  @Column({ type: 'text', nullable: true })
  tokenSealed: string | null;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 10, default: 'daily' })
  interval: 'weekly' | 'daily';

  /** 0 = Sonntag … 6 = Samstag (nur wöchentlich). */
  @Column({ type: 'integer', default: 1 })
  weekday: number;

  @Column({ type: 'integer', default: 18 })
  hour: number;

  @Column({ type: 'datetime', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastSuccessAt: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  lastStatus: 'ok' | 'error' | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** Zahlen des letzten erfolgreichen Laufs. */
  @Column('simple-json', { nullable: true })
  lastResult: any;

  /** Mail zur aktuellen Fehlerserie schon verschickt. */
  @Column({ default: false })
  failureNotified: boolean;

  /** Ablauf des Tokens, wie GitHub ihn meldet – null = unbekannt oder unbegrenzt. */
  @Column({ type: 'datetime', nullable: true })
  tokenExpiresAt: Date | null;

  /** Vor dem Ablauf schon gewarnt. */
  @Column({ default: false })
  expiryNotified: boolean;
}
