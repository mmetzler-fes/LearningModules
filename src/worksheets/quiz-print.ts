import { loadBrowserModule } from '../core/browser-module';

/**
 * Druckfassung eines Quiz im Arbeitsblatt: unter dem QR-Code dasselbe Quiz zum
 * Ausfüllen auf Papier (oder in GoodNotes) – Kästchen, Lücken, Wortkasten,
 * nummerierte Felder auf dem Bild. Die Antworten stehen in einem Lösungsblock
 * (nur im Lösungsblatt sichtbar).
 *
 * In Lösungen stehen nur Text und Listen: Bilder und Tabellen darin blendet der
 * Renderer im Arbeitsblatt nicht sicher aus.
 */

export type QuizPrintMode = 'print' | 'qr';
export const QUIZ_PRINT_MODES: QuizPrintMode[] = ['print', 'qr'];

export interface PrintQuiz {
  id: string;
  type: string;
  title?: string;
  content: any;
  children?: PrintQuiz[];
}

/** Größe des Hintergrundbilds (Drag and Drop) – ohne sie stehen die Zonen als Tabelle da. */
export type ImageSizeOf = (src: string) => { width: number; height: number } | null;

type Block = Record<string, any>;

const GAP = '__________';

let seeded: ((n: number, key: string) => number[]) | null = null;
/** Dieselbe feste Mischung wie im Browser (Multiple Choice). */
function seededOrder(n: number, key: string): number[] {
  if (!seeded) seeded = loadBrowserModule<{ seededOrder: (n: number, key: string) => number[] }>('../lm-editor/src/modules/seeded-order.js').seededOrder;
  return seeded(n, key);
}

