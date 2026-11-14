import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { DocumentInk } from '../core/entities/document-ink.entity';
import { ZlmContent } from './zlm-read';
import { HtmlAppFile } from '../core/entities/html-app-file.entity';
import { NextcloudService } from '../nextcloud/nextcloud.service';
import { NextcloudBackupService } from '../nextcloud/nextcloud-backup.service';
import { safeFolderName } from '../nextcloud/nextcloud-api';
import { ownModules } from '../core/interchange/export/export.service';
import { ownEmbeddedQuizzes } from '../topics/embedded-quizzes';
import { buildZlm, buildModuleZlm } from '../github-backup/zlm-export';
import { inspectApp } from '../html-apps/html-app-check';
import { docChanged } from '../core/events/doc-changes';
import { FileRecord, SICHERUNG, SAVED, TOPIC_META, WantedFile, syncSicherung, uniqueNames } from './sicherung';
import { inkStandOf, inlineMedia, readZlmBuffer } from './zlm-read';

const ZLM_TYPE = 'application/vnd.lm-editor.zlm+zip';
const DOC_TYPES = new Set(['document']);
const README = `LearningModules – Sicherung

Dieser Ordner enthält deine selbst verfassten Inhalte im Aufbau deines
Notizbuchs: je Book, Bereich und Abschnitt ein Ordner, je Lernthema ein Ordner.

- Jedes Dokument, Quiz und jede HTML-App liegt als .zlm darin. Eine .zlm öffnet
  der lm-editor (auch offline) und LearningModules (📂 Datei öffnen).
- Anhänge liegen als Originaldateien daneben.
- _lernthema.json hält Titel, Reihenfolge und Kennungen des Lernthemas.
- Bearbeitest du eine .zlm und speicherst sie hier, meldet LearningModules sie als
  „in der Nextcloud geändert“. Du übernimmst sie im Notizbuch – bis dahin
  überschreibt die App sie nicht.
- Was in der App gelöscht oder ersetzt wurde, liegt 180 Tage unter _Gesichert.
- Die Dateien enthalten Lösungen – den Ordner nicht öffentlich teilen.
`;

const sha = (v: unknown) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const stamp = (d: any) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : 0);
const twoDigits = (i: number) => String(i + 1).padStart(2, '0');

/**
 * Sicherung in die Nextcloud im Aufbau des Notizbuchs (sicherung.ts). Läuft
 * über den Schalter „💾 Backup deiner Inhalte“ (NextcloudBackupService: täglich
 * zur gewählten Stunde und auf Knopfdruck), nur mit eigener Freigabe.
 */
@Injectable()
export class SicherungService implements OnModuleInit {
  private readonly logger = new Logger('Sicherung');

  constructor(
    @InjectRepository(NextcloudLink) private readonly linkRepo: Repository<NextcloudLink>,
    @InjectRepository(NotebookNode) private readonly nodeRepo: Repository<NotebookNode>,
    @InjectRepository(NotebookPlacement) private readonly placeRepo: Repository<NotebookPlacement>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(DocumentInk) private readonly inkRepo: Repository<DocumentInk>,
    @InjectRepository(HtmlAppFile) private readonly appFileRepo: Repository<HtmlAppFile>,
    private readonly nextcloud: NextcloudService,
    private readonly backup: NextcloudBackupService,
  ) {}

  onModuleInit() {
    // Das tägliche Backup schreibt ab jetzt die Sicherung (statt je Lernthema einer JSON-Datei).
    this.backup.setRunner((userId) => this.run(userId));
  }

  // ---- Was gesichert wird ----

  private local() {
    return (url: string) => this.nextcloud.readImageByUrl(url);
  }

