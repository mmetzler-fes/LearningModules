import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import { User } from '../../entities/user.entity';
import { StudentClass } from '../../entities/student-class.entity';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';

@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);
  private readonly oldDbPath = '/home/mmetzler/.gemini/antigravity/scratch/LearningModules_RN/data/database.json';

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(StudentClass) private readonly classRepo: Repository<StudentClass>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing migration check...');
    await this.migrate();
  }

  async migrate() {
    const userCount = await this.userRepo.count();
    if (userCount > 0) {
      this.logger.log('SQLite database already populated. Skipping migration.');
      return;
    }

    if (!fs.existsSync(this.oldDbPath)) {
      this.logger.warn(`Source database/json not found at ${this.oldDbPath}.`);
      return;
    }

    this.logger.log('Starting migration from JSON to SQLite (Phase 3)...');
    try {
      const rawData = fs.readFileSync(this.oldDbPath, 'utf8');
      const db = JSON.parse(rawData);

      // 1. Migrate Users
      if (db.users) {
        this.logger.log(`Migrating ${db.users.length} users...`);
        for (const u of db.users) {
          // E-Mail übernehmen oder Dummy-Adresse generieren
          let email = u.email;
          if (!email) {
            // Fallback: username@demo.local
            email = `${u.username || 'user'}@demo.local`;
          }
          const user = this.userRepo.create({
            id: u.id,
            username: u.username,
            email,
            passwordHash: u.passwordHash,
            role: u.role,
            displayName: u.displayName,
            accessFilters: u.accessFilters,
            classIds: u.classIds,
          });
          await this.userRepo.save(user);
        }
      }

      // 2. Migrate Classes
      if (db.classes) {
        this.logger.log(`Migrating ${db.classes.length} classes...`);
        for (const c of db.classes) {
          const sClass = this.classRepo.create({
            id: c.id,
            name: c.name,
            createdBy: c.createdBy,
          });
          await this.classRepo.save(sClass);
        }
      }

      // 3. Migrate Topics & Modules
      if (db.topics) {
        this.logger.log(`Migrating ${db.topics.length} topics...`);
        for (const t of db.topics) {
          const topic = this.topicRepo.create({
            id: t.id,
            title: t.title,
            description: t.description,
            selected: !!t.selected,
            ownerId: t.ownerId,
            permissions: t.permissions,
          });
          await this.topicRepo.save(topic);

          // Migrate modules for this topic
          if (t.modules && Array.isArray(t.modules)) {
            for (const m of t.modules) {
              const mod = this.moduleRepo.create({
                id: m.id,
                title: m.title,
                type: m.type,
                description: m.description,
                content: m.content || m,
                topicId: topic.id,
              });
              await this.moduleRepo.save(mod);
            }
          }
        }
      }

      this.logger.log('Migration completed successfully.');
    } catch (err) {
      this.logger.error('Migration failed:', err);
    }
  }
}
