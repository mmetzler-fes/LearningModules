import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { School } from '../entities/school.entity';

@Injectable()
export class SchoolsService {
  constructor(
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
  ) {}

  async findAll() {
    return this.schoolRepo.find();
  }

  async findOne(id: string) {
    return this.schoolRepo.findOne({ where: { id } });
  }

  async create(school: Partial<School>) {
    const entity = this.schoolRepo.create(school);
    return this.schoolRepo.save(entity);
  }

  async update(id: string, update: Partial<School>) {
    await this.schoolRepo.update(id, update);
    return this.findOne(id);
  }

  async remove(id: string) {
    return this.schoolRepo.delete(id);
  }
}