  /** Alle Dateien der Sicherung einer Lehrkraft: Ordner wie im Notizbuch, je Lernthema Module, Anhänge, _lernthema.json. */
  async collect(userId: string): Promise<WantedFile[]> {
    const [nodes, places, topics] = await Promise.all([
      this.nodeRepo.find({ where: { ownerId: userId } }),
      this.placeRepo.find({ where: { ownerId: userId } }),
      this.topicRepo.find({ where: { ownerId: userId, classId: IsNull() }, relations: ['modules'] }),
    ]);
    const own = topics.map((t) => ({ t, mods: ownModules(t.modules || [], userId) })).filter((x) => x.mods.length);
    const placeOf = new Map(places.map((p) => [p.topicId, p]));
    // Ordnernamen: Geschwister (Unterordner und Lernthemen) eindeutig, in der Reihenfolge des Notizbuchs.
    const folderName = new Map<string, string>();
    const parents = new Set<string | null>([null, ...nodes.map((n) => n.id)]);
    for (const parent of parents) {
      const kids = nodes.filter((n) => (n.parentId ?? null) === parent).sort((a, b) => a.orderIndex - b.orderIndex);
      const inHere = parent === null ? [] : own.filter((x) => placeOf.get(x.t.id)?.nodeId === parent).sort((a, b) => (placeOf.get(a.t.id)?.orderIndex ?? 0) - (placeOf.get(b.t.id)?.orderIndex ?? 0));
      const items: Array<{ id: string; title: string }> = [...kids.map((n) => ({ id: n.id, title: n.title })), ...inHere.map((x) => ({ id: `t:${x.t.id}`, title: x.t.title }))];
      if (parent === null) items.push({ id: 'unsorted', title: 'Unsortiert' });
      const names = uniqueNames(items, (i) => safeFolderName(i.title, 'Ohne Titel'));
      for (const [i, name] of names) folderName.set(i.id, name);
    }
    const unsorted = own.filter((x) => !placeOf.get(x.t.id)?.nodeId || !nodes.some((n) => n.id === placeOf.get(x.t.id)!.nodeId));
    const unsortedNames = uniqueNames(unsorted, (x) => safeFolderName(x.t.title, 'Ohne Titel'));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pathOfNode = (id: string): string[] => {
      const chain: string[] = [];
      const seen = new Set<string>();
      for (let n = byId.get(id); n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) { seen.add(n.id); chain.unshift(folderName.get(n.id)!); }
      return chain;
    };

    const out: WantedFile[] = [{
      key: 'readme', path: ['LIESMICH.txt'], hash: sha(README), contentType: 'text/plain; charset=utf-8', editable: false,
      data: async () => Buffer.from(README, 'utf-8'), title: 'LIESMICH.txt',
    }];
    for (const { t, mods } of own) {
      const nodeId = placeOf.get(t.id)?.nodeId;
      const folder = nodeId && byId.has(nodeId)
        ? [...pathOfNode(nodeId), folderName.get(`t:${t.id}`)!]
        : [folderName.get('unsorted')!, unsortedNames.get(unsorted.find((x) => x.t.id === t.id)!)!];
      const roots = mods.filter((m) => !m.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
      const meta: any[] = [];
      for (const [i, m] of roots.entries()) {
        const base = `${twoDigits(i)} ${safeFolderName(m.title || 'Modul', 'Modul')}`;
        const kids = mods.filter((k) => k.parentId === m.id);
        if (m.type === 'attachment') {
          const files = (Array.isArray((m.content as any)?.files) ? (m.content as any).files : []).filter((f: any) => f?.url);
          const names = uniqueNames(files, (f: any) => `${base} – ${safeFolderName(String(f.name || 'Datei').replace(/\.[^.]+$/, ''), 'Datei')}`);
          const entries: string[] = [];
          for (const f of files) {
            const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(String(f.name || '')) || [])[1];
            const name = `${names.get(f)}${ext ? `.${ext}` : ''}`;
            entries.push(name);
            out.push({
              key: `att:${m.id}:${sha(f.url).slice(0, 12)}`, path: [...folder, name], hash: sha([f.url, f.size || 0]), contentType: 'application/octet-stream', editable: false,
              moduleId: m.id, topicId: t.id, title: `${m.title} – ${f.name || 'Datei'}`,
              data: async () => {
                const got = await this.nextcloud.readImageByUrl(String(f.url));
                if (!got) throw new Error(`Anhang „${f.name || 'Datei'}“ ist nicht lesbar.`);
                return got.data;
              },
            });
          }
          meta.push({ id: m.id, type: m.type, title: m.title, files: entries, selected: m.moduleSelected !== false });
          continue;
        }
        const file = `${base}.zlm`;
        meta.push({ id: m.id, type: m.type, title: m.title, file, selected: m.moduleSelected !== false });
        const key = `mod:${m.id}`;
        if (DOC_TYPES.has(m.type)) {
          const extra = ownModules(await ownEmbeddedQuizzes({ modules: this.moduleRepo, topics: this.topicRepo }, [m], userId, new Set(mods.map((x) => x.id))), userId);
          const ink = await this.inkRepo.findOne({ where: { id: m.id, ownerId: userId } });
          const all = [...mods, ...extra];
          out.push({
            key, path: [...folder, file], contentType: ZLM_TYPE, editable: true, moduleId: m.id, topicId: t.id, title: m.title,
            hash: sha({ v: 1, m: [m.title, m.content, stamp(m.updatedAt)], q: all.map((x) => [x.id, x.title, x.content, x.parentId]), ink: stamp(ink?.updatedAt) }),
            data: async () => buildZlm({ doc: m, modules: all, ink }, { local: this.local() }),
          });
        } else {
          out.push({
            key, path: [...folder, file], contentType: ZLM_TYPE, editable: true, moduleId: m.id, topicId: t.id, title: m.title,
            hash: sha({ v: 1, m: [m.type, m.title, m.description, m.content], k: kids.map((x) => [x.id, x.type, x.title, x.content]) }),
            data: async () => buildModuleZlm({ module: m as any, children: kids as any, appHtml: await this.appHtml(m) }, { local: this.local() }),
          });
        }
      }
      const json = JSON.stringify({
        format: 'lm-lernthema', version: 1, id: t.id, title: t.title, description: t.description || '', tagIds: t.tagIds || [], modules: meta,
      }, null, 1) + '\n';
      out.push({
        key: `topic:${t.id}`, path: [...folder, TOPIC_META], hash: sha(json), contentType: 'application/json', editable: false, topicId: t.id, title: t.title,
        data: async () => Buffer.from(json, 'utf-8'),
      });
    }
    return out;
  }

