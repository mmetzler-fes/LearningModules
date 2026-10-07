import AdmZip from 'adm-zip';
import { imageSize } from '../moodle/image-size';
import { dndExpected } from '../moodle/moodle-export';

/**
 * Thema → H5P-Paket (H5P.QuestionSet mit einer Frage je Modul).
 *
 * Die Bibliotheken kommen aus assets/h5p/libraries.zip (vom H5P-Hub, siehe
 * scripts/update-h5p-libraries.sh) und werden mit ins Paket gelegt – so läuft
 * es auch auf Plattformen ohne diese Inhaltstypen. Felder, die unsere Module
 * nicht kennen, füllt der Export mit den Vorgaben aus semantics.json, Texte
 * auf Deutsch aus der Sprachdatei der Bibliothek – wie es der H5P-Editor tut.
 */

export interface H5pExportModule {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  content: any;
}

export interface H5pExportResult {
  buffer: Buffer;
  count: number;
  skipped: string[];
  notes: string[];
}

// ---- Bibliotheken ----

interface LibInfo {
  dir: string;
  machineName: string;
  major: number;
  minor: number;
  deps: Array<{ machineName: string; majorVersion: number; minorVersion: number }>;
}

export class LibraryStore {
  private readonly zip: AdmZip;
  private readonly libs = new Map<string, LibInfo>();

  constructor(buffer: Buffer) {
    this.zip = new AdmZip(buffer);
    for (const e of this.zip.getEntries()) {
      const m = /^([^/]+)\/library\.json$/.exec(e.entryName);
      if (!m) continue;
      const json = JSON.parse(e.getData().toString('utf-8'));
      this.libs.set(json.machineName, {
        dir: m[1],
        machineName: json.machineName,
        major: json.majorVersion,
        minor: json.minorVersion,
        deps: [...(json.preloadedDependencies || []), ...(json.dynamicDependencies || []), ...(json.editorDependencies || [])],
      });
    }
  }

  get(machineName: string): LibInfo {
    const lib = this.libs.get(machineName);
    if (!lib) throw new Error(`H5P-Bibliothek ${machineName} fehlt in assets/h5p/libraries.zip`);
    return lib;
  }

  /** "H5P.MultiChoice 1.16" – so steht die Bibliothek in content.json. */
  ref(machineName: string): string {
    const l = this.get(machineName);
    return `${l.machineName} ${l.major}.${l.minor}`;
  }

  dep(machineName: string) {
    const l = this.get(machineName);
    return { machineName: l.machineName, majorVersion: l.major, minorVersion: l.minor };
  }

  private json(machineName: string, file: string): any {
    const entry = this.zip.getEntry(`${this.get(machineName).dir}/${file}`);
    return entry ? JSON.parse(entry.getData().toString('utf-8')) : null;
  }

  semantics(machineName: string): any[] {
    return this.json(machineName, 'semantics.json') || [];
  }

  /** Übersetzte semantics (gleicher Aufbau), sonst null. */
  language(machineName: string, lang: string): any[] | null {
    return this.json(machineName, `language/${lang}.json`)?.semantics || null;
  }

  /** Alle Bibliotheken, die die genannten (transitiv) brauchen. */
  closure(names: string[]): LibInfo[] {
    const out = new Map<string, LibInfo>();
    const visit = (name: string) => {
      if (out.has(name) || !this.libs.has(name)) return;
      const lib = this.libs.get(name)!;
      out.set(name, lib);
      for (const d of lib.deps) visit(d.machineName);
    };
    names.forEach(visit);
    return [...out.values()];
  }

  /** Dateien einer Bibliothek ins Paket kopieren. */
  copyInto(target: AdmZip, lib: LibInfo) {
    for (const e of this.zip.getEntries()) {
      if (!e.isDirectory && e.entryName.startsWith(`${lib.dir}/`)) target.addFile(e.entryName, e.getData());
    }
  }
}

/**
 * Fehlende Felder mit den Vorgaben der Semantik füllen – rekursiv, wie der
 * H5P-Editor. Eine Gruppe mit nur einem Feld speichert H5P "flach": der Wert
 * des Feldes steht direkt unter dem Namen der Gruppe.
 */
