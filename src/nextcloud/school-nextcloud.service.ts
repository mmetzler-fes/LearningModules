import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { SchoolNextcloud } from '../core/entities/school-nextcloud.entity';
import { NextcloudLink } from '../core/entities/nextcloud-link.entity';
import { LearningModule } from '../core/entities/learning-module.entity';
import { ModuleDraft } from '../core/entities/module-draft.entity';
import { User } from '../core/entities/user.entity';
import { MasterKeyService } from '../core/crypto/master-key.service';
import { assertPublicHost, parseNextcloudShare } from '../core/share/nextcloud-upload';
import { DavEntry, ShareClient, parseNextcloudBase } from './nextcloud-api';
import { NextcloudService } from './nextcloud.service';

const IMAGES = 'Bilder';
const CHECK_FILE = 'lm-verbindungstest.txt';
const safePart = (p: string) => !!p && !/[\\/]/.test(p) && p !== '.' && p !== '..';

/**
 * Nextcloud der Schule für die Bilder aller Lehrkräfte (docs/nextcloud.md) –
 * eingerichtet vom Schuladmin. Lehrkräfte ohne eigene Freigabe legen ihre
 * Bilder dort ab, in Bilder/<Lehrkraft>/<Thema>/; die Ablage selbst
 * (Hochladen, Links, Bilder folgen dem Thema) steckt im NextcloudService.
 *
 * Hier: verbinden, trennen (nur ausdrücklich, solange Bilder in Modulen
 * stecken), umziehen (Bilder werden mitkopiert, Links bleiben gleich) und die
 * Übersicht der Lehrkraft-Ordner zum Aufräumen.
 */
@Injectable()
export class SchoolNextcloudService {
  constructor(
    @InjectRepository(SchoolNextcloud) private readonly repo: Repository<SchoolNextcloud>,
    @InjectRepository(NextcloudLink) private readonly linkRepo: Repository<NextcloudLink>,
    @InjectRepository(LearningModule) private readonly moduleRepo: Repository<LearningModule>,
    @InjectRepository(ModuleDraft) private readonly draftRepo: Repository<ModuleDraft>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly masterKey: MasterKeyService,
    private readonly nextcloud: NextcloudService,
  ) {}

  /** Die Schule, die `user` verwalten darf – sonst 403. */
  private schoolOf(user: any): string {
    if (!user?.isSchoolAdmin || !user?.schoolId) throw new ForbiddenException('Nur für Schuladmins.');
    return user.schoolId;
  }

  private async row(schoolId: string) {
    return (await this.repo.findOne({ where: { schoolId } }))
      || this.repo.create({ id: crypto.randomUUID(), schoolId, baseUrl: '', shareToken: null });
  }

  private shareLink(r: SchoolNextcloud) {
    return r.baseUrl && r.shareToken ? `${r.baseUrl}/s/${r.shareToken}` : '';
  }

  /** Module und Entwürfe mit Bildern aus der Nextcloud dieser Schule – optional nur aus einem Lehrkraft-Ordner. */
  private async references(r: SchoolNextcloud, folder?: string) {
    const needle = `%/api/nextcloud/sch/${r.id}/%`;
    const exact = folder ? `/api/nextcloud/sch/${r.id}/${encodeURIComponent(folder)}/` : '';
    const mods = await this.moduleRepo.createQueryBuilder('m').select(['m.id', 'm.content']).where('m.content LIKE :n', { n: needle }).getMany();
    const drafts = await this.draftRepo.createQueryBuilder('d').select(['d.id', 'd.data']).where('d.data LIKE :n', { n: needle }).getMany();
    // LIKE kennt % als Platzhalter (und kodierte Namen enthalten %) – genau prüfen.
    const hit = (v: any) => !exact || JSON.stringify(v).includes(exact);
    return mods.filter((m) => hit(m.content)).length + drafts.filter((d) => hit(d.data)).length;
  }

  private readonly moves = new Map<string, { running: boolean; copied: number; total: number; from: string; error?: string }>();

  async status(user: any) {
    const schoolId = this.schoolOf(user);
    const r = await this.repo.findOne({ where: { schoolId } });
    if (!r?.shareToken) return { configured: false, verified: false, shareUrl: '', hasPassword: false, references: 0, move: r?.moveResult || null };
    return {
      configured: true,
      verified: !!r.verifiedAt,
      verifiedAt: r.verifiedAt,
      shareUrl: this.shareLink(r),
      hasPassword: !!r.passwordSealed,
      references: await this.references(r),
      move: this.moves.get(schoolId) || (r.moveResult ? { ...r.moveResult, running: false } : null),
    };
  }

