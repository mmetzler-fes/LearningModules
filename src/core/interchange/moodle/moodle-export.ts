import { imageSize } from './image-size';
import { formulaEngine } from '../../formula/formula-engine';

/**
 * Module dieser App → Moodle-XML (Fragensammlung), importierbar in Moodle
 * unter Fragensammlung → Import → Moodle-XML-Format.
 *
 * Gegenstück zu moodle-import.ts. Was Moodle nicht kennt, landet in
 * `skipped`; was nur vereinfacht hinüberkommt, in `notes`.
 */

export interface ExportModule {
  type: string;
  title: string;
  description?: string | null;
  content: any;
}

export interface MoodleExportResult {
  xml: string;
  count: number;
  skipped: string[];
  notes: string[];
}

// ---- Hilfen ----

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text als CDATA; "]]>" im Inhalt wird aufgeteilt. */
const cdata = (s: string) => `<![CDATA[${String(s ?? '').replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

/** Moodle nimmt nur diese Bewertungsanteile an (sonst Fehler beim Import). */
const GRADES = [100, 90, 83.33333, 80, 75, 70, 66.66667, 60, 50, 40, 33.33333, 30, 25, 20, 16.66667, 14.28571, 12.5, 11.11111, 10, 5, 0];
export function nearestGrade(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const best = GRADES.reduce((a, b) => (Math.abs(b - abs) < Math.abs(a - abs) ? b : a));
  return sign * best;
}

/** Eine Datei für Moodle: aus einer data:-URL, sonst null. */
interface MFile { name: string; b64: string; buffer: Buffer }
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

class Files {
  private n = 0;
  constructor(private readonly prefix: string) {}
  fromUrl(url: string): MFile | null {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(url || ''));
    if (!m || !EXT[m[1]]) return null;
    const b64 = m[2].replace(/\s+/g, '');
    return { name: `${this.prefix}${++this.n}.${EXT[m[1]]}`, b64, buffer: Buffer.from(b64, 'base64') };
  }
}
const fileTag = (f: MFile) => `<file name="${esc(f.name)}" path="/" encoding="base64">${f.b64}</file>`;

/**
 * Fragetext aus Beschreibung, Text und Bild. Eingebettete Bilder werden
 * Moodle-Dateien (@@PLUGINFILE@@), externe bleiben Verweise.
 */
function questionText(parts: string[], imageUrl: string, files: Files): string {
  const fileTags: string[] = [];
  let img = '';
  const f = imageUrl ? files.fromUrl(imageUrl) : null;
  if (f) {
    fileTags.push(fileTag(f));
    img = `<p><img src="@@PLUGINFILE@@/${encodeURIComponent(f.name)}" alt="" /></p>`;
  } else if (/^https?:\/\//i.test(imageUrl || '')) {
    img = `<p><img src="${esc(imageUrl)}" alt="" /></p>`;
  }
  const html = parts.filter((p) => p && p.trim()).join('') + img;
  return `<questiontext format="html"><text>${cdata(html)}</text>${fileTags.join('')}</questiontext>`;
}

const p = (text: string) => (text ? `<p>${esc(text).replace(/\n/g, '<br />')}</p>` : '');

const head = (type: string, name: string) =>
  `  <question type="${type}">\n    <name><text>${esc(name)}</text></name>\n`;

const feedbackBlock = (text: string) => `<feedback format="html"><text>${cdata(text ? p(text) : '')}</text></feedback>`;

/** Lücken *a/b* → Liste der Alternativen. */
const gapRe = /\*([^*]+)\*/g;

/** Sonderzeichen in Cloze-Antworten maskieren. */
const clozeEsc = (s: string) => s.replace(/([}#~/"\\])/g, '\\$1');

// ---- Drag and Drop: dieselbe Regel wie die Auswertung (answer-eval.js) ----

export function dndExpected(content: any): Array<{ zone: string; text: string }> {
  const zones = (content && content.dropZones) || [];
  const drags = (content && content.draggables) || [];
  const out: Array<{ zone: string; text: string }> = [];
  for (const z of zones) {
    if (!z.label) continue;
    const targeted = [...new Set<string>(drags.filter((d: any) => d.correctZone === z.label && d.text).map((d: any) => d.text))];
    const own = z.correctDraggable || '';
    const texts = !own ? targeted : targeted.includes(own) ? targeted : [own];
    for (const text of texts) out.push({ zone: z.label, text });
  }
  return out;
}

// ---- Umsetzer je Typ ----

interface Ctx { name: string; notes: string[]; files: Files; intro: string }
type Exporter = (c: any, ctx: Ctx) => string[] | null;

const exportMultipleChoice: Exporter = (c, ctx) => {
  const answers = (c.answers || []).filter((a: any) => String(a.text || '').trim());
  const right = answers.filter((a: any) => a.correct).length;
  const wrong = answers.length - right;
  if (!answers.length || !right) return null;
  const single = c.singleAnswer !== false && right === 1;
  if (c.singleAnswer !== false && right > 1) ctx.notes.push(`${ctx.name}: mehrere richtige Antworten – als Mehrfachauswahl exportiert.`);
  const plus = single ? 100 : nearestGrade(100 / right);
  // Ein falsches Kreuz hebt ein richtiges auf – sonst brächte "alles
  // ankreuzen" volle Punktzahl.
  const minus = single || !wrong ? 0 : -nearestGrade(100 / right);
  const body = answers.map((a: any) => `    <answer fraction="${a.correct ? plus : minus}" format="html"><text>${cdata(esc(a.text))}</text>${feedbackBlock(a.tip || '')}</answer>`);
  return [
    head('multichoice', ctx.name)
    + `    ${questionText([ctx.intro, c.question || ''], c.imageUrl, ctx.files)}\n`
    + `    <single>${single ? 'true' : 'false'}</single>\n    <shuffleanswers>${c.randomAnswers === false ? 0 : 1}</shuffleanswers>\n`
    + '    <answernumbering>abc</answernumbering>\n'
    + body.join('\n') + '\n  </question>',
  ];
};

/** Mehrere Aussagen → je Aussage eine Wahr/Falsch-Frage. */
const exportTrueFalse: Exporter = (c, ctx) => {
  const qs = (c.questions || []).filter((q: any) => String(q.question || '').trim());
  if (!qs.length) return null;
  return qs.map((q: any, i: number) => {
    const isTrue = String(q.correctAnswer) === 'true';
    const ok = q.feedbackCorrect || '';
    const no = q.feedbackWrong || '';
    return head('truefalse', qs.length > 1 ? `${ctx.name} (${i + 1}/${qs.length})` : ctx.name)
      + `    ${questionText([ctx.intro, p(q.question)], i === 0 ? c.imageUrl : '', ctx.files)}\n`
      + `    <answer fraction="${isTrue ? 100 : 0}" format="moodle_auto_format"><text>true</text>${feedbackBlock(isTrue ? ok : no)}</answer>\n`
      + `    <answer fraction="${isTrue ? 0 : 100}" format="moodle_auto_format"><text>false</text>${feedbackBlock(isTrue ? no : ok)}</answer>\n`
      + '  </question>';
  });
};

/** Lückentext → Cloze mit Kurzantwort-Lücken. */
const exportFillInTheBlanks: Exporter = (c, ctx) => {
  const kind = c.caseSensitive ? 'SHORTANSWER_C' : 'SHORTANSWER';
  let gaps = 0;
  const lines = (c.questions || []).map((q: any) => String(q.text || '')).filter((t: string) => t.trim()).map((t: string) => {
    const withGaps = esc(t).replace(gapRe, (_m, inner: string) => {
      const alts = inner.split('/').map((a) => a.trim()).filter(Boolean);
      if (!alts.length) return _m;
      gaps++;
      return `{1:${kind}:${alts.map((a) => `=${clozeEsc(a)}`).join('~')}}`;
    });
    return `<p>${withGaps}</p>`;
  });
  if (!gaps) return null;
  return [
    head('cloze', ctx.name)
    + `    ${questionText([ctx.intro, c.taskDescription || '', ...lines], c.imageUrl, ctx.files)}\n`
    + '  </question>',
  ];
};

/** Drag the Words → Drag and Drop in Text. Gleiche Wörter teilen sich ein Kärtchen. */
const exportDragTheWords: Exporter = (c, ctx) => {
  const boxes: string[] = [];
  const uses = new Map<string, number>();
  let alts = false;
  const body = String(c.textField || '').replace(gapRe, (_m, inner: string) => {
    const options = inner.split('|').map((s) => s.trim()).filter(Boolean);
    if (!options.length) return _m;
    if (options.length > 1) alts = true;
    const word = options[0].split(':')[0].trim();
    if (!boxes.includes(word)) boxes.push(word);
    uses.set(word, (uses.get(word) || 0) + 1);
    return `[[${boxes.indexOf(word) + 1}]]`;
  });
  if (!boxes.length) return null;
  if (alts) ctx.notes.push(`${ctx.name}: Lücken mit mehreren richtigen Wörtern – nur das erste übernommen.`);
  const distractors = [...String(c.distractors || '').matchAll(gapRe)].map((m) => m[1].trim()).filter((d) => d && !boxes.includes(d));
  const dragboxes = [...boxes, ...distractors].map((w) =>
    `    <dragbox><text>${esc(w)}</text><group>1</group>${(uses.get(w) || 0) > 1 ? '<infinite/>' : ''}</dragbox>`);
  return [
    head('ddwtos', ctx.name)
    + `    ${questionText([ctx.intro, c.taskDescription || '', `<p>${body}</p>`], c.imageUrl, ctx.files)}\n`
    + '    <shuffleanswers>1</shuffleanswers>\n'
    + dragboxes.join('\n') + '\n  </question>',
  ];
};

/**
 * Drag and Drop. Ohne Bild: Zuordnung (Element → Zone). Mit Bild und je
 * Zone einem Element: Drag and Drop auf Bild; sonst Markierungen, denn nur
 * dort dürfen mehrere Elemente in einer Zone liegen.
 */
const exportDragAndDrop: Exporter = (c, ctx) => {
  const expected = dndExpected(c);
  if (!expected.length) return null;
  const zones: any[] = c.dropZones || [];
  const usedTexts = new Set(expected.map((e) => e.text));
  const intro = [ctx.intro, c.taskDescription || ''];

  const bg = c.backgroundImage ? ctx.files.fromUrl(c.backgroundImage) : null;
  const size = bg && imageSize(bg.buffer);
  if (!bg || !size) {
    if (c.backgroundImage) ctx.notes.push(`${ctx.name}: Hintergrundbild nicht eingebettet – als Zuordnung ohne Bild exportiert.`);
    // Zuordnung: links die Elemente, rechts die Zonen als Auswahl.
    const subs = expected.map((e) => `    <subquestion format="html"><text>${cdata(esc(e.text))}</text><answer><text>${esc(e.zone)}</text></answer></subquestion>`);
    const unusedZones = zones.filter((z) => z.label && !expected.some((e) => e.zone === z.label));
    const extra = unusedZones.map((z) => `    <subquestion format="html"><text></text><answer><text>${esc(z.label)}</text></answer></subquestion>`);
    if (expected.length < 2) return null; // Moodle verlangt mindestens zwei Paare
    return [
      head('match', ctx.name)
      + `    ${questionText([...intro, '<p>Ordne zu.</p>'], '', ctx.files)}\n`
      + '    <shuffleanswers>true</shuffleanswers>\n'
      + [...subs, ...extra].join('\n') + '\n  </question>',
    ];
  }

  const px = (v: number, total: number) => Math.round((Number(v) || 0) / 100 * total);
  const multiPerZone = zones.some((z) => expected.filter((e) => e.zone === z.label).length > 1);
  if (zones.some((z) => z.group)) ctx.notes.push(`${ctx.name}: Ablagegruppen gibt es in Moodle nicht – feste Zuordnung exportiert.`);
  const drags = [...usedTexts, ...((c.draggables || []).map((d: any) => d.text).filter((t: string) => t && !usedTexts.has(t)))];
  const dragNo = (t: string) => drags.indexOf(t) + 1;

  if (multiPerZone) {
    ctx.notes.push(`${ctx.name}: mehrere Elemente je Zone – als Moodle-Markierungsfrage exportiert.`);
    const dragTags = drags.map((t) => {
      const count = expected.filter((e) => e.text === t).length;
      return `    <drag><no>${dragNo(t)}</no><text>${esc(t)}</text><noofdrags>${Math.max(1, count)}</noofdrags></drag>`;
    });
    const dropTags = expected.map((e, i) => {
      const z = zones.find((zz) => zz.label === e.zone);
      const coords = `${px(z.x, size.width)},${px(z.y, size.height)};${px(z.width, size.width)},${px(z.height, size.height)}`;
      return `    <drop><no>${i + 1}</no><shape>rectangle</shape><coords>${coords}</coords><choice>${dragNo(e.text)}</choice></drop>`;
    });
    return [
      head('ddmarker', ctx.name)
      + `    ${questionText(intro, '', ctx.files)}\n`
      + '    <showmisplaced/>\n'
      + `    ${fileTag(bg)}\n`
      + dragTags.join('\n') + '\n' + dropTags.join('\n') + '\n  </question>',
    ];
  }

  const dragTags = drags.map((t) => {
    const count = expected.filter((e) => e.text === t).length;
    return `    <drag><no>${dragNo(t)}</no><text>${esc(t)}</text><draggroup>1</draggroup>${count > 1 ? '<infinite/>' : ''}</drag>`;
  });
  const dropTags = expected.map((e, i) => {
    const z = zones.find((zz) => zz.label === e.zone);
    return `    <drop><text>${esc(z.label)}</text><no>${i + 1}</no><choice>${dragNo(e.text)}</choice>`
      + `<xleft>${px(z.x, size.width)}</xleft><ytop>${px(z.y, size.height)}</ytop></drop>`;
  });
  return [
    head('ddimageortext', ctx.name)
    + `    ${questionText(intro, '', ctx.files)}\n`
    + '    <shuffleanswers>1</shuffleanswers>\n'
    + `    ${fileTag(bg)}\n`
    + dragTags.join('\n') + '\n' + dropTags.join('\n') + '\n  </question>',
  ];
};

const exportEssay: Exporter = (c, ctx) => [
  head('essay', ctx.name)
  + `    ${questionText([ctx.intro, p(c.taskDescription || '')], c.imageUrl, ctx.files)}\n`
  + '    <defaultgrade>1</defaultgrade>\n    <responseformat>editor</responseformat>\n    <responsefieldlines>15</responsefieldlines>\n'
  + `    <graderinfo format="html"><text>${cdata(p(c.sampleSolution || ''))}</text></graderinfo>\n`
  + '  </question>',
];

const exportWorksheet: Exporter = (c, ctx) => {
  const html = String(c.html || '');
  if (!html.trim()) return null;
  return [head('description', ctx.name) + `    ${questionText([ctx.intro, html], '', ctx.files)}\n  </question>`];
};

/**
 * Formelaufgabe → berechnete Frage(n). Moodle kennt je Frage ein Ergebnis –
 * mehrere Ergebnisse werden mehrere Fragen. Moodle braucht fertige
 * Zahlensätze; sie werden hier mit derselben Logik erzeugt wie im Browser.
 */
const DATASET_ITEMS = 10;
const exportFormula: Exporter = (c, ctx) => {
  const f = formulaEngine();
  if (f.checkFormulaTask(c).length) return null;
  const variables = (c.variables || []).filter((v: any) => v && v.name);
  const results = (c.results || []).filter((r: any) => r && r.formula);
  const sets: Array<Record<string, number>> = [];
  for (let i = 0; i < DATASET_ITEMS; i++) {
    const v = f.generateValues(variables, results);
    if (v) sets.push(v);
  }
  if (!sets.length) return null;
  // {=Formel} im Text in Moodles Schreibweise
  const question = String(c.question || '').replace(/\{=([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (m: string, expr: string) => {
    try { return `{=${f.toMoodleFormula(expr)}}`; } catch { return m; }
  });
  const item = (set: Record<string, number>, name: string, i: number) =>
    `        <dataset_item><number>${i + 1}</number><value>${set[name]}</value></dataset_item>`;
  const datasets = variables.map((v: any) => [
    '<dataset_definition>',
    '    <status><text>private</text></status>',
    `    <name><text>${esc(v.name)}</text></name>`,
    '    <type>calculated</type>',
    '    <distribution><text>uniform</text></distribution>',
    `    <minimum><text>${Number(v.min)}</text></minimum>`,
    `    <maximum><text>${Number(v.max)}</text></maximum>`,
    `    <decimals><text>${Math.max(0, Number(v.decimals) || 0)}</text></decimals>`,
    `    <itemcount>${sets.length}</itemcount>`,
    '    <dataset_items>',
    ...sets.map((set, i) => item(set, v.name, i)),
    '    </dataset_items>',
    `    <number_of_items>${sets.length}</number_of_items>`,
    '</dataset_definition>',
  ].join('\n')).join('\n');
  return results.map((r: any, i: number) => {
    const absolute = r.toleranceType === 'absolute';
    const tol = Math.abs(Number(r.tolerance ?? 1)) || 0;
    const asked = `<p><strong>Gesucht:</strong> ${esc(r.label || 'Ergebnis')}${r.unit ? ` in ${esc(r.unit)}` : ''}</p>`;
    return head('calculated', results.length > 1 ? `${ctx.name} (${i + 1}/${results.length})` : ctx.name) + [
      `    ${questionText([ctx.intro, question, asked], i === 0 ? c.imageUrl : '', ctx.files)}`,
      '    <synchronize>1</synchronize>',
      '    <single>0</single>',
      '    <answernumbering>abc</answernumbering>',
      '    <shuffleanswers>0</shuffleanswers>',
      `    <answer fraction="100"><text>${esc(f.toMoodleFormula(r.formula))}</text>`,
      `      <tolerance>${absolute ? tol : tol / 100}</tolerance>`,
      `      <tolerancetype>${absolute ? 2 : 1}</tolerancetype>`,
      '      <correctanswerformat>1</correctanswerformat>',
      `      <correctanswerlength>${Math.max(0, Number(r.decimals ?? 2))}</correctanswerlength>`,
      '      <feedback format="html"><text></text></feedback>',
      '    </answer>',
      '    <unitgradingtype>0</unitgradingtype>',
      '    <unitpenalty>0.1</unitpenalty>',
      '    <showunits>3</showunits>',
      '    <unitsleft>0</unitsleft>',
      ...(r.unit ? [`    <units><unit><multiplier>1</multiplier><unit_name>${esc(r.unit)}</unit_name></unit></units>`] : []),
      '<dataset_definitions>',
      datasets,
      '</dataset_definitions>',
      '  </question>',
    ].join('\n');
  });
};

const EXPORTERS: Record<string, Exporter> = {
  formula: exportFormula,
  multipleChoice: exportMultipleChoice,
  trueFalse: exportTrueFalse,
  fillInTheBlanks: exportFillInTheBlanks,
  dragTheWords: exportDragTheWords,
  dragAndDrop: exportDragAndDrop,
  essay: exportEssay,
  worksheet: exportWorksheet,
};

const TYPE_NAMES: Record<string, string> = {
  markTheWords: 'Mark the Words', flashcards: 'Karteikarten', dictation: 'Diktat', arithmeticQuiz: 'Rechenquiz',
  branchingScenario: 'Verzweigung', video: 'Video', audioRecorder: 'Audio-Aufnahme', accordion: 'Akkordeon',
  collage: 'Collage', coursePresentation: 'Präsentation', dialogCards: 'Dialogkarten', imageHotspots: 'Bild-Hotspots',
  iframeEmbedder: 'Eingebettete Seite',
};

export function exportMoodleXml(category: string, modules: ExportModule[]): MoodleExportResult {
  const out: string[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];
  let count = 0;
  modules.forEach((m, i) => {
    const name = String(m.title || `Frage ${i + 1}`).trim();
    const exporter = EXPORTERS[m.type];
    if (!exporter) {
      skipped.push(`${name}: ${TYPE_NAMES[m.type] || m.type} gibt es in Moodle-Tests nicht`);
      return;
    }
    let questions: string[] | null = null;
    try {
      questions = exporter(m.content || {}, { name, notes, files: new Files(`bild${i + 1}_`), intro: m.description || '' });
    } catch {
      questions = null;
    }
    if (!questions || !questions.length) {
      skipped.push(`${name}: Inhalt unvollständig – nichts zu exportieren`);
      return;
    }
    out.push(...questions);
    count += questions.length;
  });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n'
    + `  <question type="category">\n    <category><text>$course$/top/${esc(category.replace(/\//g, '-'))}</text></category>\n  </question>\n`
    + out.join('\n') + '\n</quiz>\n';
  return { xml, count, skipped, notes: [...new Set(notes)] };
}
