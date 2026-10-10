import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ContentHandover } from '../core/entities/content-handover.entity';
import { User } from '../core/entities/user.entity';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { NotebookNode } from '../core/entities/notebook-node.entity';
import { NotebookPlacement } from '../core/entities/notebook-placement.entity';
import { ShopOffer } from '../core/entities/shop-offer.entity';
import { UseGrant } from '../core/entities/use-grant.entity';
import { Tag } from '../core/entities/tag.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { adjustOffer, bookTitle, planTags, remap } from './handover-rules';

/**
 * Alle Inhalte einer Lehrkraft an eine andere übergeben (docs/uebergabe.md).
 *
 * Es wandern: Lernthemen samt Modulen, die Notebook-Struktur, die dabei
 * verwendeten Tags (als Kopie beim Empfänger) und die Angebote im Shop –
 * wer etwas per Use nutzt, behält es. Beim Absender bleiben Ergebnisse,
 * Klassen und Links: Sie hängen an Schülerdaten und am Unterricht.
 *
 * Creator bleibt der Absender, außer er gibt ausdrücklich auch die
 * Urheberschaft ab (`withCreator`).
 */
@Injectable()
export class ContentHandoverService {
  constructor(
    @InjectRepository(ContentHandover) private readonly repo: Repository<ContentHandover>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(LearningTopic) private readonly topicRepo: Repository<LearningTopic>,
    private readonly dataSource: DataSource,
  ) {}

  private label(u: User | null | undefined) {
    return u ? u.displayName || u.email : 'Unbekannt';
  }