  /** Neue Freigabe prüfen: öffnen (Passwort), Ordner Bilder anlegen, eine Datei schreiben und löschen. */
  private async probe(shareUrl: string, password: string) {
    const share = parseNextcloudShare(shareUrl);
    const base = parseNextcloudBase(share.base);
    if (!base) throw new BadRequestException('Der Freigabelink muss mit https:// beginnen.');
    await assertPublicHost(base);
    const nc = new ShareClient(base, share.token, password, 'classic');
    const mode = await nc.detectMode();
    await nc.ensureFolder([IMAGES]);
    await nc.put([IMAGES, CHECK_FILE], Buffer.from(`LearningModules-Verbindungstest ${crypto.randomUUID()}`, 'utf-8'), 'text/plain');
    await nc.remove([IMAGES, CHECK_FILE]);
    return { base, token: share.token, mode, nc };
  }

  /** `{ shareUrl, password? }` – leeres Passwort lässt das gespeicherte. */
  async connect(user: any, input: any, appBase: string) {
    const schoolId = this.schoolOf(user);
    const r = await this.row(schoolId);
    const share = parseNextcloudShare(input?.shareUrl);
    const base = parseNextcloudBase(share.base);
    if (r.verifiedAt && r.shareToken && (r.shareToken !== share.token || r.baseUrl !== base) && (await this.references(r)) > 0) {
      throw new BadRequestException('In Modulen stecken Bilder aus der bisherigen Freigabe. Für eine andere Nextcloud bitte „🚚 Umziehen“ verwenden – das kopiert die Bilder mit.');
    }
    let password = '';
    if (input?.password) password = String(input.password);
    else if (r.passwordSealed && r.shareToken === share.token) {
      try { password = this.masterKey.unsealSecret(r.passwordSealed); } catch { /* unten: Passwort falsch */ }
    }
    const p = await this.probe(input?.shareUrl, password);
    Object.assign(r, {
      baseUrl: p.base, shareToken: p.token, davMode: p.mode, verifiedAt: new Date(), appBase,
      passwordSealed: password ? this.masterKey.sealSecret(password) : null,
    });
    await this.repo.save(r);
    // Bilder, die schon woanders liegen (früherer Admin-Ordner, Kolleginnen), wandern nach.
    void this.nextcloud.followOwners().catch(() => undefined);
    return { ...(await this.status(user)), message: 'Verbunden – Lehrkräfte ohne eigene Freigabe legen ihre Bilder jetzt hier ab.' };
  }

  /** Trennen. Stecken noch Bilder in Modulen, nur mit `force` – sie fehlen dann dort. */
  async disconnect(user: any, force = false) {
    const schoolId = this.schoolOf(user);
    const r = await this.repo.findOne({ where: { schoolId } });
    if (!r) return { success: true };
    if (r.verifiedAt && !force && (await this.references(r)) > 0) {
      throw new BadRequestException('In Modulen stecken noch Bilder aus der Nextcloud der Schule – erst umziehen oder ausdrücklich trotzdem trennen.');
    }
    // Die Zeile bleibt: Ihre Kennung steckt in den Bild-Links.
    Object.assign(r, { shareToken: null, passwordSealed: null, davMode: null, verifiedAt: null });
    await this.repo.save(r);
    return { success: true };
  }

  /**
   * Ordner unter Bilder/ – je Lehrkraft: wem er gehört, ob sie noch an der
   * Schule ist, wie viele Bilder darin liegen und in wie vielen Modulen sie
   * noch stecken. Ohne Verweise kann der Ordner weg.
   */
  async folders(user: any) {
    const schoolId = this.schoolOf(user);
    const r = await this.repo.findOne({ where: { schoolId } });
    if (!r?.shareToken || !r.verifiedAt) return { folders: [] };
    const nc = await this.nextcloud.schoolNcClient(r);
    const out: any[] = [];
    for (const f of (await nc.list([IMAGES])).filter((e) => e.isFolder && safePart(e.name))) {
      const l = await this.linkRepo.findOne({ where: { schoolFolder: f.name } });
      const u = l ? await this.userRepo.findOne({ where: { id: l.userId } }) : null;
      let images = 0;
      let bytes = 0;
      for (const t of (await nc.list([IMAGES, f.name]).catch((): DavEntry[] => [])).filter((e) => e.isFolder)) {
        for (const e of await nc.list([IMAGES, f.name, t.name]).catch((): DavEntry[] => [])) if (!e.isFolder) { images++; bytes += e.size; }
      }
      out.push({
        folder: f.name,
        teacher: u ? u.displayName || u.email : null,
        atSchool: !!u && u.schoolId === schoolId,
        images, bytes,
        references: await this.references(r, f.name),
      });
    }
    return { folders: out.sort((a, b) => a.folder.localeCompare(b.folder, 'de')) };
  }

