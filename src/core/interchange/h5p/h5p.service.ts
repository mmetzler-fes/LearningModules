import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import AdmZip from 'adm-zip';
import { LearningTopic } from '../../entities/learning-topic.entity';
import { LearningModule } from '../../entities/learning-module.entity';

@Injectable()
export class H5pService {
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
  ) {}

  async generateH5pBuffer(topicId: string): Promise<Buffer> {
    const topic = await this.topicRepo.findOne({
      where: { id: topicId },
      relations: ['modules'],
    });

    if (!topic) throw new NotFoundException('Thema nicht gefunden');

    const zip = new AdmZip();

    // 1. h5p.json
    const h5pJson = {
      title: topic.title,
      mainLibrary: 'H5P.QuestionSet',
      embedTypes: ['iframe'],
      language: 'de',
      license: 'U',
      preloadedDependencies: [
        { machineName: 'H5P.QuestionSet', majorVersion: 1, minorVersion: 20 },
        { machineName: 'H5P.FontIcons', majorVersion: 1, minorVersion: 0 },
      ],
    };
    zip.addFile('h5p.json', Buffer.from(JSON.stringify(h5pJson, null, 2), 'utf-8'));

    // 2. content/content.json
    const selectedModules = (topic.modules || []).filter(m => m.moduleSelected !== false);
    const questions = selectedModules.map(mod => this.mapModuleToH5p(mod));

    const contentJson = {
      introPage: { showIntroPage: false, title: topic.title },
      progressType: 'dots',
      passPercentage: 50,
      questions,
      texts: {
        prevButton: 'Zurück',
        nextButton: 'Weiter',
        finishButton: 'Fertig',
        submitButton: 'Abschicken',
      },
    };
    zip.addFile('content/content.json', Buffer.from(JSON.stringify(contentJson, null, 2), 'utf-8'));

    this.extractAndAddImages(zip, topic);

    return zip.toBuffer();
  }

  private mapModuleToH5p(module: LearningModule) {
    return {
      library: this.getH5pLibrary(module.type),
      params: module.content,
      subContentId: module.id,
      metadata: { title: module.title },
    };
  }

  private getH5pLibrary(type: string): string {
    const map: Record<string, string> = {
      'multiChoice': 'H5P.MultiChoice 1.14',
      'dragTheWords': 'H5P.DragText 1.8',
      'markTheWords': 'H5P.MarkTheWords 1.9',
      'essay': 'H5P.Essay 1.2',
    };
    return map[type] || 'H5P.MultiChoice 1.14';
  }

  private extractAndAddImages(zip: any, topic: LearningTopic) {
    // Shared asset management logic would go here
  }
}