  /** Was ich angefragt habe und was an mich angefragt ist. */
  async mine(user: any) {
    const rows = await this.repo.find({ where: [{ fromUserId: user.userId }, { toUserId: user.userId }], order: { createdAt: 'DESC' } });
    const ids = [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId]))];
    const users = ids.length ? await this.userRepo.find({ where: { id: In(ids) } }) : [];
    const name = (id: string) => this.label(users.find((u) => u.id === id));
    const email = (id: string) => users.find((u) => u.id === id)?.email || '';
    const view = (r: ContentHandover) => ({
      id: r.id, status: r.status, withCreator: r.withCreator, note: r.note, summary: r.summary,
      createdAt: r.createdAt, decidedAt: r.decidedAt,
      from: { name: name(r.fromUserId), email: email(r.fromUserId) },
      to: { name: name(r.toUserId), email: email(r.toUserId) },
    });
    const ownTopics = await this.topicRepo.count({ where: { ownerId: user.userId } });
    return {
      ownTopics,
      outgoing: rows.filter((r) => r.fromUserId === user.userId).slice(0, 20).map(view),
      incoming: await Promise.all(rows.filter((r) => r.toUserId === user.userId && r.status === 'pending').map(async (r) => ({
        ...view(r),
        topicCount: await this.topicRepo.count({ where: { ownerId: r.fromUserId } }),
      }))),
    };
  }

  /** Anfrage: `{ email, withCreator, note }`. */
  async request(user: any, body: any) {
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new BadRequestException('Bitte die vollständige E-Mail-Adresse der Lehrkraft, die übernimmt.');
    const to = (await this.userRepo.find()).find((u) => u.email.toLowerCase() === email);
    if (!to || to.active === false || (to.role !== 'teacher' && to.role !== 'admin')) {
      throw new NotFoundException('Keine aktive Lehrkraft mit dieser Adresse gefunden. Für die eigene neue Adresse: „✉️ E-Mail ändern“.');
    }
    if (to.id === user.userId) throw new BadRequestException('Das bist du selbst.');
    if (!(await this.topicRepo.count({ where: { ownerId: user.userId } }))) throw new BadRequestException('Du hast keine eigenen Lernthemen, die sich übergeben ließen.');
    if (await this.repo.findOne({ where: { fromUserId: user.userId, status: 'pending' } })) {
      throw new BadRequestException('Es läuft schon eine Übergabe – bitte erst zurückziehen.');
    }
    const row = await this.repo.save(this.repo.create({
      id: crypto.randomUUID(),
      fromUserId: user.userId,
      toUserId: to.id,
      withCreator: !!body?.withCreator,
      note: String(body?.note || '').trim().slice(0, 500) || null,
      status: 'pending',
    }));
    return { success: true, id: row.id, to: this.label(to) };
  }

  private async pending(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || row.status !== 'pending') throw new NotFoundException('Diese Übergabe gibt es nicht (mehr).');
    return row;
  }

  async withdraw(id: string, user: any) {
    const row = await this.pending(id);
    if (row.fromUserId !== user.userId) throw new ForbiddenException('Das ist nicht deine Übergabe.');
    Object.assign(row, { status: 'withdrawn', decidedAt: new Date() });
    await this.repo.save(row);
    return { success: true };
  }

  async decline(id: string, user: any) {
    const row = await this.pending(id);
    if (row.toUserId !== user.userId) throw new ForbiddenException('Diese Übergabe ist nicht an dich.');
    Object.assign(row, { status: 'declined', decidedAt: new Date() });
    await this.repo.save(row);
    return { success: true };
  }

  async accept(id: string, user: any) {
    const row = await this.pending(id);
    if (row.toUserId !== user.userId) throw new ForbiddenException('Diese Übergabe ist nicht an dich.');
    const [from, to] = await Promise.all([
      this.userRepo.findOne({ where: { id: row.fromUserId } }),
      this.userRepo.findOne({ where: { id: row.toUserId } }),
    ]);
    if (!from || !to) throw new NotFoundException('Konto nicht gefunden.');
    const summary = await this.execute(from, to, row.withCreator);
    Object.assign(row, { status: 'accepted', decidedAt: new Date(), summary });
    await this.repo.save(row);
    return { success: true, summary };
  }

  /** Die eigentliche Übergabe, in einer Transaktion. */
  private async execute(from: User, to: User, withCreator: boolean) {
    const fromName = this.label(from);
    return this.dataSource.transaction(async (m) => {
      const topics = await m.getRepository(LearningTopic).find({ where: { ownerId: from.id } });
      const topicIds = topics.map((t) => t.id);
      const modules = topicIds.length ? await m.getRepository(LearningModule).find({ where: { topicId: In(topicIds) } }) : [];
      const nodes = await m.getRepository(NotebookNode).find({ where: { ownerId: from.id } });
      const places = await m.getRepository(NotebookPlacement).find({ where: { ownerId: from.id } });
      const offers = await m.getRepository(ShopOffer).find({ where: { sellerId: from.id } });

      // Tags: Was die übergebenen Inhalte tragen, bekommt der Empfänger –
      // ihr gleichnamiger Tag oder ein neuer. Die Tags des Absenders bleiben.
      const usedIds = new Set([
        ...topics.flatMap((t) => t.tagIds || []),
        ...modules.flatMap((x) => x.tagIds || []),
        ...nodes.flatMap((n) => n.tagIds || []),
        ...places.flatMap((p) => p.inheritedTagIds || []),
      ]);
      const ownTags = usedIds.size ? (await m.getRepository(Tag).find({ where: { id: In([...usedIds]), ownerId: from.id } })) : [];
      // Themengebiete, unter denen diese Tags hängen, kommen mit.
      const areaIds = [...new Set(ownTags.flatMap((t) => t.areaIds || []))].filter((id) => !usedIds.has(id));
      if (areaIds.length) ownTags.push(...(await m.getRepository(Tag).find({ where: { id: In(areaIds), ownerId: from.id } })));
      const theirTags = await m.getRepository(Tag).find({ where: { ownerId: to.id } });
      const plan = planTags(ownTags, theirTags, () => crypto.randomUUID());
      // Themengebiete zuerst anlegen, damit die übrigen Tags auf sie zeigen können.
      const created = plan.create.map(({ from: t, id }) => {
        const src = ownTags.find((x) => x.id === t.id)!;
        return m.getRepository(Tag).create({ id, name: src.name, ownerId: to.id, schoolId: null, color: src.color, isArea: src.isArea, areaIds: null, categoryIds: src.categoryIds });
      });
      if (created.length) await m.getRepository(Tag).save(created);
      for (const c of created) {
        const src = ownTags.find((x) => plan.map.get(x.id) === c.id)!;
        const areas = remap(src.areaIds, plan.map);
        if (areas?.length && !c.isArea) { c.areaIds = areas; await m.getRepository(Tag).save(c); }
      }

      // Lernthemen und Module.
      for (const t of topics) {
        t.ownerId = to.id;
        t.tagIds = remap(t.tagIds, plan.map);
        // Den alten Quick-Link-Schlüssel des Absenders entwerten.
        t.quickToken = null;
        // Abgleich mit dem Konto des Absenders auf einem anderen Server gilt nicht für den Empfänger.
        Object.assign(t, { syncSource: null, syncHash: null, syncedAt: null });
      }
      if (topics.length) await m.getRepository(LearningTopic).save(topics);
      let creators = 0;
      for (const x of modules) {
        x.tagIds = remap(x.tagIds, plan.map);
        if (withCreator && x.creatorId === from.id) { x.creatorId = to.id; creators++; }
      }
      for (let i = 0; i < modules.length; i += 200) await m.getRepository(LearningModule).save(modules.slice(i, i + 200));

      // Notebooks: Struktur wandert mit, Books tragen den Namen des Absenders.
      for (const n of nodes) {
        n.ownerId = to.id;
        n.tagIds = remap(n.tagIds, plan.map);
        if (n.kind === 'book' && !n.parentId) n.title = bookTitle(n.title, fromName);
      }
      if (nodes.length) await m.getRepository(NotebookNode).save(nodes);
      const moved = new Set(topicIds);
      // Plätze des Empfängers für diese Themen (etwa aus einem Use) weichen den mitgebrachten.
      if (topicIds.length) await m.getRepository(NotebookPlacement).delete({ ownerId: to.id, topicId: In(topicIds) });
      for (const p of places) {
        if (moved.has(p.topicId)) {
          p.ownerId = to.id;
          p.inheritedTagIds = remap(p.inheritedTagIds, plan.map);
        } else {
          // Was der Absender nur nutzt, bleibt bei ihm – in seinem „Unsortiert“.
          p.nodeId = null;
        }
      }
      if (places.length) await m.getRepository(NotebookPlacement).save(places);

      // Angebote: Wer etwas nutzt, behält es. Ohne Urheberschaft nur noch Use.
      const offerIds = offers.map((o) => o.id);
      for (const o of offers) Object.assign(o, adjustOffer(o, withCreator), { sellerId: to.id });
      if (offers.length) await m.getRepository(ShopOffer).save(offers);
      const grants = m.getRepository(UseGrant);
      // Rechte des Empfängers an den nun eigenen Inhalten entfallen.
      if (offerIds.length) await grants.delete({ userId: to.id, offerId: In(offerIds) });
      if (topicIds.length) await grants.delete({ userId: to.id, topicId: In(topicIds) });
      if (offerIds.length) await grants.update({ offerId: In(offerIds), creatorId: from.id }, { creatorId: to.id });

      // Quick-Links und Entwürfe des Absenders zu diesen Themen gibt es nicht mehr.
      if (topicIds.length) {
        await m.getRepository(TopicQuickLink).delete({ ownerId: from.id, topicId: In(topicIds) });
        await m.getRepository(ModuleDraft).delete({ userId: from.id, topicId: In(topicIds) });
      }

      return { topics: topics.length, modules: modules.filter((x) => !x.parentId).length, nodes: nodes.length, offers: offers.length, tags: created.length, creators };
    });
  }
}
