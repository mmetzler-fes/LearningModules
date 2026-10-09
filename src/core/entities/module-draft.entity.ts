import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Ungespeicherter Stand des Modul-Editors – laufend gesichert, damit nichts
 * verloren geht, wenn das Speichern vergessen wird oder der Browser abstürzt.
 *
 * Ein Entwurf gehört allein der Lehrkraft, die bearbeitet, und ist auf jedem
 * ihrer Geräte abrufbar. Veröffentlicht ist er nicht: Schüler und Nutzer per
 * Use sehen weiter das gespeicherte Modul. „Speichern“ im Editor löscht ihn.
 */
@Entity('module_drafts')
@Index(['userId', 'draftKey'], { unique: true })
export class ModuleDraft extends BaseEntity {
  @Column()
  userId: string;

  /** Modul-ID beim Bearbeiten, „new:<zufällig>“ bei einem neuen Modul. */
  @Column()
  draftKey: string;

  @Column()
  topicId: string;

  /** Das Modul, das bearbeitet wird; null bei einem neuen. */
  @Column({ type: 'varchar', nullable: true })
  moduleId: string | null;

  /** Für Listen und Rückfragen, ohne den ganzen Inhalt zu laden. */
  @Column({ default: '' })
  title: string;

  /** { title, type, description, content, tagIds } wie im Editor. */
  @Column('simple-json')
  data: any;
}
