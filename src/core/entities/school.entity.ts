import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('schools')
export class School {
  @PrimaryColumn()
  id: string; // schoolId, z.B. domain.de

  @Column()
  name: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  contactEmail?: string;

  // Weitere Felder nach Bedarf
}
