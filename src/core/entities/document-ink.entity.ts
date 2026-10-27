import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Beschriftung der Lehrkraft auf ihrem Dokument (Stift-Editor): je Dokument
 * eine, `id` = Modul-ID. Der Stand wie bei den Schülern (DocumentWork.data).
 * `visibility`: 'teacher' – nur die Lehrkraft (wie eine Lösung), 'all' –
 * auch die Schüler sehen sie unter ihrer eigenen Beschriftung.
 */
@Entity('document_inks')
export class DocumentInk extends BaseEntity {
  @Index()
  @Column()
  ownerId: string;

  @Column({ type: 'varchar', length: 10, default: 'teacher' })
  visibility: 'teacher' | 'all';

  @Column('simple-json', { nullable: true })
  data: any;
}
