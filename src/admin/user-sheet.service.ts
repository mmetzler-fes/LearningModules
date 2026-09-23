import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../core/entities/user.entity';
import { TeacherGroup } from '../core/entities/teacher-group.entity';
import { AuthService } from '../auth/auth.service';
import { writeOds, readOds } from '../core/interchange/ods/ods';

/** Feste Spalten; alles Weitere in der Kopfzeile gilt als Gruppenspalte. */
const COL_EMAIL = 'email';
const COL_NAME = 'name';
const COL_ROLE = 'rolle';
const COL_PENDING = 'initialpasswort_offen';
const COL_PASSWORD = 'passwort';
const FIXED = [COL_EMAIL, COL_NAME, COL_ROLE, COL_PENDING, COL_PASSWORD];

/** Was in einer Gruppenspalte als Häkchen zählt. */
const TICKS = new Set(['x', 'X', 'ja', 'JA', 'Ja', 'j', 'yes', '1', 'true', '✓', '✔']);

/**
 * Benutzerliste als Tabelle aus- und wieder einlesen.
 *
 * Der Export nennt **kein** Passwort – im Server liegt nur der Hash, das
 * Klartextpasswort gibt es genau einmal beim Anlegen. Die Datei ist deshalb
 * harmlos und dient der Übersicht und der Gruppenpflege.
 *
 * Die Zugangsdaten entstehen dort, wo die Passwörter tatsächlich existieren:
 * beim Import. Legt er Konten an, kommt eine zweite Tabelle mit den
 * Initialpasswörtern zurück – einmalig, zum Ausdrucken und Verteilen. Ohne
 * Mailversand ist das der Weg zum neuen Kollegen.
 */