  private async appHtml(m: LearningModule) {
    const fileId = (m.content as any)?.app?.fileId;
    if (m.type !== 'htmlApp' || !fileId) return null;
    return (await this.appFileRepo.findOne({ where: { id: String(fileId) }, select: ['id', 'html'] }))?.html ?? null;
  }

  // ---- Lauf ----

  /** Sicherung schreiben (vom täglichen Backup und „Jetzt sichern“). */
  async run(userId: string) {
    const { l, nc } = await this.nextcloud.connection(userId);
    const wanted = await this.collect(userId);
    const res = await syncSicherung(nc as any, [SICHERUNG], wanted, (l.sicherungFiles || {}) as Record<string, FileRecord>);
    await this.linkRepo.update({ id: l.id }, { sicherungFiles: res.records as any });
    const r = res.report;
    if (r.errors.length) this.logger.warn(`Sicherung ${userId}: ${r.errors.length} Fehler, z. B. ${r.errors[0].title}: ${r.errors[0].error}`);
    return { written: r.written, moved: r.moved, saved: r.saved, unchanged: r.unchanged, changed: r.changed, errors: r.errors.length, errorList: r.errors.slice(0, 20) };
  }

  /** In der Nextcloud geänderte .zlm, die auf Übernehmen oder Verwerfen warten. */
  async changed(user: any) {
    const l = await this.linkRepo.findOne({ where: { userId: user.userId } });
    const recs = Object.values((l?.sicherungFiles || {}) as Record<string, FileRecord>).filter((r) => r.state === 'changed');
    return { files: recs.map((r) => ({ key: r.key, title: r.title || '', path: [SICHERUNG, ...r.path].join('/'), moduleId: r.moduleId || null, topicId: r.topicId || null, changedAt: r.changedAt || null })) };
  }

  private async changedRecord(userId: string, key: string) {
    const l = await this.linkRepo.findOne({ where: { userId } });
    const recs = (l?.sicherungFiles || {}) as Record<string, FileRecord>;
    const rec = recs[String(key || '')];
    if (!l || !rec || rec.state !== 'changed') throw new NotFoundException('Diese Datei wartet nicht (mehr) auf eine Entscheidung.');
    return { l, recs, rec };
  }

  /** Verwerfen: Die Datei in der Nextcloud wandert nach _Gesichert, die App schreibt ihre Fassung. */
  async discard(user: any, key: string) {
    const { l, recs, rec } = await this.changedRecord(user.userId, key);
    rec.state = 'discard';
    await this.linkRepo.update({ id: l.id }, { sicherungFiles: recs as any });
    return this.run(user.userId);
  }

