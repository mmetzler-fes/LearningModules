import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

/**
 * Fassung eines Dokuments, wie Schüler es bearbeitet haben: Inhalt samt
 * eingebetteter Quizze. Schlüssel ist die Prüfsumme – gleiche Fassungen
 * liegen einmal da, egal wie viele Schüler daran schreiben. So zeigt die
 * Ansicht der Lehrkraft Blatt und Beschriftung zusammen, auch wenn das
 * Dokument später geändert wird (docs/bearbeitungen.md).
 */
@Entity('document_versions')
export class DocumentVersion {
  /** sha256 über Titel, Inhalt und eingebettete Quizze. */
  @PrimaryColumn()
  id: string;

  @Column()
  moduleId: string;

  @Column({ default: '' })
  title: string;

  @Column('simple-json')
  content: any;

  /** Eingebettete Quizze: [{ id, type, title, content }]. */
  @Column('simple-json', { nullable: true })
  embedded: any[] | null;

  @CreateDateColumn()
  createdAt: Date;
}
