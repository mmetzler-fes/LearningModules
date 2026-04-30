import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { School } from '../../entities/school.entity';
import { StudentClass } from '../../entities/student-class.entity';
import * as crypto from 'crypto';

@Injectable()
export class DemoDataService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(School) private readonly schoolRepo: Repository<School>,
    @InjectRepository(StudentClass) private readonly classRepo: Repository<StudentClass>,
  ) {}

  async createDemoData() {
    // 1. Schule anlegen
    let school = await this.schoolRepo.findOne({ where: { id: 'fes-es.de' } });
    if (!school) {
      school = this.schoolRepo.create({ id: 'fes-es.de', name: 'Friedrich-Ebert-Schule' });
      await this.schoolRepo.save(school);
    }



    // 2. Admin-User anlegen
    let admin = await this.userRepo.findOne({ where: { username: 'admin' } });
    if (!admin) {
      const salt = crypto.randomBytes(8).toString('hex');
      const hash = crypto.scryptSync('admin', salt, 32).toString('hex');
      admin = this.userRepo.create({
        username: 'admin',
        email: 'admin@fes-es.de',
        passwordHash: `${salt}:${hash}`,
        role: 'admin',
        displayName: 'Admin',
        schoolId: 'fes-es.de',
      });
      await this.userRepo.save(admin);
    }

    // 3. Lehrer-User anlegen
    let lehrer = await this.userRepo.findOne({ where: { username: 'lehrer' } });
    if (!lehrer) {
      const salt = crypto.randomBytes(8).toString('hex');
      const hash = crypto.scryptSync('lehrer', salt, 32).toString('hex');
      lehrer = this.userRepo.create({
        username: 'lehrer',
        email: 'lehrer@fes-es.de',
        passwordHash: `${salt}:${hash}`,
        role: 'teacher',
        displayName: 'Lehrer',
        schoolId: 'fes-es.de',
      });
      await this.userRepo.save(lehrer);
    }

    // 4. Klasse TG12-2 anlegen
    let klasse = await this.classRepo.findOne({ where: { name: 'TG12-2', schoolId: 'fes-es.de' } });
    if (!klasse) {
      klasse = this.classRepo.create({
        name: 'TG12-2',
        schoolId: 'fes-es.de',
      });
      await this.classRepo.save(klasse);
    }

    // Student role no longer exists — skipped
    return { success: true };
  }
}
