#!/usr/bin/env node
// Quizzy-Zuordnungsquiz (JSON) → LearningModules-Thema zum Einlesen über
// "📥 Thema importieren".
//
// Quizzy zeigt alle Paare (Begriff → Erklärung) gleichzeitig, in wechselnder
// Reihenfolge, und lässt sie zuordnen. Daraus wird je Quiz eine Drag-and-Drop-
// Aufgabe ohne Hintergrundbild: die Begriffe als Zonen, die Erklärungen zum
// Hineinziehen, "Reihenfolge mischen" eingeschaltet.
//
// Aufruf:
//   node scripts/quizzy-to-learningmodules.mjs quiz1.json [quiz2.json …]
//        [--ein-thema "Titel"]   alle Quizze als Aufgaben eines Themas
//        [--paket 6]             höchstens 6 Paare je Aufgabe (sonst alle)
//        [--ausgabe ordner]      Zielordner (sonst neben der Eingabedatei)
//
// Ergebnis: <name>.learningmodules.json (bzw. <Titel>.learningmodules.json).

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

function usage(msg) {
  if (msg) console.error(`Fehler: ${msg}\n`);
  console.error('Aufruf: node scripts/quizzy-to-learningmodules.mjs quiz.json [weitere.json …] [--ein-thema "Titel"] [--paket N] [--ausgabe ordner]');
  process.exit(1);
}

// ---- Argumente ----
const args = process.argv.slice(2);
const files = [];
let combinedTitle = null;
let chunk = 0;
let outDir = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ein-thema') combinedTitle = args[++i] || usage('--ein-thema braucht einen Titel');
  else if (a === '--paket') {
    chunk = Number(args[++i]);
    if (!Number.isInteger(chunk) || chunk < 2) usage('--paket braucht eine Zahl ab 2');
  } else if (a === '--ausgabe') outDir = args[++i] || usage('--ausgabe braucht einen Ordner');
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('--')) usage(`unbekannte Option ${a}`);
  else files.push(a);
}
if (!files.length) usage('keine Eingabedatei');

// ---- Lesen ----
const pick = (obj, keys) => keys.map((k) => obj?.[k]).find((v) => typeof v === 'string' && v.trim()) || '';

/** Ein oder mehrere Quizze aus einer Datei: { title, pairs: [{ term, text }] }. */
function readQuizzes(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`${file}: kein gültiges JSON (${e.message})`);
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.quizzes) ? data.quizzes : [data];
  return list.map((q, n) => {
    const items = Array.isArray(q?.items) ? q.items : Array.isArray(q?.pairs) ? q.pairs : [];
    const pairs = items
      .map((it) => ({
        term: pick(it, ['query', 'question', 'term', 'front', 'begriff']).trim(),
        text: pick(it, ['answer', 'definition', 'back', 'erklaerung']).trim(),
      }))
      .filter((p) => p.term && p.text);
    const title = pick(q, ['quizname', 'name', 'title']).trim()
      || `${basename(file).replace(/\.json$/i, '')}${list.length > 1 ? ` ${n + 1}` : ''}`;
    return { title, pairs };
  }).filter((q) => q.pairs.length);
}

// ---- Umwandeln ----

/** Gleiche Begriffe würden die Zuordnung vermischen – durchnummerieren. */
function uniqueTerms(pairs) {
  const seen = new Map();
  return pairs.map((p) => {
    const n = (seen.get(p.term) || 0) + 1;
    seen.set(p.term, n);
    return n > 1 ? { ...p, term: `${p.term} (${n})` } : p;
  });
}

function dragAndDrop(title, pairs) {
  const unique = uniqueTerms(pairs);
  return {
    type: 'dragAndDrop',
    title,
    description: '',
    content: {
      taskDescription: '<p>Ordne jedem Begriff die passende Erklärung zu.</p>',
      backgroundImage: '',
      randomOrder: true,
      dropZones: unique.map((p) => ({
        label: p.term, correctDraggable: p.text, group: '', x: 0, y: 0, width: 100, height: 10,
      })),
      draggables: unique.map((p) => ({ text: p.text, correctZone: p.term, multiple: false })),
    },
  };
}

function modulesOf(quiz) {
  if (!chunk || quiz.pairs.length <= chunk) return [dragAndDrop(quiz.title, quiz.pairs)];
  const parts = Math.ceil(quiz.pairs.length / chunk);
  const out = [];
  for (let i = 0; i < parts; i++) {
    out.push(dragAndDrop(`${quiz.title} (${i + 1}/${parts})`, quiz.pairs.slice(i * chunk, (i + 1) * chunk)));
  }
  return out;
}

const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'quizzy';

function write(dir, title, modules, description) {
  const topic = {
    topic: {
      title,
      description,
      modules: modules.map((m, i) => ({ ...m, title: `${i + 1}. ${m.title}`, orderIndex: i })),
    },
  };
  const target = join(dir, `${safeName(title)}.learningmodules.json`);
  writeFileSync(target, JSON.stringify(topic, null, 2) + '\n');
  const pairs = modules.reduce((n, m) => n + m.content.dropZones.length, 0);
  console.log(`✓ ${target}  (${modules.length} Aufgabe${modules.length === 1 ? '' : 'n'}, ${pairs} Paare)`);
}

let failed = false;
const all = [];
for (const file of files) {
  try {
    const quizzes = readQuizzes(file);
    if (!quizzes.length) throw new Error(`${file}: keine Paare gefunden (erwartet: "items" mit "query" und "answer")`);
    if (combinedTitle) {
      all.push(...quizzes.flatMap(modulesOf));
    } else {
      for (const q of quizzes) write(outDir || dirname(file), q.title, modulesOf(q), 'Aus Quizzy übernommen.');
    }
  } catch (e) {
    failed = true;
    console.error(`✗ ${e.message}`);
  }
}
if (combinedTitle && all.length) write(outDir || dirname(files[0]), combinedTitle, all, 'Aus Quizzy übernommen.');
if (failed) process.exit(2);