export function fillDefaults(fields: any[], params: any, lang: any[] | null): any {
  const out = params && typeof params === 'object' ? params : {};
  fields.forEach((f, i) => {
    const l = lang?.[i];
    if (!f || !f.name) return;
    out[f.name] = fillField(f, out[f.name], l);
  });
  return out;
}

function fillField(f: any, value: any, l: any): any {
  switch (f.type) {
    case 'group': {
      const sub = f.fields || [];
      if (sub.length === 1) return fillField(sub[0], value, l?.fields?.[0]);
      return fillDefaults(sub, value, l?.fields || null);
    }
    case 'list': {
      const list = Array.isArray(value) ? value : [];
      return list.map((item) => fillField(f.field, item, l?.field));
    }
    case 'library':
    case 'image':
    case 'file':
    case 'video':
    case 'audio':
      return value;
    default:
      if (value !== undefined) return value;
      if (l && l.default !== undefined) return l.default;
      return f.default;
  }
}

// ---- Hilfen ----

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const para = (s: string) => (s ? `<p>${esc(s).replace(/\n/g, '<br>')}</p>` : '');

/** HTML → Text mit Zeilenumbrüchen (DragText erwartet Klartext). */
const htmlToText = (html: string) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

/** Bilder sammeln: data:-URL → content/images/…, externe URLs bleiben. */
class Images {
  readonly files: Array<{ path: string; buffer: Buffer }> = [];
  add(url: string, base: string): { path: string; mime: string; width?: number; height?: number } | null {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(url || ''));
    if (m && EXT[m[1]]) {
      const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
      const path = `images/${base}-${this.files.length + 1}.${EXT[m[1]]}`;
      this.files.push({ path, buffer });
      const size = imageSize(buffer);
      return { path, mime: m[1], ...(size || {}) };
    }
    if (/^https?:\/\//i.test(url || '')) return { path: url, mime: 'image/jpeg' };
    return null;
  }
}

// ---- Umsetzer je Typ ----

interface Ctx {
  name: string;
  notes: string[];
  images: Images;
  store: LibraryStore;
  id: string;
  intro: string;
  sub: () => string;
}

interface SubContent { library: string; params: any; subContentId: string; metadata: any }
type Converter = (c: any, ctx: Ctx) => SubContent[] | null;

const sub = (ctx: Ctx, machineName: string, params: any, title = ctx.name): SubContent => ({
  library: ctx.store.ref(machineName),
  params: fillDefaults(ctx.store.semantics(machineName), params, ctx.store.language(machineName, 'de')),
  subContentId: ctx.sub(),
  metadata: { contentType: machineName.replace('H5P.', ''), license: 'U', title },
});

/** Bild als media-Feld (MultiChoice, TrueFalse, Blanks …). */
function media(url: string, ctx: Ctx) {
  const img = url ? ctx.images.add(url, 'bild') : null;
  if (!img) return { disableImageZooming: false };
  return {
    type: {
      library: ctx.store.ref('H5P.Image'),
      params: fillDefaults(ctx.store.semantics('H5P.Image'), { file: { path: img.path, mime: img.mime, width: img.width, height: img.height }, alt: '' }, null),
      subContentId: ctx.sub(),
      metadata: { contentType: 'Image', license: 'U', title: 'Bild' },
    },
    disableImageZooming: false,
  };
}

const convertMultipleChoice: Converter = (c, ctx) => {
  const answers = (c.answers || []).filter((a: any) => String(a.text || '').trim());
  const right = answers.filter((a: any) => a.correct).length;
  if (!answers.length || !right) return null;
  return [sub(ctx, 'H5P.MultiChoice', {
    media: media(c.imageUrl, ctx),
    question: ctx.intro + (c.question || ''),
    answers: answers.map((a: any) => ({
      text: `<div>${esc(a.text)}</div>`,
      correct: !!a.correct,
      tipsAndFeedback: { tip: a.tip ? para(a.tip) : '', chosenFeedback: '', notChosenFeedback: '' },
    })),
    behaviour: {
      type: c.singleAnswer === false ? 'multi' : right === 1 ? 'single' : 'auto',
      randomAnswers: c.randomAnswers !== false,
      enableRetry: c.enableRetry !== false,
      enableSolutionsButton: c.enableSolutionsButton !== false,
      passPercentage: Number(c.passPercentage) || 100,
    },
  })];
};

