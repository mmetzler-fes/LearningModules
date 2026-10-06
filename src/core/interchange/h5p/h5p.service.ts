import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';
import { buildH5pPackage, H5pExportResult } from './h5p-export';

/**
 * H5P-Export. Der Aufbau des Pakets steckt in h5p-export.ts; hier nur das
 * Laden der mitgelieferten Bibliotheken (assets/h5p/libraries.zip).
 */
@Injectable()
export class H5pService {
  private libraries: Buffer | null = null;

  // Der H5P-Import im InterchangeController legt Themen über diese Repositories an.
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
  ) {}

  private loadLibraries(): Buffer {
    if (this.libraries) return this.libraries;
    // dist/core/interchange/h5p → Projektwurzel; im Container ist es /app.
    const candidates = [
      path.resolve(__dirname, '../../../../assets/h5p/libraries.zip'),
      path.resolve(process.cwd(), 'assets/h5p/libraries.zip'),
    ];
    const file = candidates.find((f) => fs.existsSync(f));
    if (!file) throw new Error('H5P-Bibliotheken fehlen (assets/h5p/libraries.zip).');
    this.libraries = fs.readFileSync(file);
    return this.libraries;
  }

  /**
   * Baut das H5P-Paket aus den übergebenen Modulen. Welche das sind,
   * entscheidet der Aufrufer (ExportService) – unverschlüsselt sind es nur
   * die selbst verfassten.
   */
  generateH5p(topic: LearningTopic, modules: LearningModule[]): H5pExportResult {
    const active = modules
      .filter((m) => !m.parentId && m.moduleSelected !== false)
      .map((m) => ({ id: m.id, type: m.type, title: m.title, description: m.description, content: m.content }));
    return buildH5pPackage(topic.title, active, this.loadLibraries());
  }
}