  /** Wartende Datei samt Inhalt aus der Nextcloud und dem Modul der App. */
  private async loadChanged(userId: string, key: string) {
    const { l, recs, rec } = await this.changedRecord(userId, key);
    const { nc } = await this.nextcloud.connection(userId);
    const file = await nc.get([SICHERUNG, ...rec.path]);
    if (!file) throw new NotFoundException('Die Datei ist in der Nextcloud nicht mehr da.');
    let z: ReturnType<typeof readZlmBuffer>;
    try { z = readZlmBuffer(file.data); } catch (e: any) { throw new BadRequestException(e?.message || 'Die Datei ist keine gültige .zlm.'); }
    const mod = rec.moduleId ? await this.moduleRepo.findOne({ where: { id: rec.moduleId } }) : null;
    const topic = mod ? await this.topicRepo.findOne({ where: { id: mod.topicId }, relations: ['modules'] }) : null;
    if (!mod || !topic || topic.ownerId !== userId || !ownModules(topic.modules || [], userId).some((m) => m.id === mod.id)) {
      throw new NotFoundException('Das Modul gibt es in der App nicht mehr.');
    }
    return { l, recs, rec, nc, z, mod, topic };
  }

  /**
   * Vergleich vor dem Entscheiden: Stand der App und Fassung aus der Nextcloud.
   * Dokument: beide Specs (Bilder als data:); dazu die Quizze bzw. Untermodule,
   * die sich unterscheiden oder neu sind; ob eine Beschriftung der Lehrkraft dabei ist.
   */
  async compare(user: any, key: string) {
    const userId = user.userId;
    const { rec, z, mod } = await this.loadChanged(userId, key);
    const isDoc = DOC_TYPES.has(mod.type);
    const fileModules = Object.values(z.modules).filter((m: any) => m && m.id && (isDoc || m.id !== mod.id));
    const ids = fileModules.map((m: any) => String(m.id));
    const found = ids.length ? await this.moduleRepo.find({ where: { id: In(ids) } }) : [];
    const byId = new Map(found.map((m) => [m.id, m]));
    const modules: { id: string; title: string; change: 'neu' | 'geändert' }[] = [];
    for (const f of fileModules as any[]) {
      const m = byId.get(String(f.id));
      if (!m) { modules.push({ id: String(f.id), title: String(f.title || ''), change: 'neu' }); continue; }
      if (JSON.stringify([m.title, m.content]) !== JSON.stringify([String(f.title ?? m.title), f.content ?? m.content])) {
        modules.push({ id: m.id, title: String(f.title || m.title || ''), change: 'geändert' });
      }
    }
    const main: any = !isDoc ? z.modules[z.manifest.module!] : null;
    return {
      key: rec.key,
      kind: isDoc ? 'document' : 'module',
      type: mod.type,
      app: { title: mod.title, spec: isDoc ? (mod.content as any)?.spec || { content: [] } : null, module: isDoc ? null : { title: mod.title, description: mod.description || '', content: mod.content } },
      cloud: {
        title: String((isDoc ? z.manifest.title : main?.title) || mod.title),
        spec: isDoc ? inlineMedia(z.spec, z.media) : null,
        module: isDoc ? null : { title: String(main?.title || ''), description: main?.description || '', content: main?.content ?? null },
      },
      modules,
      ink: !!inkStandOf(z.layers.teacher || null),
    };
  }

  /**
   * Übernehmen: Die geänderte .zlm wird zum Stand in der App. Vorher legt die
   * App ihren bisherigen Stand unter _Gesichert/<Datum>/ ab („… (App).zlm“).
   */
  async takeOver(user: any, key: string) {
    const userId = user.userId;
    const { l, recs, rec, nc, z, mod, topic } = await this.loadChanged(userId, key);
    // Bisherigen Stand der App sichern.
    const before = (await this.collect(userId)).find((w) => w.key === rec.key);
    if (before) {
      const today = new Date().toISOString().slice(0, 10);
      const name = rec.path[rec.path.length - 1].replace(/\.zlm$/, ' (App).zlm');
      const dest = [SICHERUNG, SAVED, today, ...rec.path.slice(0, -1)];
      await nc.ensureFolder(dest);
      await nc.put([...dest, name], await before.data(), ZLM_TYPE);
    }
    const summary = DOC_TYPES.has(mod.type) ? await this.applyDocument(userId, mod, topic, z) : await this.applyModule(userId, mod, topic, z);
    // Ab jetzt ist die Datei wieder „unsere“; der nächste Lauf schreibt sie im Format der App neu.
    const st = await nc.stat([SICHERUNG, ...rec.path]);
    Object.assign(rec, { state: 'ok', etag: st?.etag || rec.etag, hash: '' });
    delete rec.changedAt;
    await this.linkRepo.update({ id: l.id }, { sicherungFiles: recs as any });
    docChanged(userId);
    return { success: true, title: mod.title, ...summary };
  }

