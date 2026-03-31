import { CreateDateColumn, UpdateDateColumn, PrimaryColumn } from 'typeorm';

export abstract class BaseEntity {
  @PrimaryColumn()
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