@Injectable()
export class UserSheetService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(TeacherGroup) private readonly groupRepo: Repository<TeacherGroup>,
    private readonly authService: AuthService,
  ) {}

  // ---- Export ----

  async exportUsers(): Promise<Buffer> {
    const users = (await this.userRepo.find()).filter((u) => u.role === 'teacher' || u.role === 'admin');
    users.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, 'de'));

    const groups = await this.groupRepo.find();
    groups.sort((a, b) => a.name.localeCompare(b.name, 'de'));

    const header = [COL_EMAIL, COL_NAME, COL_ROLE, COL_PENDING, ...groups.map((g) => g.name)];
    const rows = users.map((u) => [
      u.email,
      u.displayName || '',
      u.role === 'admin' ? 'Admin' : 'Lehrer',
      u.mustChangePassword ? 'ja' : 'nein',
      ...groups.map((g) => ((g.memberIds || []).includes(u.id) ? 'x' : '')),
    ]);

    return writeOds('Benutzer', [header, ...rows]);
  }

  // ---- Import ----

  /**
   * Liest die Tabelle und gleicht sie ab.
   *
   * Zwei Regeln, die den Unterschied machen:
   *
   * 1. **Nur Gruppen, die als Spalte vorkommen, werden verändert.** Fehlt
   *    eine Gruppe in der Datei, bleibt die Mitgliedschaft unberührt. Sonst
   *    würde eine gekürzte Tabelle stillschweigend Zugehörigkeiten löschen.
   * 2. **Bestehende Konten behalten Name und Rolle.** Wer umbenennen oder
   *    zum Admin machen will, tut das bewusst in der Benutzerverwaltung –
   *    nicht als Nebenwirkung einer hochgeladenen Datei.
   */
  async importUsers(buffer: Buffer) {
    let table: string[][];
    try {
      table = readOds(buffer);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
    if (table.length < 2) {
      throw new BadRequestException('Die Tabelle enthält keine Datenzeilen (Kopfzeile plus mindestens eine Zeile erwartet).');
    }

    const header = table[0].map((h) => (h || '').trim());
    const lower = header.map((h) => h.toLowerCase());
    const emailCol = lower.indexOf(COL_EMAIL);
    if (emailCol === -1) {
      throw new BadRequestException(`In der Kopfzeile fehlt die Spalte "${COL_EMAIL}".`);
    }

    const groups = await this.groupRepo.find();
    const byName = new Map(groups.map((g) => [g.name.toLowerCase(), g]));

    // Gruppenspalten erkennen; alles Unbekannte wird gemeldet statt still
    // übergangen – meist ist es ein Tippfehler im Gruppennamen.
    const groupCols: Array<{ index: number; group: TeacherGroup }> = [];
    const unknownColumns: string[] = [];
    header.forEach((name, i) => {
      if (!name || FIXED.includes(lower[i])) return;
      const group = byName.get(name.toLowerCase());
      if (group) groupCols.push({ index: i, group });
      else unknownColumns.push(name);
    });

    const col = (row: string[], i: number) => (i >= 0 && i < row.length ? (row[i] || '').trim() : '');
    const nameCol = lower.indexOf(COL_NAME);
    const roleCol = lower.indexOf(COL_ROLE);
    const pwCol = lower.indexOf(COL_PASSWORD);

    const users = await this.userRepo.find();
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

    const created: Array<{ email: string; displayName: string; role: string }> = [];
    const credentials: Array<{ email: string; displayName: string; password: string }> = [];
    const groupsUpdated: Array<{ email: string; added: string[]; removed: string[] }> = [];
    const skipped: Array<{ row: number; email: string; reason: string }> = [];

    // Mitgliedschaften sammeln und am Ende in einem Rutsch speichern –
    // sonst schriebe jede Zeile jede betroffene Gruppe neu.
    const members = new Map<string, Set<string>>();
    for (const g of groups) members.set(g.id, new Set(g.memberIds || []));

    for (let r = 1; r < table.length; r++) {
      const row = table[r];
      const rowNo = r + 1; // wie in der Tabellenkalkulation gezählt
      const email = col(row, emailCol).toLowerCase();
      if (!email) continue; // Leerzeilen sind kein Fehler

      let user: User | undefined = byEmail.get(email);

      if (!user) {
        const role = /admin/i.test(col(row, roleCol)) ? 'admin' : 'teacher';
        const displayName = col(row, nameCol) || email;
        try {
          const res = await this.authService.createUser({
            email,
            role: role as any,
            displayName,
            password: col(row, pwCol) || undefined,
          });
          const fresh = await this.userRepo.findOne({ where: { id: res.id } });
          if (!fresh) throw new Error('Konto wurde nicht gefunden.');
          user = fresh;
          byEmail.set(email, user);
          created.push({ email, displayName, role });
          // Nur wenn der Server das Passwort erzeugt hat und keine Mail
          // rausging, muss es der Admin auf Papier bekommen.
          if (res.initialPassword) {
            credentials.push({ email, displayName, password: res.initialPassword });
          }
        } catch (err: any) {
          skipped.push({ row: rowNo, email, reason: err?.message || 'Konto konnte nicht angelegt werden.' });
          continue;
        }
      }

      const added: string[] = [];
      const removed: string[] = [];
      for (const { index, group } of groupCols) {
        const set = members.get(group.id)!;
        const ticked = TICKS.has(col(row, index));
        if (ticked && !set.has(user.id)) { set.add(user.id); added.push(group.name); }
        if (!ticked && set.has(user.id)) { set.delete(user.id); removed.push(group.name); }
      }
      if (added.length || removed.length) groupsUpdated.push({ email, added, removed });
    }

    // Nur geänderte Gruppen zurückschreiben.
    const touched = groups.filter((g) => {
      const before = new Set(g.memberIds || []);
      const after = members.get(g.id)!;
      return before.size !== after.size || [...after].some((id) => !before.has(id));
    });
    for (const g of touched) g.memberIds = [...members.get(g.id)!];
    if (touched.length) await this.groupRepo.save(touched);

    return {
      created,
      groupsUpdated,
      skipped,
      unknownColumns,
      groupColumns: groupCols.map((c) => c.group.name),
      credentialsCount: credentials.length,
      // Einmalig und nur hier: danach steht im Server wieder nur der Hash.
      credentialsFile: credentials.length ? this.credentialsOds(credentials).toString('base64') : null,
    };
  }

  /** Die Zettel-Vorlage: eine Zeile je neuem Konto. */
  private credentialsOds(rows: Array<{ email: string; displayName: string; password: string }>): Buffer {
    return writeOds('Zugangsdaten', [
      ['name', 'email', 'initialpasswort', 'hinweis'],
      ...rows.map((r) => [
        r.displayName,
        r.email,
        r.password,
        'Beim ersten Anmelden muss das Passwort geändert werden.',
      ]),
    ]);
  }
}