  private kindMismatch(mod: LearningModule, z: ReturnType<typeof readZlmBuffer>) {
    const isModule = z.manifest.kind === 'module';
    if (DOC_TYPES.has(mod.type) === isModule) throw new BadRequestException(isModule ? 'Die Datei enthält ein Quiz, in der App ist es ein Dokument.' : 'Die Datei enthält ein Dokument, in der App ist es ein Quiz.');
  }

  /** Dokument: Spec (Bilder wieder eingebettet), eigene eingebettete Quizze, Beschriftung der Lehrkraft. */
  private async applyDocument(userId: string, mod: LearningModule, topic: LearningTopic, z: ReturnType<typeof readZlmBuffer>) {
    this.kindMismatch(mod, z);
    mod.content = { ...(mod.content as any), spec: inlineMedia(z.spec, z.media) } as any;
    if (z.manifest.title) mod.title = String(z.manifest.title).slice(0, 300);
    await this.moduleRepo.save(mod);
    const quizzes = await this.updateOwnModules(userId, Object.values(z.modules));
    const stand = inkStandOf(z.layers.teacher || null);
    if (stand) {
      const ink = (await this.inkRepo.findOne({ where: { id: mod.id, ownerId: userId } })) || this.inkRepo.create({ id: mod.id, ownerId: userId, visibility: 'teacher' } as any);
      (ink as any).data = stand;
      await this.inkRepo.save(ink as any);
    }
    return { quizzes, ink: !!stand };
  }

  /** Quiz oder HTML-App: Titel, Inhalt, Untermodule; eine geänderte App-Datei wird geprüft und abgelegt. */
  private async applyModule(userId: string, mod: LearningModule, topic: LearningTopic, z: ReturnType<typeof readZlmBuffer>) {
    this.kindMismatch(mod, z);
    const main = z.modules[z.manifest.module!];
    if (main.type && main.type !== mod.type) throw new BadRequestException(`Die Datei enthält ein Modul der Art „${main.type}“, in der App ist es „${mod.type}“.`);
    mod.title = String(main.title || mod.title).slice(0, 300);
    mod.description = main.description ?? mod.description;
    mod.content = await this.appContent(userId, main.content, z) as any;
    await this.moduleRepo.save(mod);
    const kids = Object.values(z.modules).filter((m: any) => m && m.id !== mod.id);
    const updated = await this.updateOwnModules(userId, kids);
    // Neue Untermodule (draußen ergänzt) kommen dazu, wenn ihre Kennung frei ist.
    let added = 0;
    for (const k of kids as any[]) {
      if (!k?.id || String(k.parentId || '') !== mod.id || (await this.moduleRepo.findOne({ where: { id: String(k.id) } }))) continue;
      await this.moduleRepo.save(this.moduleRepo.create({
        id: String(k.id), topicId: topic.id, parentId: mod.id, type: String(k.type), title: String(k.title || ''), description: k.description || '',
        content: k.content || {}, creatorId: userId, orderIndex: 0, moduleSelected: true,
      } as any));
      added++;
    }
    return { quizzes: updated + added };
  }

