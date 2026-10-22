#!/usr/bin/env node
// Verlorene Bild-Links wiederherstellen: Die Bilder liegen noch in der
// Nextcloud (Bilder/<Thema>/bild-….png), nur der Link im Modul fehlt – etwa
// weil ein Speichern während eines Server-Neustarts scheiterte oder ein
// Hintergrundlauf einen älteren Stand zurückschrieb.
//
// Quellen für den früheren Stand:
//   - die Backups der Lehrkraft (Backups/*.json, auch ältere Stände aus den
//     „Versionen“ der Nextcloud) – Zuordnung über die Modul-ID
//   - die Quellen der Dokumente (Arbeitsblätter/**/_Quellen/*.yaml) –
//     Zuordnung über den Titel
//
// Aufruf (gegen eine KOPIE der Datenbank, bei gestoppter App gezogen –
// database.sqlite und, falls vorhanden, -wal und -shm daneben):
//
//   node scripts/restore-image-links.mjs --db kopie/database.sqlite \
//        --sources ~/Nextcloud/…/LehrerBackup --images ~/Nextcloud/…/LehrerBackup/Bilder
//
// Ohne --apply wird nur berichtet. Mit --apply werden die Module geändert,
// bei denen sich die Quelle vom jetzigen Stand nur durch Bilder unterscheidet
// („sicher“). Module mit weiteren Unterschieden nur einzeln und ausdrücklich:
// --force <Modul-ID> (mehrfach möglich) übernimmt dort den ganzen Inhalt der
// Quelle. Vor dem Schreiben entsteht <db>.before-image-restore.
//
// Danach: App stoppen, database.sqlite zurückkopieren, alte -wal und -shm
// auf dem Server löschen, App starten.

import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');
const yaml = require('js-yaml');

// ---- Argumente ----

const args = process.argv.slice(2);
const opt = { sources: [], force: new Set(), apply: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--db') opt.db = args[++i];
  else if (a === '--sources') opt.sources.push(args[++i]);
  else if (a === '--images') opt.images = args[++i];
  else if (a === '--force') opt.force.add(args[++i]);
  else if (a === '--apply') opt.apply = true;
  else { console.error(`Unbekannt: ${a}`); process.exit(2); }
}
if (!opt.db || !opt.sources.length) {
  console.error('Aufruf: node scripts/restore-image-links.mjs --db <database.sqlite> --sources <Ordner> [--sources …] [--images <Bilder-Ordner>] [--apply] [--force <Modul-ID>]');
  process.exit(2);
}

// ---- Bild-Links erkennen ----

/** …/api/nextcloud/files|school/<Eintrag>/<Thema>/<Datei> und …/sch/<Schule>/<Lehrkraft>/<Thema>/<Datei> */
const SEG = `[^/?#"'\\s<>\\\\]+`;
const LINK = new RegExp(`(?:https?://[^\\s"'<>]*?)?/api/nextcloud/(?:(?:files|school)/[0-9a-f-]{36}|sch/[0-9a-f-]{36}/(${SEG}))/(${SEG})/(${SEG}\\.(?:png|jpe?g|gif|webp|svg))`, 'gi');
const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };

/** Bild-Links in einem Inhalt: Schlüssel = Pfad unter Bilder/ (bei Schul-Nextcloud mit Lehrkraft-Ordner). */
function refsOf(value) {
  const out = new Map();
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  for (const m of text.matchAll(LINK)) {
    const key = [m[1], m[2], m[3]].filter(Boolean).map(dec).join('/');
    if (!out.has(key)) out.set(key, m[0]);
  }
  return out;
}

/**
 * Inhalt ohne Bilder – um zu sehen, ob sich Quelle und jetziger Stand nur
 * darin unterscheiden: Links und <img> mit Links raus, Bild-Bausteine
 * (type: image) raus, danach leere Felder weg.
 */