/** HTML aus dem Quiz-Editor → Text mit Zeilenumbrüchen. */
export function plainText(html: unknown): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text ohne Auszeichnung: Sternchen & Co. bleiben Zeichen (DocSpec-Inline-Syntax). */
export function escInline(text: string): string {
  return text.replace(/[\\*`[\]^~+{}$]/g, (c) => `\\${c}`);
}

/** `*a/b*`-Stellen im Text: Teile abwechselnd Text und Marke (ohne Sternchen). */
function splitMarks(text: string): Array<{ text: string; mark: boolean }> {
  return text.split(/(\*[^*]+\*)/g).filter((p) => p !== '').map((p) => {
    const m = /^\*([^*]+)\*$/.exec(p);
    return m ? { text: m[1], mark: true } : { text: p, mark: false };
  });
}

/** Text mit Lücken (Arbeitsblatt) bzw. mit den Antworten unterstrichen (Lösung – dort ist alles fett). */
function gapText(text: string, sep: RegExp): { student: string; solution: string } {
  let student = '';
  let solution = '';
  for (const p of splitMarks(text)) {
    if (!p.mark) { student += escInline(p.text); solution += escInline(p.text); continue; }
    student += GAP;
    solution += `++${escInline(p.text.split(sep)[0].trim())}++`;
  }
  return { student, solution };
}

const textBlock = (text: string): Block => ({ type: 'text', text });
const solution = (blocks: Block[]): Block => ({ type: 'solution', blocks });
const imageOf = (src: unknown): Block[] => (typeof src === 'string' && src.trim() ? [{ type: 'image', src: src.trim(), width: '8cm' }] : []);
const descOf = (html: unknown): Block[] => { const t = plainText(html); return t ? [textBlock(escInline(t))] : []; };

function multipleChoice(q: PrintQuiz): Block[] | null {
  const c = q.content || {};
  const answers = (Array.isArray(c.answers) ? c.answers : []).filter((a: any) => plainText(a?.text));
  if (!answers.length) return null;
  const order = c.randomAnswers === false ? answers.map((_: any, i: number) => i)
    : seededOrder(answers.length, `|${q.id}|${c.question || ''}`);
  const right = order.filter((i: number) => answers[i].correct).map((i: number) => escInline(plainText(answers[i].text)));
  return [
    ...imageOf(c.imageUrl),
    textBlock(`**${escInline(plainText(c.question) || q.title || 'Frage')}**${c.singleAnswer === false ? ' (mehrere Antworten möglich)' : ''}`),
    { type: 'list', marker: 'check', items: order.map((i: number) => escInline(plainText(answers[i].text))) },
    solution([textBlock(`Richtig: ${right.join(' · ') || '–'}`)]),
  ];
}

function trueFalse(q: PrintQuiz): Block[] | null {
  const c = q.content || {};
  const qs = (Array.isArray(c.questions) ? c.questions : []).filter((x: any) => plainText(x?.question));
  if (!qs.length) return null;
  return [
    ...imageOf(c.imageUrl),
    { type: 'table', header: ['Aussage', 'wahr', 'falsch'], widths: ['', '1.6cm', '1.6cm'],
      rows: qs.map((x: any, i: number) => [`${i + 1}. ${escInline(plainText(x.question))}`, { text: '☐', align: 'center' }, { text: '☐', align: 'center' }]) },
    solution([{ type: 'list', items: qs.map((x: any, i: number) => `${i + 1}. ${String(x.correctAnswer) === 'true' ? 'wahr' : 'falsch'}`) }]),
  ];
}

function fillInTheBlanks(q: PrintQuiz): Block[] | null {
  const c = q.content || {};
  const lines = (Array.isArray(c.questions) ? c.questions : []).map((x: any) => plainText(x?.text)).filter(Boolean);
  if (!lines.length) return null;
  const done = lines.map((l: string) => gapText(l, /\//));
  return [
    ...descOf(c.taskDescription),
    ...imageOf(c.imageUrl),
    ...done.map((d: { student: string }) => ({ ...textBlock(d.student), lineHeight: 2 })),
    solution(done.map((d: { solution: string }) => textBlock(d.solution))),
  ];
}

function dragTheWords(q: PrintQuiz): Block[] | null {
  const c = q.content || {};
  const text = plainText(c.textField);
  const words = splitMarks(text).filter((p) => p.mark).map((p) => p.text.split('|')[0].trim());
  if (!words.length) return null;
  const extra = splitMarks(plainText(c.distractors)).filter((p) => p.mark).map((p) => p.text.trim());
  const bank = [...words, ...extra];
  const order = seededOrder(bank.length, `|${q.id}|bank`);
  const done = gapText(text, /\|/);
  return [
    ...descOf(c.taskDescription),
    ...imageOf(c.imageUrl),
    { type: 'box', blocks: [textBlock(order.map((i) => escInline(bank[i])).join('   ·   '))] },
    ...done.student.split('\n').map((l) => ({ ...textBlock(l || ' '), lineHeight: 2 })),
    solution(done.solution.split('\n').filter(Boolean).map(textBlock)),
  ];
}

function markTheWords(q: PrintQuiz): Block[] | null {
  const c = q.content || {};
  const text = plainText(c.textField);
  const parts = splitMarks(text);
  if (!parts.some((p) => p.mark)) return null;
  const student = parts.map((p) => escInline(p.text)).join('');
  const sol = parts.map((p) => (p.mark ? `++${escInline(p.text)}++` : escInline(p.text))).join('');
  return [
    ...(plainText(c.taskDescription) ? descOf(c.taskDescription) : [textBlock('Markiere die passenden Wörter.')]),
    ...imageOf(c.imageUrl),
    ...student.split('\n').map((l) => textBlock(l || ' ')),
    solution(sol.split('\n').filter(Boolean).map(textBlock)),
  ];
}

const clamp = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || 0));

function dragAndDrop(q: PrintQuiz, sizeOf: ImageSizeOf): Block[] | null {
  const c = q.content || {};
  const zones = (Array.isArray(c.dropZones) ? c.dropZones : []).filter((z: any) => z && String(z.label ?? '').trim());
  const drags = (Array.isArray(c.draggables) ? c.draggables : []).filter((d: any) => d && String(d.text ?? '').trim());
  if (!zones.length || !drags.length) return null;
  const answerOf = (z: any) => {
    const hits = drags.filter((d: any) => d.correctZone === z.label).map((d: any) => plainText(d.text));
    return hits.length ? hits.join(', ') : plainText(z.correctDraggable) || '–';
  };
  const words = [...new Set(drags.map((d: any) => plainText(d.text)))] as string[];
  const order = seededOrder(words.length, `|${q.id}|bank`);
  const bank: Block = { type: 'box', blocks: [textBlock(order.map((i) => escInline(words[i])).join('   ·   '))] };

  const bg = typeof c.backgroundImage === 'string' ? c.backgroundImage.trim() : '';
  const size = bg ? sizeOf(bg) : null;
  const positioned = zones.every((z: any) => [z.x, z.y, z.width, z.height].every((v) => Number.isFinite(Number(v))));
  if (bg && size && size.width > 0 && positioned) {
    // Auf dem Bild: nummerierte, leere Felder an den Stellen der Zonen.
    const ratio = clamp(size.height / size.width, 0.05, 20);
    const items: Block[] = [{ src: bg, x: 0, y: 0, w: 100, h: 100 }];
    zones.forEach((z: any, i: number) => {
      const x = clamp(z.x, 0, 99.5);
      const y = clamp(z.y, 0, 99.5);
      items.push({ text: String(i + 1), size: 7, align: 'left', border: true, fill: 'weiss',
        x, y, w: clamp(z.width, 0.5, 100 - x), h: clamp(z.height, 0.5, 100 - y) });
    });
    return [
      ...descOf(c.taskDescription),
      textBlock('Trage die Begriffe in die nummerierten Felder ein:'),
      bank,
      { type: 'group', ratio, width: '16cm', items },
      solution([{ type: 'list', items: zones.map((z: any, i: number) => `${i + 1}: ${escInline(answerOf(z))}`) }]),
    ];
  }
  // Ohne Bild (Paare, Gruppen): Zonen als Tabelle mit Platz zum Eintragen.
  return [
    ...descOf(c.taskDescription),
    ...imageOf(bg),
    bank,
    { type: 'table', header: ['', 'Begriff'], widths: ['6cm', ''],
      rows: zones.map((z: any) => [escInline(plainText(z.label)), '']), heights: ['', ...zones.map(() => '1cm')] },
    solution([{ type: 'list', items: zones.map((z: any) => `${escInline(plainText(z.label))}: ${escInline(answerOf(z))}`) }]),
  ];
}

/**
 * Bausteine der Druckfassung – oder null, wenn sich der Typ nicht drucken lässt
 * (dann bleibt es beim QR-Code). Zusammengesetzte Quizze: je Teil mit Titel.
 */
export function quizPrintBlocks(q: PrintQuiz, sizeOf: ImageSizeOf = () => null): Block[] | null {
  const one = (x: PrintQuiz): Block[] | null => {
    switch (x.type) {
      case 'multipleChoice': return multipleChoice(x);
      case 'trueFalse': return trueFalse(x);
      case 'fillInTheBlanks': return fillInTheBlanks(x);
      case 'dragTheWords': return dragTheWords(x);
      case 'markTheWords': return markTheWords(x);
      case 'dragAndDrop': return dragAndDrop(x, sizeOf);
      default: return null;
    }
  };
  const own = one(q);
  if (own) return own;
  const parts = (q.children || []).map((k) => ({ k, blocks: one(k) })).filter((p) => p.blocks);
  if (!parts.length) return null;
  return parts.flatMap(({ k, blocks }) => [textBlock(`***${escInline(k.title || 'Teil')}***`), ...blocks!]);
}