  /** Inhalt eines Moduls aus der Datei; bei einer HTML-App die Datei aus media/ prüfen und ablegen. */
  private async appContent(userId: string, content: any, z: ReturnType<typeof readZlmBuffer>) {
    const ref = content?.app?.file;
    if (typeof ref !== 'string' || !ref.startsWith('media/')) return content || {};
    const bytes = z.media[ref.slice(6)];
    if (!bytes) throw new BadRequestException('Die Datei der HTML-App fehlt in der .zlm.');
    const html = bytes.toString('utf-8');
    const { manifest, errors } = inspectApp(html);
    if (errors.length || !manifest) throw new BadRequestException(`Die HTML-App hält die Regeln nicht ein: ${errors.slice(0, 2).join('; ')}`);
    const hash = crypto.createHash('sha256').update(html).digest('hex');
    const known = await this.appFileRepo.findOne({ where: { ownerId: userId, sha: hash }, select: ['id', 'manifest', 'size'] });
    const file = known || (await this.appFileRepo.save(this.appFileRepo.create({ id: crypto.randomUUID(), ownerId: userId, sha: hash, size: Buffer.byteLength(html), html, manifest } as any) as any));
    const { file: _f, ...app } = content.app;
    return { ...content, app: { ...app, fileId: file.id, manifest: file.manifest ?? null, size: file.size } };
  }

  /** Module aus der Datei, die es in der App gibt und die der Lehrkraft gehören: Titel und Inhalt übernehmen. */
  private async updateOwnModules(userId: string, list: any[]) {
    const ids = list.map((m) => String(m?.id || '')).filter(Boolean);
    if (!ids.length) return 0;
    const found = await this.moduleRepo.find({ where: { id: In(ids) } });
    const topics = new Map((await this.topicRepo.find({ where: { id: In([...new Set(found.map((m) => m.topicId))]) } })).map((t) => [t.id, t]));
    let n = 0;
    for (const m of found) {
      if (topics.get(m.topicId)?.ownerId !== userId || DOC_TYPES.has(m.type)) continue;
      const src = list.find((x) => String(x.id) === m.id);
      if (!src || (src.type && src.type !== m.type)) continue;
      const next = { title: String(src.title ?? m.title).slice(0, 300), content: src.content ?? m.content };
      if (JSON.stringify([m.title, m.content]) === JSON.stringify([next.title, next.content])) continue;
      await this.moduleRepo.update({ id: m.id }, next as any);
      n++;
    }
    return n;
  }

  // ---- Wiederherstellen ----

  /** Ordner der Sicherung (ohne _Gesichert): `{ name, path, topic, children }` – Lernthemen erkennt man an _lernthema.json. */
  async tree(user: any) {
    const { nc } = await this.nextcloud.connection(user.userId);
    let budget = 3000;
    const walk = async (path: string[], depth: number): Promise<any[]> => {
      if (depth > 12 || budget <= 0) return [];
      const entries = await nc.list([SICHERUNG, ...path]).catch(() => []);
      budget -= entries.length;
      const out: any[] = [];
      for (const e of entries.filter((x: any) => x.isFolder && x.name !== SAVED).sort((a: any, b: any) => a.name.localeCompare(b.name, 'de'))) {
        const sub = [...path, e.name];
        const inner = await nc.list([SICHERUNG, ...sub]).catch(() => []);
        const topic = inner.some((x: any) => !x.isFolder && x.name === TOPIC_META);
        out.push({ name: e.name, path: sub, topic, files: topic ? inner.filter((x: any) => !x.isFolder && x.name !== TOPIC_META).length : 0, children: topic ? [] : await walk(sub, depth + 1) });
      }
      return out;
    };
    return { folders: await walk([], 0) };
  }

  /**
   * Einen Ordner der Sicherung als neues Book „Aus der Nextcloud (Datum)“
   * wiederherstellen: Unterordner werden Bereiche, Ordner mit _lernthema.json
   * Lernthemen, .zlm-Dateien Module (neue Kennungen, Quiz-Verweise in
   * Dokumenten angepasst), Anhänge werden neu hochgeladen. Vorhandenes bleibt unberührt.
   */
  async restore(user: any, rawPath: unknown) {
    const userId = user.userId;
    const path = Array.isArray(rawPath) ? rawPath.map(String) : [];
    if (path.some((p) => !p || p === '..' || p === '.' || p.includes('/') || p.includes('\\')) || path[0] === SAVED) throw new BadRequestException('Ungültiger Ordner.');
    const { nc } = await this.nextcloud.connection(userId);
    const st = await nc.stat([SICHERUNG, ...path]);
    if (!st?.isFolder) throw new NotFoundException('Ordner nicht gefunden.');
    const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const books = await this.nodeRepo.find({ where: { ownerId: userId, parentId: IsNull() } });
    const book = await this.nodeRepo.save(this.nodeRepo.create({
      id: crypto.randomUUID(), ownerId: userId, kind: 'book', title: `Aus der Nextcloud (${today})`, parentId: null, orderIndex: books.length, tagIds: [],
    } as any)) as unknown as NotebookNode;
    const ctx = { userId, nc, idMap: new Map<string, string>(), docs: [] as Array<{ z: ZlmContent; topicId: string; order: number; selected: boolean; newId: string }>, topics: 0, modules: 0, errors: [] as string[] };
    const isTopic = async (p: string[]) => !!(await nc.stat([SICHERUNG, ...p, TOPIC_META]));
    if (await isTopic(path)) await this.restoreTopic(ctx, path, book.id, 0);
    else await this.restoreFolder(ctx, path, book.id, 1, isTopic);
    // Dokumente zuletzt: Ihre Quiz-Verweise zeigen dann auf die neuen Module.
    for (const d of ctx.docs) await this.restoreDocument(ctx, d).catch((e) => ctx.errors.push(`${d.z.manifest.title}: ${e?.message || e}`));
    docChanged(userId);
    return { bookId: book.id, title: book.title, topics: ctx.topics, modules: ctx.modules, errors: ctx.errors.slice(0, 30) };
  }

