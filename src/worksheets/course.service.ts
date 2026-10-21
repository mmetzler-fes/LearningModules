import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import { dump as yamlDump } from 'js-yaml';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { ImportService } from '../core/interchange/import/import.service';
import { NextcloudService } from '../nextcloud/nextcloud.service';
import { MAX_NODE_DEPTH, nodeDepth } from '../notebooks/notebook-rules';
import { CourseFiles, CourseFormatError, ExportDoc, readCourse, writeCourse } from './course-format';
import { docSpec } from './docspec';
import { settingsAt } from './numbering';

/**
 * Quiz-Blöcke verweisen auf Module der App – im Kurs-Projekt gibt es die
 * nicht. Dort steht stattdessen ein Hinweis.
 */
function withoutQuizzes(spec: any): any {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    if (v.type === 'quiz') return { type: 'note', text: `[Quiz: ${v.title || 'Quiz'} – online in LearningModules]` };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  return walk(spec);
}

/** Obergrenze beim Entpacken – schützt vor ZIP-Bomben (wie beim Notebook-Import). */
const MAX_UNPACKED = 200 * 1024 * 1024;

function openZip(buffer: Buffer): AdmZip {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new BadRequestException('Die Datei ist kein gültiges ZIP.');
  }
  const total = zip.getEntries().reduce((n, e) => n + (e.header.size || 0), 0);
  if (total > MAX_UNPACKED) throw new BadRequestException('Die Datei ist entpackt zu groß.');
  return zip;
}

/** Einträge eines ZIPs als Kursdateien – ohne Ordner und Mac-Beiwerk. */
function courseFiles(zip: AdmZip): CourseFiles {
  const byName = new Map<string, AdmZip.IZipEntry>();
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = e.entryName.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
    if (name.startsWith('__MACOSX/') || name.split('/').some((p) => p === '..')) continue;
    byName.set(name, e);
  }
  return { names: [...byName.keys()], read: (n) => byName.get(n)?.getData() ?? null };
}

/**
 * Kurse aus dem Arbeitsblatt-Generator einlesen und wieder ausgeben
 * (course-format.ts): ein Book oder Bereich mit den Kursangaben, je Skript
 * ein Abschnitt, je Blatt ein Lernthema mit einem Dokument.
 */
@Injectable()
export class CourseService {
  constructor(
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    private readonly importer: ImportService,
    @Optional() private readonly nextcloud?: NextcloudService,
  ) {}

  /** Ein Kurs-ZIP (kurs.yaml) und keine Notebook-Datei (notebook.json)? */
  static isCourseZip(buffer: Buffer): boolean {
    try {
      const names = new AdmZip(buffer).getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
      return !names.some((n) => n === 'notebook.json') && names.some((n) => n === 'kurs.yaml' || n.endsWith('/kurs.yaml'));
    } catch {
      return false;
    }
  }