function withoutImages(value) {
  if (typeof value === 'string') {
    // Auch <img> ohne Quelle – so sieht ein Bild aus, dessen Link geleert wurde.
    return value.replace(/<img\b[^>]*\/api\/nextcloud\/[^>]*>/gi, '').replace(/<img\b[^>]*\bsrc=(["'])\1[^>]*>/gi, '').replace(LINK, '').trim();
  }
  if (Array.isArray(value)) {
    return value.filter((v) => !(v && typeof v === 'object' && v.type === 'image')).map(withoutImages).filter((v) => !isEmpty(v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = withoutImages(value[k]);
      if (!isEmpty(v)) out[k] = v;
    }
    return out;
  }
  return value;
}
const isEmpty = (v) => v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const same = (a, b) => JSON.stringify(withoutImages(a)) === JSON.stringify(withoutImages(b));

const parse = (text) => { try { return typeof text === 'string' ? JSON.parse(text) : text; } catch { return text; } };

// ---- Quellen einlesen ----

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Module in einer Backup-Datei (Format des JSON-Exports, auch verschachtelt). */
function modulesInBackup(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => modulesInBackup(v, out));
  else if (value && typeof value === 'object') {
    if (typeof value.id === 'string' && 'content' in value && 'type' in value) out.push(value);
    for (const v of Object.values(value)) if (v && typeof v === 'object') modulesInBackup(v, out);
  }
  return out;
}

const byId = new Map();     // Modul-ID → [{ file, content }]
const byTitle = new Map();  // Dokument-Titel → [{ file, spec }]
let sourceFiles = 0;
for (const dir of opt.sources) {
  for (const file of walk(dir)) {
    if (/\.json$/i.test(file)) {
      let data;
      try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
      const mods = modulesInBackup(data);
      if (!mods.length) continue;
      sourceFiles++;
      for (const m of mods) {
        if (!byId.has(m.id)) byId.set(m.id, []);
        byId.get(m.id).push({ file, content: parse(m.content) });
      }
    } else if (/\.ya?ml$/i.test(file) && /_Quellen/.test(file)) {
      let data;
      try { data = yaml.load(readFileSync(file, 'utf8')); } catch { continue; }
      if (!data || typeof data !== 'object' || !data.titel) continue;
      sourceFiles++;
      const { titel, ...spec } = data;
      if (!byTitle.has(titel)) byTitle.set(titel, []);
      byTitle.get(titel).push({ file, spec });
    }
  }
}

// ---- Datenbank ----

const db = new sqlite3.Database(opt.db, opt.apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
const all = (sql, p = []) => new Promise((ok, ko) => db.all(sql, p, (e, r) => (e ? ko(e) : ok(r))));
const run = (sql, p = []) => new Promise((ok, ko) => db.run(sql, p, function (e) { return e ? ko(e) : ok(this.changes); }));

const modules = (await all('SELECT m.id, m.title, m.type, m.content, m.updatedAt, t.title AS topic FROM modules m LEFT JOIN topics t ON t.id = m.topicId'))
  .map((m) => ({ ...m, content: parse(m.content) }));
const drafts = (await all('SELECT id, moduleId, title, data, updatedAt FROM module_drafts')).map((d) => ({ ...d, data: parse(d.data) }));

const exists = (key) => !opt.images || existsSync(join(opt.images, ...key.split('/')));

// Was heute verlinkt ist (Module und Entwürfe) – für die verwaisten Bilder.
const linkedNow = new Set();
for (const m of modules) for (const k of refsOf(m.content).keys()) linkedNow.add(k);
const inDrafts = new Map();
for (const d of drafts) for (const k of refsOf(d.data).keys()) if (!inDrafts.has(k)) inDrafts.set(k, d);

// ---- Abgleich ----

const docsByTitle = new Map();
for (const m of modules) {
  if (m.content && typeof m.content === 'object' && m.content.spec) {
    if (!docsByTitle.has(m.title)) docsByTitle.set(m.title, []);
    docsByTitle.get(m.title).push(m);
  }
}

const findings = [];
const restoredKeys = new Set();
for (const m of modules) {
  const now = refsOf(m.content);
  const candidates = [];
  for (const s of byId.get(m.id) || []) candidates.push({ file: s.file, content: s.content });
  // Dokumente: Quelle über den Titel – nur, wenn er eindeutig ist.
  if (m.content?.spec && (docsByTitle.get(m.title) || []).length === 1) {
    for (const s of byTitle.get(m.title) || []) candidates.push({ file: s.file, content: { ...m.content, spec: s.spec } });
  }
  let best = null;
  for (const c of candidates) {
    const missing = [...refsOf(c.content).keys()].filter((k) => !now.has(k) && exists(k));
    if (!missing.length) continue;
    const safe = same(c.content, m.content);
    // Lieber sicher als viel; bei Gleichstand die Quelle mit den meisten Bildern.
    if (!best || (safe && !best.safe) || (safe === best.safe && missing.length > best.missing.length)) best = { ...c, missing, safe };
  }
  if (!best) continue;
  const draft = drafts.find((d) => d.moduleId === m.id && best.missing.every((k) => refsOf(d.data).has(k)));
  findings.push({ m, ...best, draft });
  best.missing.forEach((k) => restoredKeys.add(k));
}

// ---- Bericht ----

const rel = (f) => { for (const s of opt.sources) if (f.startsWith(s)) return f.slice(s.length).replace(/^\/+/, ''); return basename(f); };
console.log(`Quellen: ${sourceFiles} Dateien, ${byId.size} Module, ${byTitle.size} Dokumente`);
console.log(`Datenbank: ${modules.length} Module, ${drafts.length} Entwürfe\n`);

const safe = findings.filter((f) => f.safe);
const manual = findings.filter((f) => !f.safe);
const show = (f) => {
  console.log(`  ${f.m.topic || '(ohne Thema)'} › ${f.m.title}   [${f.m.id}, ${f.m.type}, geändert ${f.m.updatedAt}]`);
  console.log(`    Quelle: ${rel(f.file)}`);
  for (const k of f.missing) console.log(`    fehlt:  ${k}`);
  if (f.draft) console.log(`    ➜ Entwurf vom ${f.draft.updatedAt} enthält diese Bilder – am besten im Editor wiederherstellen.`);
};
console.log(`== Sicher wiederherstellbar (${safe.length}) – Quelle unterscheidet sich nur durch die Bilder`);
safe.forEach(show);
console.log(`\n== Von Hand prüfen (${manual.length}) – Quelle hat auch sonst einen anderen Stand; --force <ID> übernimmt sie ganz`);
manual.forEach(show);

const orphans = [];
if (opt.images) {
  for (const file of walk(opt.images)) {
    const key = file.slice(opt.images.replace(/\/+$/, '').length + 1);
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(key) || linkedNow.has(key) || restoredKeys.has(key)) continue;
    orphans.push({ key, at: statSync(file).mtime });
  }
  // Nur noch in einem Entwurf: Das Speichern scheiterte – der Entwurf hat den Stand.
  const onlyDraft = orphans.filter((o) => inDrafts.has(o.key));
  console.log(`\n== Bilder nur in einem Entwurf (${onlyDraft.length}) – Modul im Editor öffnen, „Wiederherstellen“, speichern`);
  for (const o of onlyDraft) {
    const d = inDrafts.get(o.key);
    console.log(`  ${o.key}   ➜ Entwurf „${d.title}“ (${d.moduleId || 'neues Modul'}, ${d.updatedAt})`);
  }
  orphans.splice(0, orphans.length, ...orphans.filter((o) => !inDrafts.has(o.key)));
  console.log(`\n== Bilder ohne Link und ohne Quelle (${orphans.length}) – nur von Hand wieder einzufügen`);
  for (const o of orphans.sort((a, b) => a.key.localeCompare(b.key, 'de'))) console.log(`  ${o.at.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}  ${o.key}`);
}

// ---- Schreiben ----

if (!opt.apply) {
  console.log('\nNur Bericht – nichts geändert. Mit --apply schreiben.');
  db.close();
} else {
  const todo = findings.filter((f) => f.safe || opt.force.has(f.m.id));
  for (const id of opt.force) if (!findings.some((f) => f.m.id === id)) console.log(`\n--force ${id}: kein Modul mit fehlenden Bildern – übergangen.`);
  if (!todo.length) {
    console.log('\nNichts zu schreiben.');
  } else {
    // Alles, was in -wal steht, in die Datei – dann ist die Sicherung vollständig.
    await run('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => undefined);
    copyFileSync(opt.db, `${opt.db}.before-image-restore`);
    const stamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
    for (const f of todo) {
      await run('UPDATE modules SET content = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(f.content), stamp, f.m.id]);
    }
    await run('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => undefined);
    console.log(`\n${todo.length} Module geschrieben. Vorher-Stand: ${opt.db}.before-image-restore`);
  }
  db.close();
}
