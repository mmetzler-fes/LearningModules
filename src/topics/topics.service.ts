import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LearningTopic } from '../core/entities/learning-topic.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { User } from '../core/entities/user.entity';
import { TopicQuickLink } from '../core/entities/topic-quick-link.entity';
import { TagsService } from '../tags/tags.service';
import { baseUrl, renderQr } from '../core/share/link-url';
import * as crypto from 'crypto';

@Injectable()
export class TopicsService {
  constructor(
    @InjectRepository(LearningTopic)
    private readonly topicRepo: Repository<LearningTopic>,
    @InjectRepository(LearningModule)
    private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TopicQuickLink)
    private readonly quickRepo: Repository<TopicQuickLink>,
    private readonly tagsService: TagsService,
  ) {}

  async findAll(user: any) {
    const qb = this.topicRepo.createQueryBuilder('topic');

    // Teachers and admins only see their own topics
    qb.where('topic.ownerId = :ownerId', { ownerId: user.userId });

    const topics = await qb
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC')
      .addOrderBy('topic.id', 'ASC')
      .getMany();

    return this.withProvenance(topics);
  }

  // ---- Herkunft ----
  //
  // Zwei Richtungen derselben Sache: Woher stammt dieses Thema (`origin`),
  // und wer hat sich von ihm etwas geholt (`copyCount`). Beides ist reine
  // Nennung – ein Zugriffsrecht folgt daraus nicht.

  /**
   * Zählt die *direkten* Kopien je Thema und hängt die Herkunft an.
   * Enkel werden bewusst nicht mitgezählt: Der Zähler beantwortet die Frage
   * "wer hat sich bei mir bedient", nicht "wie weit hat es sich verbreitet".
   */
  private async withProvenance(topics: LearningTopic[]) {
    const ids = topics.map((t) => t.id);
    const copies = ids.length
      ? await this.topicRepo.find({ where: { copiedFromId: In(ids) } })
      : [];

    const count = new Map<string, number>();
    for (const c of copies) {
      if (!c.copiedFromId) continue;
      count.set(c.copiedFromId, (count.get(c.copiedFromId) || 0) + 1);
    }

    return topics.map((t) => ({
      ...t,
      copyCount: count.get(t.id) || 0,
      origin: this.originOf(t),
    }));
  }

  /**
   * Die Herkunftsangabe einer Kopie, oder null bei einem eigenen Thema.
   * Gelesen wird aus den mitkopierten Textfeldern, damit die Nennung auch
   * dann noch steht, wenn Quelle oder Verfasser gelöscht sind.
   */
  private originOf(topic: LearningTopic) {
    if (!topic.copiedFromAuthor && !topic.copiedFromTitle) return null;
    return {
      topicId: topic.copiedFromId,
      ownerId: topic.copiedFromOwnerId,
      author: topic.copiedFromAuthor || 'Unbekannt',
      title: topic.copiedFromTitle || '',
    };
  }

  // ---- Zugriffsstufen ----
  //
  // Der gesamte Zugriff auf ein fremdes Thema hängt an dieser einen Stelle.
  // Jede Methode sagt, was sie braucht: 'read', 'write' oder 'owner'. Was
  // nicht ausdrücklich geöffnet wird, bleibt damit eigentümergebunden.

  /** Zugriffsstufe eines Benutzers auf ein Thema. */
  accessLevel(topic: LearningTopic, user: any): 'owner' | 'write' | 'read' | 'none' {
    if (topic.ownerId === user.userId) return 'owner';
    // Admins sehen und bearbeiten alles – wie bisher.
    if (user.role === 'admin') return 'owner';

    const entries = Array.isArray(topic.sharedAccess) ? topic.sharedAccess : [];
    // Ein persönlicher Eintrag schlägt die Sammelfreigabe für alle.
    const mine = entries.find((e) => e && e.userId === user.userId);
    const all = entries.find((e) => e && e.userId === '*');
    const level = (mine || all)?.level;
    if (level === 'write') return 'write';
    if (level === 'read') return 'read';
    return 'none';
  }

  private static readonly RANK = { none: 0, read: 1, write: 2, owner: 3 };

  /**
   * Lädt ein Thema und prüft dabei die geforderte Mindeststufe.
   * `findOne` bleibt als Lesezugriff erhalten, damit bestehende Aufrufer
   * unverändert weiterlaufen.
   */
  async findOneFor(id: string, user: any, need: 'read' | 'write' | 'owner') {
    const topic = await this.topicRepo.createQueryBuilder('topic')
      .where('topic.id = :id', { id })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC')
      .getOne();

    if (!topic) throw new NotFoundException('Thema nicht gefunden');

    const have = this.accessLevel(topic, user);
    if (TopicsService.RANK[have] < TopicsService.RANK[need]) {
      // Die Meldung nennt den Grund, damit nicht nach einem Fehler gesucht wird.
      throw new ForbiddenException(
        need === 'owner'
          ? 'Das kann nur der Eigentümer des Themas.'
          : 'Keine Berechtigung für dieses Thema.',
      );
    }
    return topic;
  }

  async findOne(id: string, user: any) {
    return this.findOneFor(id, user, 'read');
  }

  // ---- Freigabe zum Kopieren ----

  /** Prüft, ob ein Thema für diesen Benutzer zum Kopieren freigegeben ist. */
  private isSharedWith(topic: LearningTopic, userId: string): boolean {
    const list = topic.sharedWith;
    if (!Array.isArray(list) || list.length === 0) return false;
    return list.includes('*') || list.includes(userId);
  }

  /**
   * Darf dieser Benutzer das fremde Thema wenigstens ansehen?
   *
   * Wer kopieren darf, darf auch hineinschauen – sonst müsste man blind
   * kopieren. Die Nutzungsfreigabe ('read'/'write') schließt das Ansehen
   * ohnehin ein. Bewusst getrennt von accessLevel: Eine reine
   * Kopier-Freigabe soll das Thema *nicht* in fremden Themen-Links
   * verwendbar machen.
   */
  canView(topic: LearningTopic, user: any): boolean {
    return this.accessLevel(topic, user) !== 'none' || this.isSharedWith(topic, user.userId);
  }

  /**
   * Ein freigegebenes Thema zum reinen Ansehen: Module inklusive, aber ohne
   * alles, was dem Eigentümer gehört (Passwort, Subscribe-Key, Quick-Link,
   * Freigabelisten).
   */
  async findSharedForViewing(id: string, user: any) {
    const topic = await this.topicRepo.createQueryBuilder('topic')
      .where('topic.id = :id', { id })
      .leftJoinAndSelect('topic.modules', 'modules')
      .orderBy('modules.orderIndex', 'ASC')
      .getOne();

    if (!topic) throw new NotFoundException('Thema nicht gefunden');
    if (!this.canView(topic, user)) {
      throw new ForbiddenException('Dieses Thema ist nicht für dich freigegeben.');
    }

    const owner = await this.userRepo.findOne({ where: { id: topic.ownerId } });
    const { accessPassword, subscribeKey, quickToken, sharedWith, sharedAccess, ...safe } = topic;
    return {
      ...safe,
      ownerName: owner ? owner.displayName || owner.email : 'Unbekannt',
      accessLevel: this.accessLevel(topic, user),
      origin: this.originOf(topic),
      readOnly: true,
    };
  }

  // ---- Persönliche Ansicht auf fremde Freigaben ----
  //
  // Zwei Stufen, beide rein persönlich und beide ohne jede Wirkung beim
  // Eigentümer:
  //
  //   ausgeblendet  – aus dem Weg, aber zusammengeklappt erreichbar
  //   entfernt      – gar nicht mehr da; nur eine neue Freigabe holt es zurück
  //
  // Die Inhalte gehören weiterhin dem Eigentümer. Wer sie freigegeben
  // bekommt, entscheidet allein darüber, ob sie in *seiner* Liste auftauchen.

  /** Die vom Benutzer ausgeblendeten Freigaben – nie null. */
  private async hiddenIds(user: any): Promise<string[]> {
    const me = await this.userRepo.findOne({ where: { id: user.userId } });
    const list = me && Array.isArray(me.hiddenSharedTopics) ? me.hiddenSharedTopics : [];
    return list.filter(Boolean).map(String);
  }

  /** Die vom Benutzer entfernten Freigaben – nie null. */
  private async removedIds(user: any): Promise<string[]> {
    const me = await this.userRepo.findOne({ where: { id: user.userId } });
    const list = me && Array.isArray(me.removedSharedTopics) ? me.removedSharedTopics : [];
    return list.filter(Boolean).map(String);
  }

  /** Gemeinsame Prüfung für Ausblenden und Entfernen: fremdes Thema, das es gibt. */
  private async foreignTopicFor(id: string, user: any, verb: string) {
    const me = await this.userRepo.findOne({ where: { id: user.userId } });
    if (!me) throw new NotFoundException('Benutzer nicht gefunden');

    const topic = await this.topicRepo.findOne({ where: { id } });
    if (!topic) throw new NotFoundException('Thema nicht gefunden');
    if (topic.ownerId === user.userId) {
      // Eigene Themen werden gelöscht, nicht aus der eigenen Ansicht geräumt.
      throw new ForbiddenException(`Das ist dein eigenes Thema – es lässt sich löschen, nicht ${verb}.`);
    }
    return { me, topic };
  }

  /**
   * Blendet eine fremde Freigabe in der eigenen Liste aus bzw. wieder ein.
   * Das ist eine reine Ansichtssache des Aufrufers: Weder das Thema noch die
   * Freigabe der Kollegin ändern sich dadurch.
   */
  async setSharedHidden(id: string, user: any, hidden: boolean) {
    const { me } = await this.foreignTopicFor(id, user, 'ausblenden');

    const current = new Set(Array.isArray(me.hiddenSharedTopics) ? me.hiddenSharedTopics : []);
    if (hidden) current.add(id); else current.delete(id);
    me.hiddenSharedTopics = [...current];
    await this.userRepo.save(me);
    return { success: true, hidden };
  }

  /**
   * Entfernt eine fremde Freigabe aus der eigenen Liste – oder holt sie
   * zurück.
   *
   * "Entfernen" heißt hier ausdrücklich *nicht* löschen: Das Thema, seine
   * Module und die Freigabe des Eigentümers bleiben unangetastet. Verschwunden
   * ist nur die eigene Ansicht darauf.
   *
   * Der Zugriff selbst bleibt bestehen, damit bereits verteilte Themen- und
   * Quick-Links der Lehrkraft weiterlaufen. Wer eine Freigabe wirklich
   * loswerden will, entfernt sie hier und zieht seine Links dazu selbst
   * zurück – das ist die Entscheidung der Lehrkraft, nicht die eines
   * stillschweigenden Aufräumens.
   */
  async setSharedRemoved(id: string, user: any, removed: boolean) {
    const { me } = await this.foreignTopicFor(id, user, 'entfernen');

    const current = new Set(Array.isArray(me.removedSharedTopics) ? me.removedSharedTopics : []);
    if (removed) current.add(id); else current.delete(id);
    me.removedSharedTopics = [...current];

    if (removed) {
      // Was fort ist, muss nicht zusätzlich als ausgeblendet geführt werden –
      // sonst käme es beim Zurückholen gleich wieder zusammengeklappt an.
      const hidden = new Set(Array.isArray(me.hiddenSharedTopics) ? me.hiddenSharedTopics : []);
      hidden.delete(id);
      me.hiddenSharedTopics = [...hidden];
    }

    await this.userRepo.save(me);
    return { success: true, removed };
  }

  /**
   * Räumt die persönlichen Merker derer weg, die gerade neu freigegeben
   * bekommen haben. Eine frische Einladung soll nicht daran scheitern, dass
   * dieselbe Person die Freigabe vor Wochen einmal weggeklickt hat.
   */
  private async clearPersonalMarks(topicId: string, userIds: string[]) {
    const ids = userIds.filter((id) => id && id !== '*');
    // '*' trifft alle: dann zählt jeder, der den Eintrag überhaupt trägt.
    const everyone = userIds.includes('*');
    if (!everyone && ids.length === 0) return;

    const users = await this.userRepo.find();
    const touched = users.filter((u) => {
      if (!everyone && !ids.includes(u.id)) return false;
      const removed = Array.isArray(u.removedSharedTopics) && u.removedSharedTopics.includes(topicId);
      const hidden = Array.isArray(u.hiddenSharedTopics) && u.hiddenSharedTopics.includes(topicId);
      return removed || hidden;
    });

    for (const u of touched) {
      u.removedSharedTopics = (u.removedSharedTopics || []).filter((t) => t !== topicId);
      u.hiddenSharedTopics = (u.hiddenSharedTopics || []).filter((t) => t !== topicId);
    }
    if (touched.length) await this.userRepo.save(touched);
  }

  /** Freigabe setzen. Nur der Eigentümer (oder ein Admin) darf das. */
  async setSharing(id: string, user: any, sharedWith?: string[], sharedAccess?: any) {
    const topic = await this.findOneFor(id, user, 'owner');

    // Nur wer wirklich etwas dazugewinnt, bekommt eine neue Einladung – und
    // nur die rechtfertigt es, seine persönliche Entscheidung
    // (ausgeblendet/entfernt) zu überschreiben. Das bloße Erneutspeichern
    // unveränderter Freigaben soll niemandem etwas zurück in die Liste
    // schieben.
    const before = this.grantSignatures(topic);

    if (sharedWith !== undefined) {
      const clean = Array.isArray(sharedWith)
        ? [...new Set(sharedWith.map(String).filter(Boolean))]
        : [];
      // '*' schlägt jede Einzelauswahl – sonst wäre der Zustand widersprüchlich.
      topic.sharedWith = clean.includes('*') ? ['*'] : clean;
    }

    if (sharedAccess !== undefined) {
      topic.sharedAccess = this.cleanAccess(sharedAccess);
    }

    await this.topicRepo.save(topic);

    const after = this.grantSignatures(topic);
    const gained: string[] = [];
    for (const [userId, now] of after) {
      const had = this.effectiveGrant(before, userId);
      if ((now.copy && !had.copy) || now.level > had.level) gained.push(userId);
    }
    await this.clearPersonalMarks(topic.id, gained);

    return { success: true, sharedWith: topic.sharedWith, sharedAccess: topic.sharedAccess };
  }

  /**
   * Was jede genannte Person am Thema hat: kopieren ja/nein und welche
   * Nutzungsstufe. '*' bleibt als eigener Schlüssel stehen – es steht für
   * alle und wird beim Vergleich mitgelesen.
   */
  private grantSignatures(topic: LearningTopic): Map<string, { copy: boolean; level: number }> {
    const out = new Map<string, { copy: boolean; level: number }>();
    const at = (userId: string) => {
      if (!out.has(userId)) out.set(userId, { copy: false, level: 0 });
      return out.get(userId)!;
    };
    for (const userId of Array.isArray(topic.sharedWith) ? topic.sharedWith : []) {
      if (userId) at(String(userId)).copy = true;
    }
    for (const entry of Array.isArray(topic.sharedAccess) ? topic.sharedAccess : []) {
      if (entry?.userId) at(String(entry.userId)).level = entry.level === 'write' ? 2 : 1;
    }
    return out;
  }

  /** Was jemand tatsächlich hatte – die Sammelfreigabe für alle zählt mit. */
  private effectiveGrant(
    signatures: Map<string, { copy: boolean; level: number }>,
    userId: string,
  ): { copy: boolean; level: number } {
    const mine = signatures.get(userId) || { copy: false, level: 0 };
    if (userId === '*') return mine;
    const all = signatures.get('*') || { copy: false, level: 0 };
    return { copy: mine.copy || all.copy, level: Math.max(mine.level, all.level) };
  }

  /**
   * Themen, die in einem eigenen Themen-Link verwendet werden dürfen:
   * die eigenen und die, die mir jemand zur Nutzung freigegeben hat.
   *
   * Fremde Themen kommen entschärft zurück – Zugangsdaten des Eigentümers
   * gehen niemanden sonst etwas an, auch nicht die Lehrkraft, die die
   * Inhalte verwenden darf.
   */
  async findUsable(user: any) {
    const all = await this.topicRepo.find({ relations: ['modules'] });
    const owners = await this.userRepo.find();
    const ownerName = new Map(owners.map((o) => [o.id, o.displayName || o.email]));
    // Entfernte Freigaben sollen auch im Link-Editor nicht mehr auftauchen –
    // sonst wäre "entfernt" nur die halbe Wahrheit. Der Zugriff selbst bleibt
    // bestehen, damit bereits gespeicherte Links weiterlaufen.
    const removed = new Set(await this.removedIds(user));

    const usable = [];
    for (const topic of all) {
      const level = this.accessLevel(topic, user);
      if (level === 'none') continue;

      const isOwn = topic.ownerId === user.userId;
      if (!isOwn && removed.has(topic.id)) continue;
      if (isOwn) {
        usable.push({ ...topic, accessLevel: level, isOwn: true, ownerName: null, origin: this.originOf(topic) });
        continue;
      }

      const { accessPassword, subscribeKey, quickToken, sharedWith, sharedAccess, ...safe } = topic;
      usable.push({
        ...safe,
        accessLevel: level,
        isOwn: false,
        ownerName: ownerName.get(topic.ownerId) || 'Unbekannt',
        origin: this.originOf(topic),
      });
    }

    usable.sort((a, b) =>
      // Eigene zuerst, danach alphabetisch – so steht Vertrautes oben.
      a.isOwn === b.isOwn ? a.title.localeCompare(b.title, 'de') : a.isOwn ? -1 : 1,
    );
    return usable;
  }

  /**
   * Räumt eine übergebene Zugriffsliste auf: bekannte Stufen, keine
   * Doppelungen, pro Person ein Eintrag.
   */
  private cleanAccess(input: any): Array<{ userId: string; level: 'read' | 'write' }> {
    if (!Array.isArray(input)) return [];
    const byUser = new Map<string, 'read' | 'write'>();
    for (const entry of input) {
      const userId = String(entry?.userId || '').trim();
      const level = entry?.level;
      if (!userId || (level !== 'read' && level !== 'write')) continue;
      // Die höhere Stufe gewinnt, falls jemand doppelt auftaucht.
      const existing = byUser.get(userId);
      byUser.set(userId, existing === 'write' || level === 'write' ? 'write' : 'read');
    }
    return [...byUser].map(([userId, level]) => ({ userId, level }));
  }

  /** Kolleginnen und Kollegen für die Auswahl im Freigabe-Dialog. */
  async listColleagues(user: any) {
    const users = await this.userRepo.find();
    return users
      .filter((u) => u.id !== user.userId && (u.role === 'teacher' || u.role === 'admin'))
      .map((u) => ({
        id: u.id,
        displayName: u.displayName || u.email,
        email: u.email,
        role: u.role,
      }));
  }

  /**
   * Themen, die mir jemand freigegeben hat. Die Liste wird in JavaScript
   * gefiltert, weil sharedWith als JSON-Text gespeichert ist – bei schulischen
   * Datenmengen völlig unkritisch.
   */
  async findSharedWithMe(user: any) {
    const topics = await this.topicRepo.find({ relations: ['modules'] });
    const owners = await this.userRepo.find();
    const ownerName = new Map(owners.map((o) => [o.id, o.displayName || o.email]));
    // Ausgeblendetes kommt mit – die Oberfläche kann es so auf Wunsch
    // wieder hervorholen, ohne dass etwas verloren geht.
    const hidden = new Set(await this.hiddenIds(user));
    // Entferntes kommt nicht mit – das ist der Unterschied zum Ausblenden.
    const removed = new Set(await this.removedIds(user));

    // Alles, was mir jemand zugänglich gemacht hat – zum Kopieren, zum
    // Verwenden oder beides. Welche Knöpfe erscheinen, entscheidet danach
    // die Oberfläche anhand von canCopy/canUse.
    return topics
      .filter((t) => {
        if (t.ownerId === user.userId) return false;
        if (removed.has(t.id)) return false;
        return this.isSharedWith(t, user.userId) || this.accessLevel(t, user) !== 'none';
      })
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        ownerId: t.ownerId,
        ownerName: ownerName.get(t.ownerId) || 'Unbekannt',
        moduleCount: (t.modules || []).length,
        canCopy: this.isSharedWith(t, user.userId),
        canUse: this.accessLevel(t, user) !== 'none',
        canView: this.canView(t, user),
        hidden: hidden.has(t.id),
        origin: this.originOf(t),
      }));
  }

  /**
   * Zieht eine eigene Kopie eines freigegebenen Themas. Der Kopierende wird
   * Eigentümer; das Original bleibt unverändert. Zugangsdaten des Originals
   * (Passwort, Subscribe-Key, Quick-Link) werden bewusst nicht übernommen.
   *
   * Die Eigentümerrolle wechselt damit vollständig: Der bisherige Eigentümer
   * behält sein Original und bekommt auf die Kopie *verwenden* und
   * *kopieren* vorbelegt – er soll sehen dürfen, was aus seinem Material
   * geworden ist, und sich die verbesserte Fassung auch zurückholen können.
   *
   * Vorbelegt, nicht festgeschrieben: Der neue Eigentümer kann beides in
   * seinem Freigabe-Dialog abstellen. Ein unentziehbares Zugriffsrecht wäre
   * hier falsch – nach ein paar Bearbeitungen steht in der Kopie Material,
   * das nie aus dem Original stammte und das niemand pauschal weitergeben
   * können soll. Unentziehbar ist allein die *Nennung* der Herkunft; sie
   * kostet nichts und ist das, was die Fairness eigentlich meint.
   */
  async copySharedTopic(id: string, user: any) {
    const source = await this.topicRepo.findOne({ where: { id }, relations: ['modules'] });
    if (!source) throw new NotFoundException('Thema nicht gefunden');
    if (source.ownerId === user.userId) {
      throw new ForbiddenException('Das ist bereits dein eigenes Thema.');
    }
    if (!this.isSharedWith(source, user.userId) && user.role !== 'admin') {
      throw new ForbiddenException('Dieses Thema ist nicht für dich freigegeben.');
    }

    const sourceOwner = await this.userRepo.findOne({ where: { id: source.ownerId } });

    const copy = await this.topicRepo.save(this.topicRepo.create({
      id: crypto.randomUUID(),
      // Kennzeichnung, damit mehrfaches Kopieren nicht zu gleichnamigen
      // Themen führt. Umbenennen kann der neue Eigentümer jederzeit.
      title: `${source.title} (Kopie)`,
      description: source.description,
      ownerId: user.userId,
      // Die Kopie startet bewusst unveröffentlicht: erst prüfen, dann freigeben.
      selected: false,
      visibility: 'locked',
      accessPassword: null as any,
      subscribeKey: null as any,
      quickToken: null,
      // Beides zurück an den bisherigen Eigentümer: Er hat das Material
      // beigesteuert und verliert mit der Kopie sonst jeden Blick darauf –
      // und ohne das Kopierrecht käme er an eine verbesserte Fassung nicht
      // mehr heran. Abstellbar bleibt es trotzdem.
      sharedWith: [source.ownerId],
      sharedAccess: [{ userId: source.ownerId, level: 'read' as const }],
      // Herkunft als Text, nicht als Verweis allein: Sie soll die Quelle und
      // deren Verfasser überleben. Nur die direkte Abstammung – die Kopie
      // einer Kopie nennt ihre unmittelbare Quelle, keinen Stammbaum.
      copiedFromId: source.id,
      copiedFromOwnerId: source.ownerId,
      copiedFromAuthor: sourceOwner ? sourceOwner.displayName || sourceOwner.email : 'Unbekannt',
      copiedFromTitle: source.title,
      permissions: source.permissions,
    }));

    const modules = (source.modules || []).map((m) => {
      const { id: _id, topic: _t, subModules: _s, parent: _p, ...rest } = m as any;
      return Object.assign(new LearningModule(), {
        ...rest,
        id: crypto.randomUUID(),
        topicId: copy.id,
        parentId: null,
      });
    });
    if (modules.length) await this.moduleRepo.save(modules);

    // Falls der bisherige Eigentümer frühere Freigaben von mir einmal
    // weggeklickt hat, soll die Kopie trotzdem bei ihm ankommen.
    await this.clearPersonalMarks(copy.id, [source.ownerId]);

    return { success: true, topicId: copy.id, title: copy.title, moduleCount: modules.length };
  }

  // ---- Quick-Link: Schüler starten per Link/QR-Code direkt das Quiz ----
  //
  // Der Quick-Link gehört nicht dem Thema, sondern der Lehrkraft, die ihn
  // verteilt. Deshalb darf ihn auch anlegen, wer das Thema nur verwenden
  // darf: Die Ergebnisse landen bei ihr, so wie beim Themen-Link auch. Der
  // Eigentümer bleibt Eigentümer des Inhalts – am Thema selbst ändert ein
  // fremder Quick-Link nichts.

  /**
   * Liefert den Quick-Link dieser Lehrkraft auf das Thema und legt ihn beim
   * ersten Aufruf an. Mit `regenerate` wird ein neuer Token erzeugt; die
   * bisher von *dieser* Lehrkraft verteilten Links und QR-Codes sind damit
   * sofort ungültig – die der Kolleginnen bleiben unberührt.
   */
  async getQuickLink(id: string, user: any, regenerate = false, req?: any) {
    const topic = await this.findOneFor(id, user, 'read');
    const isOwner = this.accessLevel(topic, user) === 'owner';

    // Ein Quick-Link auf etwas Gesperrtes wäre eine Falle: Der Schüler scannt
    // und landet vor einer verschlossenen Tür. Deshalb gar nicht erst erzeugen.
    //
    // Für fremde Themen zählt stattdessen die Nutzungsfreigabe: Sie ist die
    // ausdrückliche Zustimmung des Eigentümers, und der Haken "aktiv" gehört
    // zu seiner eigenen Schülersicht, nicht zu meiner. Genauso hält es der
    // Themen-Link.
    if (isOwner && !topic.selected) {
      throw new ForbiddenException(
        'Das Thema ist nicht für Schüler freigegeben. Bitte zuerst freigeben, dann den Quick-Link erzeugen.',
      );
    }
    const activeCount = (topic.modules || []).filter((m) => m.moduleSelected !== false).length;
    if (activeCount === 0) {
      throw new ForbiddenException(
        'Das Thema hat keine freigegebenen Module. Bitte zuerst mindestens ein Modul freigeben.',
      );
    }

    const entry = await this.quickLinkEntry(topic, user, regenerate);
    const url = `${baseUrl(req)}/?q=${entry.token}`;

    return {
      token: entry.token,
      url,
      qrSvg: await renderQr(url),
      topicId: topic.id,
      title: topic.title,
      moduleCount: activeCount,
      isOwn: isOwner,
    };
  }

  /**
   * Holt den Eintrag dieser Lehrkraft oder legt ihn an.
   *
   * Übergang vom alten Modell: Früher hing genau ein Token als Spalte am
   * Thema. Der gehört dem Eigentümer und wird beim ersten Aufruf in die
   * Tabelle übernommen, damit bereits verteilte Zettel gültig bleiben.
   */
  private async quickLinkEntry(topic: LearningTopic, user: any, regenerate: boolean) {
    let entry = await this.quickRepo.findOne({ where: { topicId: topic.id, ownerId: user.userId } });

    if (!entry && topic.quickToken && topic.ownerId === user.userId) {
      entry = this.quickRepo.create({
        id: crypto.randomUUID(),
        topicId: topic.id,
        ownerId: user.userId,
        token: topic.quickToken,
      });
      await this.quickRepo.save(entry);
    }

    if (!entry) {
      entry = this.quickRepo.create({
        id: crypto.randomUUID(),
        topicId: topic.id,
        ownerId: user.userId,
        token: this.newQuickToken(),
      });
    } else if (regenerate) {
      entry.token = this.newQuickToken();
    } else {
      return entry;
    }

    await this.quickRepo.save(entry);
    // Die alte Spalte wird mitgeführt, solange sie am Thema steht: Ein
    // Rückschritt auf eine ältere Fassung soll den Eigentümer nicht ohne
    // Quick-Link dastehen lassen.
    if (topic.ownerId === user.userId && topic.quickToken !== entry.token) {
      topic.quickToken = entry.token;
      await this.topicRepo.save(topic);
    }
    return entry;
  }

  /**
   * 16 Zeichen aus dem URL-sicheren Alphabet – genug Entropie, damit der
   * Link nicht erratbar ist, und noch kurz genug für einen QR-Code.
   */
  private newQuickToken(): string {
    return crypto.randomBytes(12).toString('base64url');
  }

  /** Den eigenen Quick-Link entwerten, ohne einen neuen zu erzeugen. */
  async revokeQuickLink(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'read');

    const entry = await this.quickRepo.findOne({ where: { topicId: id, ownerId: user.userId } });
    if (entry) await this.quickRepo.remove(entry);

    // Nur der eigene Zugang verschwindet; die Quick-Links der Kolleginnen auf
    // dasselbe Thema bleiben gültig.
    if (topic.ownerId === user.userId && topic.quickToken) {
      topic.quickToken = null;
      await this.topicRepo.save(topic);
    }
    return { success: true };
  }

  async create(user: any, topicData: Partial<LearningTopic>) {
    const topic = this.topicRepo.create({
      ...topicData,
      id: crypto.randomUUID(),
      ownerId: user.userId,
      visibility: (topicData as any).visibility || 'locked',
      tagIds: await this.tagsService.sanitizeIds(user, (topicData as any).tagIds),
    });
    return this.topicRepo.save(topic);
  }

  async addModule(topicId: string, user: any, moduleData: Partial<LearningModule>) {
    const topic = await this.findOneFor(topicId, user, 'write');
    let orderIndex = moduleData.orderIndex;
    if (orderIndex === undefined) {
      if (moduleData.id) {
        const existing = topic.modules ? topic.modules.find(m => m.id === moduleData.id) : null;
        orderIndex = existing ? existing.orderIndex : (topic.modules ? topic.modules.length : 0);
      } else {
        orderIndex = topic.modules ? topic.modules.length : 0;
      }
    }
    // Nur eigene Tags akzeptieren - wie beim Thema, damit eine manipulierte
    // Anfrage keine fremden Tag-IDs am Modul hinterlassen kann.
    const tagIds =
      (moduleData as any).tagIds !== undefined
        ? await this.tagsService.sanitizeIds(user, (moduleData as any).tagIds)
        : undefined;

    const module = this.moduleRepo.create({
      ...moduleData,
      ...(tagIds !== undefined ? { tagIds } : {}),
      // Ohne id schlug das Anlegen bisher mit einem NOT-NULL-Fehler fehl. Eine
      // mitgeschickte id bleibt erhalten, denn derselbe Aufruf aktualisiert
      // auch bestehende Module – sonst entstünde bei jeder Bearbeitung ein Duplikat.
      id: moduleData.id || crypto.randomUUID(),
      topicId: topic.id,
      orderIndex,
    });
    return this.moduleRepo.save(module);
  }

  async remove(id: string, user: any) {
    const topic = await this.findOneFor(id, user, 'owner');
    if (topic.modules && topic.modules.length > 0) {
      await this.moduleRepo.remove(topic.modules);
    }
    // Mit dem Thema gehen auch die Quick-Links aller Lehrkräfte darauf –
    // sonst blieben tote Tokens in der Tabelle zurück.
    const quickLinks = await this.quickRepo.find({ where: { topicId: id } });
    if (quickLinks.length) await this.quickRepo.remove(quickLinks);
    await this.topicRepo.remove(topic);
    return { success: true };
  }

  /**
   * Inhaltliche Felder, die ein Bearbeiter setzen darf.
   *
   * Bewusst eine Positivliste: Vorher kam nur der Eigentümer hierher, ein
   * blindes Object.assign war deshalb harmlos. Sobald Fremde schreiben
   * dürfen, ließen sich darüber sonst ownerId, sharedWith/sharedAccess oder
   * das Themenpasswort mitsetzen.
   */
  private static readonly EDITABLE_FIELDS = ['title', 'description', 'selected', 'tagIds'];

  /** Zusätzlich nur für den Eigentümer: Zugang und Sichtbarkeit. */
  private static readonly OWNER_FIELDS = ['visibility', 'accessPassword', 'subscribeKey', 'permissions'];

  async update(id: string, user: any, updateData: Partial<LearningTopic>) {
    const topic = await this.findOneFor(id, user, 'write');
    const isOwner = this.accessLevel(topic, user) === 'owner';

    const allowed = isOwner
      ? [...TopicsService.EDITABLE_FIELDS, ...TopicsService.OWNER_FIELDS]
      : TopicsService.EDITABLE_FIELDS;

    const data = updateData as any;
    for (const field of allowed) {
      if (field === 'tagIds' || data[field] === undefined) continue;
      (topic as any)[field] = data[field];
    }

    // Nur eigene Tags akzeptieren – sonst könnte eine manipulierte Anfrage
    // fremde Tag-IDs am Thema hinterlassen.
    if (data.tagIds !== undefined) topic.tagIds = await this.tagsService.sanitizeIds(user, data.tagIds);

    // Auto-promote visibility when activating: selected=true + visibility='locked' → 'public'
    if (topic.selected && topic.visibility === 'locked') {
      topic.visibility = 'public';
    }
    return this.topicRepo.save(topic);
  }

  async removeModule(topicId: string, moduleId: string, user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    await this.moduleRepo.remove(module);
    return { success: true };
  }

  async toggleModule(topicId: string, moduleId: string, selected: boolean, user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const module = topic.modules.find(m => m.id === moduleId);
    if (!module) throw new NotFoundException('Modul nicht gefunden');
    module.moduleSelected = selected;
    await this.moduleRepo.save(module);
    return { success: true };
  }

  async bulkToggleModules(topicId: string, moduleIds: string[], selected: boolean, user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const modulesToUpdate = topic.modules.filter(m => moduleIds.includes(m.id));
    for (const m of modulesToUpdate) {
      m.moduleSelected = selected;
    }
    if (modulesToUpdate.length > 0) {
      await this.moduleRepo.save(modulesToUpdate);
    }
    return { success: true };
  }

  /**
   * Module in ein anderes Thema verschieben oder kopieren – und mit
   * `targetTopicId === topicId` im selben Thema duplizieren.
   *
   * Beide Themen brauchen Schreibrecht: Verschieben nimmt dem einen etwas
   * weg und legt es dem anderen hinein. Tags wandern mit, Ergebnisse nicht –
   * die hängen am Link, nicht am Modul.
   */
  async transferModules(
    topicId: string,
    targetTopicId: string,
    moduleIds: string[],
    mode: 'move' | 'copy',
    user: any,
  ) {
    const ids = Array.isArray(moduleIds) ? [...new Set(moduleIds.filter(Boolean).map(String))] : [];
    if (ids.length === 0) throw new NotFoundException('Keine Module ausgewählt.');
    if (mode !== 'move' && mode !== 'copy') {
      throw new ForbiddenException('Unbekannte Aktion – erlaubt sind "move" und "copy".');
    }

    const source = await this.findOneFor(topicId, user, 'write');
    const sameTopic = topicId === targetTopicId;
    if (sameTopic && mode === 'move') {
      // Verschieben innerhalb desselben Themas ist die Reihenfolge, nicht das hier.
      throw new ForbiddenException('Quelle und Ziel sind dasselbe Thema – zum Duplizieren bitte "kopieren".');
    }
    const target = sameTopic ? source : await this.findOneFor(targetTopicId, user, 'write');

    // Die Reihenfolge der Auswahl soll im Ziel erhalten bleiben.
    const picked = (source.modules || [])
      .filter((m) => ids.includes(m.id))
      .sort((a, b) => a.orderIndex - b.orderIndex);
    if (picked.length === 0) throw new NotFoundException('Die gewählten Module gehören nicht zu diesem Thema.');

    if (mode === 'move') {
      let next = (target.modules || []).length;
      for (const m of picked) {
        m.topicId = target.id;
        // Untermodule kennt die Oberfläche nicht; ein mitgeschleppter
        // parentId zeigte sonst in das alte Thema.
        m.parentId = null as any;
        m.orderIndex = next++;
      }
      await this.moduleRepo.save(picked);
      // Im Quellthema bleiben sonst Lücken in der Reihenfolge zurück.
      await this.compactOrder(source.id, ids);
      return { success: true, count: picked.length, mode, targetTopicId: target.id };
    }

    const copies = picked.map((m) => {
      const { id: _id, topic: _t, subModules: _s, parent: _p, createdAt: _c, updatedAt: _u, ...rest } = m as any;
      return Object.assign(new LearningModule(), {
        ...rest,
        id: crypto.randomUUID(),
        topicId: target.id,
        parentId: null,
        // Nur im selben Thema braucht die Kopie einen eigenen Namen – sonst
        // stünden zwei identische Einträge untereinander.
        title: sameTopic ? `${m.title} (Kopie)` : m.title,
      });
    });

    if (sameTopic) {
      // Das Duplikat gehört direkt hinter sein Original, nicht ans Ende.
      const order = [...(source.modules || [])].sort((a, b) => a.orderIndex - b.orderIndex);
      const result: Array<{ id: string; entity: any }> = [];
      for (const m of order) {
        result.push({ id: m.id, entity: m });
        const copy = copies[picked.findIndex((p) => p.id === m.id)];
        if (copy) result.push({ id: copy.id, entity: copy });
      }
      result.forEach((entry, i) => { entry.entity.orderIndex = i; });
      await this.moduleRepo.save(copies);
      await this.moduleRepo.save(order);
    } else {
      let next = (target.modules || []).length;
      for (const copy of copies) copy.orderIndex = next++;
      await this.moduleRepo.save(copies);
    }

    return { success: true, count: copies.length, mode, targetTopicId: target.id };
  }

  /** Schließt die Lücken in der Reihenfolge, die entfernte Module hinterlassen. */
  private async compactOrder(topicId: string, removedIds: string[]) {
    const rest = await this.moduleRepo.find({ where: { topicId } });
    const ordered = rest
      .filter((m) => !removedIds.includes(m.id))
      .sort((a, b) => a.orderIndex - b.orderIndex);
    ordered.forEach((m, i) => { m.orderIndex = i; });
    if (ordered.length) await this.moduleRepo.save(ordered);
  }

  async reorderModules(topicId: string, moduleIds: string[], user: any) {
    const topic = await this.findOneFor(topicId, user, 'write');
    const updates = [];
    for (let i = 0; i < moduleIds.length; i++) {
      const module = topic.modules.find(m => m.id === moduleIds[i]);
      if (module) {
        module.orderIndex = i;
        updates.push(module);
      }
    }
    if (updates.length > 0) {
      await this.moduleRepo.save(updates);
    }
    return { success: true };
  }
}