  private async restoreFolder(ctx: any, path: string[], nodeId: string, depth: number, isTopic: (p: string[]) => Promise<boolean>) {
    const entries = (await ctx.nc.list([SICHERUNG, ...path]).catch(() => [])).filter((e: any) => e.isFolder && e.name !== SAVED).sort((a: any, b: any) => a.name.localeCompare(b.name, 'de'));
    let order = 0;
    for (const e of entries) {
      const sub = [...path, e.name];
      if (await isTopic(sub)) { await this.restoreTopic(ctx, sub, nodeId, order++); continue; }
      // Tiefer als das Notizbuch erlaubt: Inhalt kommt in den letzten möglichen Bereich.
      let target = nodeId;
      if (depth < 7) {
        const area = await this.nodeRepo.save(this.nodeRepo.create({ id: crypto.randomUUID(), ownerId: ctx.userId, kind: 'area', title: e.name, parentId: nodeId, orderIndex: order++, tagIds: [] } as any)) as unknown as NotebookNode;
        target = area.id;
      }
      await this.restoreFolder(ctx, sub, target, depth + 1, isTopic);
    }
  }

  private async restoreTopic(ctx: any, path: string[], nodeId: string, order: number) {
    const metaFile = await ctx.nc.get([SICHERUNG, ...path, TOPIC_META]);
    let meta: any = {};
    try { meta = JSON.parse(metaFile?.data.toString('utf-8') || '{}'); } catch { ctx.errors.push(`${path.join('/')}: _lernthema.json ist kein gültiges JSON.`); }
    const topic = await this.topicRepo.save(this.topicRepo.create({
      id: crypto.randomUUID(), ownerId: ctx.userId, title: String(meta.title || path[path.length - 1]).slice(0, 300), description: String(meta.description || ''), selected: false,
    } as any)) as unknown as LearningTopic;
    await this.placeRepo.save(this.placeRepo.create({ id: crypto.randomUUID(), ownerId: ctx.userId, topicId: topic.id, nodeId, orderIndex: order, inheritedTagIds: [] } as any));
    ctx.topics++;
    const names = new Set((await ctx.nc.list([SICHERUNG, ...path]).catch(() => [])).filter((e: any) => !e.isFolder).map((e: any) => e.name));
    const listed: any[] = Array.isArray(meta.modules) ? meta.modules : [];
    const known = new Set(listed.flatMap((m) => [m.file, ...(m.files || [])]).filter(Boolean));
    // Dateien, die _lernthema.json nicht kennt (z. B. draußen dazugelegt), kommen hinten dazu.
    for (const n of [...names].sort()) if (/\.zlm$/i.test(n as string) && !known.has(n)) listed.push({ file: n, selected: true });
    for (const [i, m] of listed.entries()) {
      try {
        if (m.type === 'attachment' || Array.isArray(m.files)) await this.restoreAttachment(ctx, path, topic, m, i);
        else if (m.file && names.has(m.file)) await this.restoreZlm(ctx, path, topic, m, i);
      } catch (e: any) {
        ctx.errors.push(`${topic.title} / ${m.title || m.file}: ${e?.message || e}`);
      }
    }
  }