  async importCourse(user: any, buffer: Buffer, parentId: string | null) {
    let plan;
    try {
      plan = readCourse(courseFiles(openZip(buffer)));
    } catch (e) {
      if (e instanceof CourseFormatError) throw new BadRequestException(e.message);
      throw e;
    }

    const own = await this.nodeRepo.find({ where: { ownerId: user.userId } });
    const parent = parentId ? own.find((n) => n.id === parentId) : null;
    if (parentId && !parent) throw new NotFoundException('Eintrag nicht gefunden.');
    if (parent?.kind === 'section') {
      throw new BadRequestException('Ein Kurs bringt Abschnitte mit – bitte in einem Book oder Bereich importieren, nicht in einem Abschnitt.');
    }
    if (parent && nodeDepth(own, parent.id) + 2 > MAX_NODE_DEPTH) throw new BadRequestException('Hier wäre der Kurs zu tief verschachtelt.');

    const node = (kind: 'book' | 'area' | 'section', title: string, parent: string | null, orderIndex: number, docSettings: any) =>
      this.nodeRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, kind, title: title.slice(0, 120) || 'Kurs', parentId: parent, orderIndex, tagIds: null, docSettings });
    const siblings = own.filter((n) => (n.parentId ?? null) === (parent?.id ?? null)).length;
    const root = await this.nodeRepo.save(node(parent ? 'area' : 'book', plan.title, parent?.id ?? null, siblings, plan.settings));

    const groups: Array<{ nodeId: string; sheets: string[] }> = [];
    let i = 0;
    for (const s of plan.sections) {
      const sec = await this.nodeRepo.save(node('section', s.title, root.id, i++, { skript: s.skript }));
      groups.push({ nodeId: sec.id, sheets: s.sheets });
    }
    if (plan.exams.length) {
      const ka = await this.nodeRepo.save(node('section', 'Klassenarbeiten', root.id, i++, null));
      groups.push({ nodeId: ka.id, sheets: plan.exams });
    }
    groups.push({ nodeId: root.id, sheets: plan.loose });

    let importedTopics = 0;
    const failed: string[] = [];
    for (const g of groups) {
      let order = 0;
      for (const folder of g.sheets) {
        const sheet = plan.sheets.get(folder)!;
        try {
          const res = await this.importer.importTopicData({
            topic: { title: sheet.title, description: '', modules: [{ title: sheet.title, type: 'document', description: '', orderIndex: 0, content: sheet.content }] },
          }, user);
          await this.placeRepo.save(this.placeRepo.create({ id: crypto.randomUUID(), ownerId: user.userId, topicId: res.topicId, nodeId: g.nodeId, orderIndex: order++ }));
          importedTopics++;
        } catch {
          failed.push(sheet.title);
        }
      }
    }
    const invalid = [...plan.sheets.values()].filter((s) => docSpec().validateDocSpec(s.content.spec).length).map((s) => s.folder);
    const warnings = [...plan.warnings, ...(invalid.length ? [`Mit Fehlern im Inhalt (im Editor markiert): ${invalid.join(', ')}`] : [])];
    return { success: true, course: true, id: root.id, title: root.title, importedTopics, failed, warnings };
  }

  async exportCourse(user: any, nodeId: string) {
    const nodes = await this.nodeRepo.find({ where: { ownerId: user.userId } });
    const root = nodes.find((n) => n.id === nodeId);
    if (!root) throw new NotFoundException('Eintrag nicht gefunden.');
    const places = await this.placeRepo.find({ where: { ownerId: user.userId } });
    const byOrder = (a: { orderIndex: number }, b: { orderIndex: number }) => a.orderIndex - b.orderIndex;

    // Reihenfolge wie im Baum: Unterordner, dann Lernthemen; Abschnitt merken.
    const order: Array<{ topicId: string; section: ExportDoc['section'] }> = [];
    const visit = (n: NotebookNode, section: ExportDoc['section']) => {
      const here = n.kind === 'section' ? { key: n.id, title: n.title, skript: n.docSettings?.skript } : section;
      for (const k of nodes.filter((x) => x.parentId === n.id).sort(byOrder)) visit(k, here);
      for (const p of places.filter((x) => x.nodeId === n.id).sort(byOrder)) order.push({ topicId: p.topicId, section: here });
    };
    visit(root, null);

    const ownTopics = new Set((await this.topicRepo.find({ where: { ownerId: user.userId, id: In(order.map((o) => o.topicId)) }, select: ['id'] })).map((t) => t.id));
    const mods = ownTopics.size ? await this.moduleRepo.find({ where: { topicId: In([...ownTopics]) } }) : [];
    const docs: ExportDoc[] = [];
    for (const o of order) {
      if (!ownTopics.has(o.topicId)) continue;
      const list = mods.filter((m) => m.topicId === o.topicId);
      const roots = list.filter((m) => !m.parentId).sort(byOrder);
      for (const m of roots.flatMap((r) => [r, ...list.filter((x) => x.parentId === r.id).sort(byOrder)])) {
        if (m.type !== 'document' || !m.content?.spec) continue;
        docs.push({
          title: m.title, kind: m.content.kind || 'arbeitsblatt', slug: String(m.content.slug || m.title), section: o.section,
          spec: withoutQuizzes(await this.withAppImages(m.content.spec)),
        });
      }
    }
    if (!docs.length) throw new BadRequestException('Hier liegen keine Dokumente – nichts zu exportieren.');

    const out = writeCourse(
      { title: root.title, settings: settingsAt(nodes, root.id) },
      docs,
      (spec, refs) => docSpec().resolveDocRefs(spec, refs),
      (v) => yamlDump(v, { lineWidth: -1, noRefs: true }),
    );
    const zip = new AdmZip();
    for (const [path, data] of Object.entries(out.files)) zip.addFile(path, data);
    return { title: root.title, kuerzel: out.kuerzel, buffer: zip.toBuffer(), count: docs.length, warnings: out.warnings };
  }

  /** Bilder aus der Nextcloud als data: einsetzen, damit sie mit ins ZIP kommen. */
  private async withAppImages(spec: any): Promise<any> {
    const walk = async (v: any): Promise<any> => {
      if (Array.isArray(v)) return Promise.all(v.map(walk));
      if (!v || typeof v !== 'object') return v;
      const out: any = {};
      for (const [k, x] of Object.entries(v)) out[k] = await walk(x);
      if (out.type === 'image' && typeof out.src === 'string' && /\/api\/nextcloud\//.test(out.src) && this.nextcloud) {
        const file = await this.nextcloud.readImageByUrl(out.src).catch(() => null);
        if (file) out.src = `data:${file.type};base64,${file.data.toString('base64')}`;
      }
      return out;
    };
    return walk(spec);
  }
}
