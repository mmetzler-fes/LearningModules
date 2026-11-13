import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { loadBrowserModule } from '../core/browser-module';

/**
 * Quizze über die KI-Schnittstelle: welche Typen, ihr Format und die Prüfung – aus
 * demselben Code wie der KI-Prompt im Browser (ai-prompt.js, json-text.js, h5p-types.js),
 * damit es je Typ nur eine Beschreibung gibt.
 */

/** Zunächst nur automatisch bewertete Typen (auch für Klassenarbeiten). */
export const AI_QUIZ_TYPES = ['multipleChoice', 'trueFalse', 'fillInTheBlanks', 'dragTheWords', 'dragAndDrop'] as const;
export type AiQuizType = typeof AI_QUIZ_TYPES[number];
export const isAiQuizType = (t: unknown): t is AiQuizType => (AI_QUIZ_TYPES as readonly string[]).includes(String(t));

let defsCache: Record<string, any> | null = null;
/** H5P_TYPES aus h5p-types.js (ein klassisches Skript ohne export). */
export function h5pTypeDefs(): Record<string, any> {
  if (defsCache) return defsCache;
  const candidates = [
    path.resolve(__dirname, '../../src/renderer/js/h5p-types.js'),
    path.resolve(process.cwd(), 'src/renderer/js/h5p-types.js'),
    path.resolve(__dirname, '../renderer/js/h5p-types.js'),
  ];
  const file = candidates.find((f) => fs.existsSync(f) && /^const H5P_TYPES = /m.test(fs.readFileSync(f, 'utf-8')));
  if (!file) return {};
  const sandbox: { __out?: Record<string, any> } = {};
  vm.runInNewContext(`${fs.readFileSync(file, 'utf-8')}\n;__out = H5P_TYPES;`, sandbox, { filename: file });
  defsCache = sandbox.__out || {};
  return defsCache;
}

/** Name je Typ, für die Kurzliste in der Anleitung. */
export const quizTypeName = (t: string) => h5pTypeDefs()[t]?.name || t;

/** Format (Felder, Regeln, Beispiel) der gewünschten Typen als Markdown. */
export function quizFormat(types: string[]): string {
  const wanted = types.filter(isAiQuizType);
  const { describeQuizTypes } = loadBrowserModule<{ describeQuizTypes: (t: string[], defs: Record<string, any>) => string[] }>('ai-prompt.js');
  return [
    '# Quiz-Format (LearningModules)',
    'Ein Quiz ist ein Modul `{ "type": "<Typ>", "title": "…", "content": { … } }`. Hier steht je Typ, was in "content" gehört.',
    ...describeQuizTypes(wanted, h5pTypeDefs()),
  ].join('\n');
}

/** Was an einem Quiz fehlt, damit es lösbar ist (leer = in Ordnung). */
export function quizProblems(type: string, content: unknown): string[] {
  if (!isAiQuizType(type)) return [`type: erlaubt sind ${AI_QUIZ_TYPES.join(', ')}`];
  if (!content || typeof content !== 'object' || Array.isArray(content)) return ['content muss ein Objekt sein'];
  const { contentIssues } = loadBrowserModule<{ contentIssues: (t: string, c: unknown) => string[] }>('json-text.js');
  return contentIssues(type, content);
}