const convertTrueFalse: Converter = (c, ctx) => {
  const qs = (c.questions || []).filter((q: any) => String(q.question || '').trim());
  if (!qs.length) return null;
  return qs.map((q: any, i: number) => sub(ctx, 'H5P.TrueFalse', {
    media: media(i === 0 ? c.imageUrl : '', ctx),
    question: (i === 0 ? ctx.intro : '') + para(q.question),
    correct: String(q.correctAnswer) === 'true' ? 'true' : 'false',
    behaviour: {
      enableRetry: c.enableRetry !== false,
      enableSolutionsButton: c.enableSolutionsButton !== false,
      feedbackOnCorrect: q.feedbackCorrect || '',
      feedbackOnWrong: q.feedbackWrong || '',
    },
  }, qs.length > 1 ? `${ctx.name} (${i + 1}/${qs.length})` : ctx.name));
};

const convertBlanks: Converter = (c, ctx) => {
  const questions = (c.questions || []).map((q: any) => String(q.text || '')).filter((t: string) => /\*[^*]+\*/.test(t));
  if (!questions.length) return null;
  return [sub(ctx, 'H5P.Blanks', {
    media: media(c.imageUrl, ctx),
    text: ctx.intro + (c.taskDescription || ''),
    questions: questions.map((t: string) => para(t)),
    behaviour: {
      caseSensitive: !!c.caseSensitive,
      showSolutionsRequiresInput: c.showSolutionsRequiresInput !== false,
      enableRetry: c.enableRetry !== false,
      enableSolutionsButton: c.enableSolutionsButton !== false,
    },
  })];
};

/** DragText erwartet Klartext; Lücken mit Alternativen (|) gibt es dort nicht. */
const convertDragText: Converter = (c, ctx) => {
  let alts = false;
  const text = htmlToText(c.textField || '').replace(/\*([^*]+)\*/g, (_m, inner: string) => {
    const options = inner.split('|').map((s) => s.trim()).filter(Boolean);
    if (options.length > 1) alts = true;
    return `*${options[0] || inner}*`;
  });
  if (!/\*[^*]+\*/.test(text)) return null;
  if (alts) ctx.notes.push(`${ctx.name}: Lücken mit mehreren richtigen Wörtern – nur das erste übernommen.`);
  return [sub(ctx, 'H5P.DragText', {
    media: media(c.imageUrl, ctx),
    taskDescription: ctx.intro + (c.taskDescription || ''),
    textField: text,
    distractors: String(c.distractors || ''),
    behaviour: {
      enableRetry: c.enableRetry !== false,
      enableSolutionsButton: c.enableSolutionsButton !== false,
      instantFeedback: !!c.instantFeedback,
    },
  })];
};

const convertMarkTheWords: Converter = (c, ctx) => {
  const raw = String(c.textField || '');
  if (!/\*[^*]+\*/.test(raw)) return null;
  const html = /<\w/.test(raw) ? raw : raw.split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
  return [sub(ctx, 'H5P.MarkTheWords', {
    media: media(c.imageUrl, ctx),
    taskDescription: ctx.intro + (c.taskDescription || ''),
    textField: html,
    behaviour: { enableRetry: c.enableRetry !== false, enableSolutionsButton: c.enableSolutionsButton !== false },
  })];
};

const convertEssay: Converter = (c, ctx) => [sub(ctx, 'H5P.Essay', {
  media: media(c.imageUrl, ctx),
  taskDescription: ctx.intro + para(c.taskDescription || ''),
  solution: { introduction: '', sample: c.sampleSolution ? para(c.sampleSolution) : '' },
  keywords: [],
  behaviour: {
    minimumLength: Number(c.minChars) || undefined,
    inputFieldSize: ['1', '3', '10'].includes(String(c.inputFieldSize)) ? String(c.inputFieldSize) : '10',
    enableRetry: c.enableRetry !== false,
    ignoreScoring: c.ignoreScoring !== false,
    pointsHost: Number(c.pointsHost) || 1,
  },
})];

