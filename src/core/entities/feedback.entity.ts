import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

/** 💬 Rückmeldung zu einem Fehler oder Wunsch – mit Bild (Bildschirmfoto, Zwischenablage). Docs: docs/feedback.md. */
@Entity('feedback')
export class Feedback extends BaseEntity {
  @Column('text')
  text: string;

  /** Bild als data:-Adresse (PNG/JPEG), höchstens einige MB. */
  @Column({ type: 'text', nullable: true })
  image: string | null;

  /** Wo es passiert ist: Seite, Ansicht, Dokument, Gerät, Version der Oberfläche. */
  @Column('simple-json', { nullable: true })
  context: Record<string, any> | null;

  @Column({ type: 'varchar', nullable: true })
  userId: string | null;

  /** Wer: Name und Rolle (Lehrkraft, Schüler, Gast). */
  @Column({ default: '' })
  reporter: string;

  /** 0 ohne, 1 niedrig, 2 mittel, 3 hoch. */
  @Column({ type: 'int', default: 0 })
  priority: number;

  /** open | done */
  @Column({ default: 'open' })
  status: string;

  @Column({ type: 'text', nullable: true })
  adminNote: string | null;
}