  /** Ordner einer Lehrkraft löschen – nur, wenn kein Modul mehr ein Bild daraus zeigt. */
  async removeFolder(user: any, folder: string) {
    const schoolId = this.schoolOf(user);
    const r = await this.repo.findOne({ where: { schoolId } });
    if (!r?.shareToken || !r.verifiedAt) throw new BadRequestException('Die Schule hat keine Nextcloud verbunden.');
    if (!safePart(folder)) throw new BadRequestException('Ungültiger Ordner.');
    const n = await this.references(r, folder);
    if (n) throw new BadRequestException(`Bilder aus diesem Ordner stecken noch in ${n} Modul(en) oder Entwürfen – erst danach löschen.`);
    await (await this.nextcloud.schoolNcClient(r)).remove([IMAGES, folder]);
    return { success: true };
  }

  /**
   * In eine andere Freigabe umziehen: prüfen, dann im Hintergrund Bilder/
   * (alle Lehrkraft- und Themen-Ordner) kopieren und erst danach umschalten.
   * Die Links bleiben gleich (sie enthalten die Kennung der Schule).
   */
  async startMove(user: any, input: any, appBase: string) {
    const schoolId = this.schoolOf(user);
    const r = await this.repo.findOne({ where: { schoolId } });
    if (!r?.shareToken || !r.verifiedAt) throw new BadRequestException('Erst eine Freigabe verbinden – umziehen geht nur von einer verbundenen aus.');
    if (this.moves.get(schoolId)?.running) throw new BadRequestException('Der Umzug läuft schon.');
    const share = parseNextcloudShare(input?.shareUrl);
    if (parseNextcloudBase(share.base) === r.baseUrl && share.token === r.shareToken) throw new BadRequestException('Das ist die bisherige Freigabe.');
    const password = String(input?.password || '');
    const target = await this.probe(input?.shareUrl, password);
    const job = { running: true, copied: 0, total: 0, from: this.shareLink(r) };
    this.moves.set(schoolId, job);
    void (async () => {
      try {
        const old = await this.nextcloud.schoolNcClient(r);
        const files: string[][] = [];
        for (const t of (await old.list([IMAGES])).filter((e) => e.isFolder && safePart(e.name))) {
          for (const s of (await old.list([IMAGES, t.name])).filter((e) => e.isFolder && safePart(e.name))) {
            for (const f of await old.list([IMAGES, t.name, s.name])) if (!f.isFolder && safePart(f.name)) files.push([t.name, s.name, f.name]);
          }
        }
        job.total = files.length;
        const made = new Set<string>();
        for (const [t, s, f] of files) {
          const file = await old.get([IMAGES, t, s, f]);
          if (file) {
            if (!made.has(`${t}/${s}`)) { await target.nc.ensureFolder([IMAGES, t, s]); made.add(`${t}/${s}`); }
            await target.nc.put([IMAGES, t, s, f], file.data, file.type.split(';')[0].trim() || 'application/octet-stream');
          }
          job.copied++;
        }
        Object.assign(r, {
          baseUrl: target.base, shareToken: target.token, davMode: target.mode, verifiedAt: new Date(), appBase,
          passwordSealed: password ? this.masterKey.sealSecret(password) : null,
          moveResult: { at: new Date().toISOString(), from: job.from, copied: job.copied },
        });
        await this.repo.save(r);
      } catch (err: any) {
        const moveResult: any = { at: new Date().toISOString(), from: job.from, copied: job.copied, error: String(err?.message || err) };
        await this.repo.update({ id: r.id }, { moveResult });
      } finally {
        this.moves.delete(schoolId);
      }
    })();
    return { success: true, message: 'Neue Freigabe geprüft – die Bilder werden jetzt hinüberkopiert. Erst danach schaltet die App um.' };
  }

  /** Für Tests: auf einen laufenden Umzug warten. */
  async waitForMove(schoolId: string) {
    while (this.moves.get(schoolId)?.running) await new Promise((res) => setTimeout(res, 5));
  }
}