/**
 * Drag and Drop. H5P streckt ein Hintergrundbild auf die ganze Fläche; damit
 * die Elemente keine Zone verdecken, liegt das Bild als feststehendes
 * Element oben und die ziehbaren Elemente starten im Streifen darunter.
 * Maße: x/y in Prozent der Fläche, Breite/Höhe in em (1 em = Breite/16).
 */
const convertDragQuestion: Converter = (c, ctx) => {
  const expected = dndExpected(c);
  if (!expected.length) return null;
  const zones: any[] = (c.dropZones || []).filter((z: any) => z.label);
  const drags: any[] = (c.draggables || []).filter((d: any) => String(d.text || '').trim());

  const W = 620;
  const bg = c.backgroundImage ? ctx.images.add(c.backgroundImage, 'hintergrund') : null;
  if (c.backgroundImage && !bg) ctx.notes.push(`${ctx.name}: Hintergrundbild nicht übernommen.`);
  const Hi = bg?.width && bg?.height ? Math.round((W * bg.height) / bg.width) : Math.round(W * 0.5);

  // Ziehbare Elemente zeilenweise im Streifen unter dem Bild anordnen.
  const em = 16;
  const pad = 0.5;
  const rowH = 2.5;
  let cx = pad;
  let row = 0;
  const placed = drags.map((d) => {
    const w = Math.min(W / em - 2 * pad, Math.max(3, String(d.text).length * 0.55 + 1.5));
    if (cx + w > W / em - pad) { cx = pad; row++; }
    const pos = { x: cx, row, w };
    cx += w + pad;
    return pos;
  });
  const Hs = (row + 1) * rowH * em + pad * em * 2;
  const Hc = Hi + Hs;
  const pctX = (px: number) => Math.round((px / W) * 10000) / 100;
  const pctY = (px: number) => Math.round((px / Hc) * 10000) / 100;

  // Zonen einer Ablagegruppe sind vertauschbar: jede nimmt alle richtigen
  // Elemente der Gruppe an, aber nur eins zur Zeit.
  const zoneTargets = (z: any) => {
    const sameGroup = z.group ? zones.filter((o) => o.group === z.group).map((o) => o.label) : [z.label];
    return expected.filter((e) => sameGroup.includes(e.zone)).map((e) => e.text);
  };
  const correctFor = (z: any) => {
    const texts = zoneTargets(z);
    return drags.map((d, i) => (texts.includes(d.text) ? String(i) : null)).filter((x): x is string => x !== null);
  };

  const elements: any[] = [];
  if (bg) {
    elements.push({
      type: {
        library: ctx.store.ref('H5P.Image'),
        params: fillDefaults(ctx.store.semantics('H5P.Image'), { file: { path: bg.path, mime: bg.mime, width: bg.width, height: bg.height }, alt: '' }, null),
        subContentId: ctx.sub(),
        metadata: { contentType: 'Image', license: 'U', title: 'Hintergrund' },
      },
      x: 0, y: 0, width: W / em, height: Hi / em, dropZones: [], backgroundOpacity: 0, multiple: false,
    });
  }
  const offset = elements.length;
  drags.forEach((d, i) => {
    elements.push({
      type: {
        library: ctx.store.ref('H5P.AdvancedText'),
        params: { text: `<p>${esc(d.text)}</p>` },
        subContentId: ctx.sub(),
        metadata: { contentType: 'Text', license: 'U', title: String(d.text).slice(0, 40) },
      },
      x: pctX(placed[i].x * em),
      y: pctY(Hi + pad * em + placed[i].row * rowH * em),
      width: placed[i].w,
      height: rowH - 0.5,
      dropZones: zones.map((_z, k) => String(k)),
      backgroundOpacity: 100,
      multiple: !!d.multiple,
    });
  });

  const dropZones = zones.map((z) => {
    const correct = correctFor(z).map((i) => String(Number(i) + offset));
    return {
      label: `<div>${esc(z.label)}</div>`,
      showLabel: true,
      x: pctX(((Number(z.x) || 0) / 100) * W),
      y: pctY(((Number(z.y) || 0) / 100) * Hi),
      width: Math.round((((Number(z.width) || 20) / 100) * W / em) * 100) / 100,
      height: Math.round((((Number(z.height) || 15) / 100) * Hi / em) * 100) / 100,
      correctElements: correct,
      backgroundOpacity: 50,
      tipsAndFeedback: { tip: '', feedbackOnCorrect: '', feedbackOnIncorrect: '' },
      // Mehrere richtige Elemente brauchen Platz für alle; eine Gruppenzone nimmt eins.
      single: !!z.group || expected.filter((e) => e.zone === z.label).length <= 1,
      autoAlign: true,
    };
  });

  return [sub(ctx, 'H5P.DragQuestion', {
    question: {
      settings: { size: { width: W, height: Hc } },
      task: { elements, dropZones },
    },
    behaviour: { enableRetry: true, enableCheckButton: true, singlePoint: false, applyPenalties: true, showTitle: true },
  })];
};

