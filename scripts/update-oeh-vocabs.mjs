#!/usr/bin/env node
// Aktualisiert die mitgelieferten OpenEduHub-Vokabulare (Ebene 1 der
// Kategorien, siehe docs/kategorien.md):
//
//   src/categories/vocab/oeh-discipline.json          Fächer
//   src/categories/vocab/oeh-educational-context.json Bildungsstufen
//
// Quelle: https://github.com/openeduhub/oeh-metadata-vocabs (CC0-1.0), SKOS
// im Turtle-Format. Übernommen werden Kennung, URI und deutscher Name.
//
// Aufruf:  node scripts/update-oeh-vocabs.mjs
//
// Kennungen verschwinden dabei nie aus der Datenbank: Fällt bei OpenEduHub
// ein Eintrag weg, bleibt er hier stehen, bis jemand ihn bewusst entfernt –
// sonst verlören eingeordnete Lernthemen ihren Platz.

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'categories', 'vocab');
const RAW = 'https://raw.githubusercontent.com/openeduhub/oeh-metadata-vocabs/master';

const SOURCES = [
  { name: 'discipline', file: 'oeh-discipline.json', base: 'http://w3id.org/openeduhub/vocabs/discipline/' },
  { name: 'educationalContext', file: 'oeh-educational-context.json', base: 'http://w3id.org/openeduhub/vocabs/educationalContext/' },
];

/** Begriffe aus SKOS/Turtle: `<id> a skos:Concept ; … skos:prefLabel "…"@de …` */
function parse(ttl, base) {
  const out = [];
  for (const m of ttl.matchAll(/^<([^>]*)> a skos:Concept ;([\s\S]*?)\s\.\s*$/gm)) {
    const labels = [...m[2].matchAll(/skos:prefLabel\s+([^;]*);/g)].map((x) => x[1]).join(' ');
    const de = /"([^"]+)"@de/.exec(labels);
    out.push({ id: m[1], uri: base + m[1], label: de ? de[1] : m[1] });
  }
  return out;
}

for (const s of SOURCES) {
  const res = await fetch(`${RAW}/${s.name}.ttl`);
  if (!res.ok) throw new Error(`${s.name}: HTTP ${res.status}`);
  const fresh = parse(await res.text(), s.base);
  const path = join(DIR, s.file);
  const old = JSON.parse(readFileSync(path, 'utf8'));
  const byId = new Map(old.concepts.map((c) => [c.id, c]));
  for (const c of fresh) byId.set(c.id, c);
  const gone = old.concepts.filter((c) => !fresh.some((f) => f.id === c.id)).map((c) => c.label);
  writeFileSync(path, JSON.stringify({
    ...old,
    retrieved: new Date().toISOString().slice(0, 10),
    concepts: [...byId.values()],
  }, null, 1) + '\n');
  console.log(`${s.file}: ${fresh.length} Begriffe${gone.length ? `; bei OpenEduHub nicht mehr vorhanden (bleiben hier): ${gone.join(', ')}` : ''}`);
}