  private async restoreAttachment(ctx: any, path: string[], topic: LearningTopic, m: any, order: number) {
    const files: any[] = [];
    for (const name of m.files || []) {
      const got = await ctx.nc.get([SICHERUNG, ...path, name]);
      if (!got) continue;
      // „03 Material – Tabelle.pdf“ → „Tabelle.pdf“
      const original = String(name).replace(/^\d+ .*? – /, '');
      const res: any = await this.nextcloud.uploadAttachment({ userId: ctx.userId }, topic.id, { originalname: Buffer.from(original, 'utf-8').toString('latin1'), mimetype: got.type, buffer: got.data, size: got.data.length });
      files.push({ name: original, url: res.url, size: res.size, type: res.type });
    }
    await this.saveModule(ctx, topic.id, { type: 'attachment', title: m.title || 'Anhang', content: { files } }, order, m.selected !== false);
  }

  private async restoreZlm(ctx: any, path: string[], topic: LearningTopic, m: any, order: number) {
    const got = await ctx.nc.get([SICHERUNG, ...path, m.file]);
    if (!got) return;
    const z = readZlmBuffer(got.data);
    if (z.manifest.kind !== 'module') {
      ctx.docs.push({ z, topicId: topic.id, order, selected: m.selected !== false, newId: crypto.randomUUID() });
      return;
    }
    const main = z.modules[z.manifest.module!];
    const mainId = crypto.randomUUID();
    ctx.idMap.set(String(main.id), mainId);
    await this.saveModule(ctx, topic.id, { ...main, id: mainId, content: await this.appContent(ctx.userId, main.content, z) }, order, m.selected !== false);
    for (const k of Object.values(z.modules) as any[]) {
      if (!k?.id || k.id === main.id) continue;
      const id = crypto.randomUUID();
      ctx.idMap.set(String(k.id), id);
      await this.saveModule(ctx, topic.id, { ...k, id, parentId: ctx.idMap.get(String(k.parentId)) || mainId }, 0, true);
    }
  }

  private async restoreDocument(ctx: any, d: { z: ZlmContent; topicId: string; order: number; selected: boolean; newId: string }) {
    const { z } = d;
    // Eingebettete Quizze, die nicht schon als eigene .zlm kamen: als Module in dieses Lernthema.
    for (const q of Object.values(z.modules) as any[]) {
      if (!q?.id || ctx.idMap.has(String(q.id))) continue;
      ctx.idMap.set(String(q.id), crypto.randomUUID());
    }
    for (const q of Object.values(z.modules) as any[]) {
      if (!q?.id || (await this.moduleRepo.findOne({ where: { id: ctx.idMap.get(String(q.id)) } }))) continue;
      await this.saveModule(ctx, d.topicId, { ...q, id: ctx.idMap.get(String(q.id)), parentId: q.parentId ? ctx.idMap.get(String(q.parentId)) || null : null, content: await this.appContent(ctx.userId, q.content, z) }, 999, true);
    }
    const relink = (v: any): any => {
      if (Array.isArray(v)) return v.map(relink);
      if (!v || typeof v !== 'object') return v;
      const o: any = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relink(x)]));
      if (o.type === 'quiz' && ctx.idMap.has(String(o.module))) o.module = ctx.idMap.get(String(o.module));
      return o;
    };
    const kind = z.manifest.kind === 'exam' ? 'klassenarbeit' : z.manifest.kind === 'text' ? 'text' : 'arbeitsblatt';
    await this.saveModule(ctx, d.topicId, { id: d.newId, type: 'document', title: z.manifest.title || 'Dokument', content: { kind, spec: relink(inlineMedia(z.spec, z.media)) } }, d.order, d.selected);
    const stand = inkStandOf(z.layers.teacher || null);
    if (stand) await this.inkRepo.save(this.inkRepo.create({ id: d.newId, ownerId: ctx.userId, visibility: 'teacher', data: stand } as any));
  }

  private async saveModule(ctx: any, topicId: string, m: any, order: number, selected: boolean) {
    await this.moduleRepo.save(this.moduleRepo.create({
      id: m.id || crypto.randomUUID(), topicId, parentId: m.parentId || null, type: String(m.type), title: String(m.title || '').slice(0, 300), description: m.description || '',
      content: m.content || {}, creatorId: ctx.userId, orderIndex: order, moduleSelected: selected,
    } as any));
    ctx.modules++;
  }
}