const CONVERTERS: Record<string, Converter> = {
  multipleChoice: convertMultipleChoice,
  trueFalse: convertTrueFalse,
  fillInTheBlanks: convertBlanks,
  dragTheWords: convertDragText,
  markTheWords: convertMarkTheWords,
  essay: convertEssay,
  dragAndDrop: convertDragQuestion,
};

const TYPE_NAMES: Record<string, string> = {
  worksheet: 'Arbeitsblatt', flashcards: 'Karteikarten', dictation: 'Diktat', arithmeticQuiz: 'Rechenquiz',
  branchingScenario: 'Verzweigung', video: 'Video', audioRecorder: 'Audio-Aufnahme', accordion: 'Akkordeon',
  collage: 'Collage', coursePresentation: 'Präsentation', dialogCards: 'Dialogkarten', imageHotspots: 'Bild-Hotspots',
  iframeEmbedder: 'Eingebettete Seite', formula: 'Formelaufgabe',
};

export function buildH5pPackage(title: string, modules: H5pExportModule[], libraries: Buffer): H5pExportResult {
  const store = new LibraryStore(libraries);
  const images = new Images();
  const skipped: string[] = [];
  const notes: string[] = [];
  const questions: SubContent[] = [];
  const used = new Set<string>(['H5P.QuestionSet']);
  let n = 0;

  for (const m of modules) {
    const name = String(m.title || 'Aufgabe').trim();
    const convert = CONVERTERS[m.type];
    if (!convert) {
      skipped.push(`${name}: ${TYPE_NAMES[m.type] || m.type} gibt es im H5P-Fragenset nicht`);
      continue;
    }
    const ctx: Ctx = {
      name, notes, images, store, id: m.id,
      intro: m.description || '',
      sub: () => `${m.id}-${++n}`,
    };
    let result: SubContent[] | null = null;
    try {
      result = convert(m.content || {}, ctx);
    } catch {
      result = null;
    }
    if (!result || !result.length) {
      skipped.push(`${name}: Inhalt unvollständig – nichts zu exportieren`);
      continue;
    }
    questions.push(...result);
    for (const q of result) used.add(q.library.split(' ')[0]);
    if (m.type === 'dragAndDrop') { used.add('H5P.AdvancedText'); used.add('H5P.Image'); }
    if (JSON.stringify(result).includes('"H5P.Image ')) used.add('H5P.Image');
  }

  const content = fillDefaults(store.semantics('H5P.QuestionSet'), {
    introPage: { showIntroPage: false, title },
    progressType: 'dots',
    passPercentage: 50,
    questions,
    disableBackwardsNavigation: false,
    randomQuestions: false,
  }, store.language('H5P.QuestionSet', 'de'));

  const zip = new AdmZip();
  zip.addFile('h5p.json', Buffer.from(JSON.stringify({
    title,
    language: 'de',
    mainLibrary: 'H5P.QuestionSet',
    embedTypes: ['iframe'],
    license: 'U',
    defaultLanguage: 'de',
    preloadedDependencies: [...used].map((u) => store.dep(u)),
  }, null, 2), 'utf-8'));
  zip.addFile('content/content.json', Buffer.from(JSON.stringify(content), 'utf-8'));
  for (const f of images.files) zip.addFile(`content/${f.path}`, f.buffer);
  for (const lib of store.closure([...used])) store.copyInto(zip, lib);

  return { buffer: zip.toBuffer(), count: questions.length, skipped, notes: [...new Set(notes)] };
}
