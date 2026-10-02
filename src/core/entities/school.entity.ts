import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Eine Schule mit ihren Lehrkräften. Gepflegt vom Hauptadmin; Lehrkräfte
 * mit dem Zusatzrecht "Schuladmin" verwalten ihre eigene Schule.
 *
 * Zuordnung über die Whitelist: Eine Lehrkraft ohne Schule, deren Adresse
 * auf genau eine Schul-Whitelist passt, gehört ab dem nächsten Login dazu.
 */
@Entity('schools')
export class School {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  contactEmail?: string;

  /** Adressen und Muster wie "*@fes-es.de" (siehe email-pattern.ts). */
  @Column('simple-json', { nullable: true })
  whitelist: string[] | null;

  /** Dürfen die Schuladmins die Whitelist selbst pflegen? Der Hauptadmin darf immer. */
  @Column({ default: true })
  adminsMayEditWhitelist: boolean;

  /** Dürfen die Schuladmins Lehrkräfte entfernen und (de)aktivieren? */
  @Column({ default: true })
  adminsMayManageTeachers: boolean;
}
