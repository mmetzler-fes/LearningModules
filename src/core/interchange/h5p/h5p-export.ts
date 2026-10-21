import AdmZip from 'adm-zip';
import { imageSize } from '../moodle/image-size';
import { dndExpected } from '../moodle/moodle-export';
import { puzzles } from '../../puzzles/puzzles';

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
 * Drag and Drop. Maße: x/y in Prozent der Fläche, Breite/Höhe in em
 * (16 px). Die ziehbaren Elemente starten in einem Streifen unten.
 *
 * Mit Hintergrundbild: H5P streckt ein Hintergrundbild auf die ganze
 * Fläche; damit die Elemente keine Zone verdecken, liegt das Bild als
 * feststehendes Element oben, die Zonen an ihrer Stelle darauf.
 *
 * Ohne Bild (Liste, Gruppen, Paare): je Zone eine Zeile, links eine feste
 * Karte mit Text oder Bild, rechts die Zone. Die Lage aus dem Editor zählt
 * dort nicht – sie ist ohne Bild bedeutungslos.
 */
const convertDragQuestion: Converter = (c, ctx) => {
  const expected = dndExpected(c);
  if (!expected.length) return null;
  const zones: any[] = (c.dropZones || []).filter((z: any) => z.label);
  const drags: any[] = (c.draggables || []).filter((d: any) => String(d.text || '').trim());

  const W = 620;
  const em = 16;
  const pad = 0.5;
  const textH = 2;
  const imageH = 5;
  const wEm = W / em;
  const bg = c.backgroundImage ? ctx.images.add(c.backgroundImage, 'hintergrund') : null;
  if (c.backgroundImage && !bg) ctx.notes.push(`${ctx.name}: Hintergrundbild nicht übernommen.`);

  const textType = (text: string) => ({
    library: ctx.store.ref('H5P.AdvancedText'),
    params: { text: `<p>${esc(text)}</p>` },
    subContentId: ctx.sub(),
    metadata: { contentType: 'Text', license: 'U', title: String(text).slice(0, 40) },
  });
  const imageType = (img: { path: string; mime: string; width?: number; height?: number }, alt: string, title: string) => ({
    library: ctx.store.ref('H5P.Image'),
    params: fillDefaults(ctx.store.semantics('H5P.Image'), { file: { path: img.path, mime: img.mime, width: img.width, height: img.height }, alt }, null),
    subContentId: ctx.sub(),
    metadata: { contentType: 'Image', license: 'U', title: title.slice(0, 40) || 'Bild' },
  });
  // Bildbreite in em bei gegebener Höhe, nach Seitenverhältnis
  const imageW = (img: { width?: number; height?: number }, h: number) =>
    Math.max(3, Math.min(10, img.width && img.height ? (h * img.width) / img.height : h));

  // Ein H5P-Element ist Text oder Bild – bei beidem gewinnt das Bild.
  const dragImgs = drags.map((d) => (d.imageUrl ? ctx.images.add(d.imageUrl, 'element') : null));
  if (drags.some((d, i) => d.imageUrl && !dragImgs[i])) ctx.notes.push(`${ctx.name}: nicht alle Bilder der Elemente übernommen.`);
  if (drags.some((d, i) => dragImgs[i] && !d.hideText)) ctx.notes.push(`${ctx.name}: bei Elementen mit Bild und Text nur das Bild übernommen.`);
  const sizes = drags.map((d, i) => (dragImgs[i]
    ? { w: imageW(dragImgs[i]!, imageH), h: imageH }
    : { w: Math.min(wEm - 2 * pad, Math.max(3, String(d.text).length * 0.55 + 1.5)), h: textH }));

  // Zonen einer Ablagegruppe sind vertauschbar: jede nimmt alle richtigen
  // Elemente der Gruppe an, aber nur eins zur Zeit.
  const zoneTargets = (z: any) => {
    const sameGroup = z.group ? zones.filter((o) => o.group === z.group).map((o) => o.label) : [z.label];
    return expected.filter((e) => sameGroup.includes(e.zone)).map((e) => e.text);
  };
  const correctFor = (z: any) => {
    const texts = zoneTargets(z);
    return drags.map((d, i) => (texts.includes(d.text) ? i : -1)).filter((i) => i >= 0);
  };
  const single = (z: any) => !!z.group || expected.filter((e) => e.zone === z.label).length <= 1;

  // Feste Elemente (Hintergrund, Karten) und Zonen in em; Umrechnung in Prozent am Ende.
  const fixed: Array<{ type: any; x: number; y: number; w: number; h: number }> = [];
  const zoneBoxes: Array<{ x: number; y: number; w: number; h: number; showLabel: boolean }> = [];
  let top = 0;
  if (bg) {
    const hi = bg.width && bg.height ? (W * bg.height) / bg.width / em : (W * 0.5) / em;
    fixed.push({ type: imageType(bg, '', 'Hintergrund'), x: 0, y: 0, w: wEm, h: hi });
    for (const z of zones) {
      zoneBoxes.push({
        x: ((Number(z.x) || 0) / 100) * wEm,
        y: ((Number(z.y) || 0) / 100) * hi,
        w: Math.round(((Number(z.width) || 20) / 100) * wEm * 100) / 100,
        h: Math.round(((Number(z.height) || 15) / 100) * hi * 100) / 100,
        showLabel: true,
      });
    }
    top = hi;
  } else {
    const half = wEm / 2;
    const zoneImgs = zones.map((z) => (z.imageUrl ? ctx.images.add(z.imageUrl, 'zone') : null));
    if (zones.some((z, i) => z.imageUrl && !zoneImgs[i])) ctx.notes.push(`${ctx.name}: nicht alle Bilder der Zonen übernommen.`);
    top = pad;
    zones.forEach((z, i) => {
      const img = zoneImgs[i];
      const right = correctFor(z);
      const tallest = Math.max(textH, ...right.map((k) => sizes[k].h));
      const lines = single(z) ? 1 : Math.ceil(right.length / 2);
      const h = Math.max(img ? imageH : textH, lines * (tallest + pad) + pad);
      fixed.push(img
        ? { type: imageType(img, z.hideText ? '' : z.label, z.label), x: pad, y: top, w: imageW(img, imageH), h: imageH }
        : { type: textType(z.label), x: pad, y: top, w: half - 2 * pad, h: textH });
      // Mit Bild steht der Name an der Zone – außer er ist verborgen.
      zoneBoxes.push({ x: half + pad, y: top, w: half - 2 * pad, h, showLabel: !!img && !z.hideText });
      top += h + pad;
    });
  }

  // Ziehbare Elemente zeilenweise im Streifen darunter anordnen.
  let cx = pad;
  let rowTop = 0;
  let rowH = 0;
  const placed = sizes.map((s) => {
    if (cx > pad && cx + s.w > wEm - pad) { cx = pad; rowTop += rowH + pad; rowH = 0; }
    const pos = { x: cx, y: top + pad + rowTop };
    cx += s.w + pad;
    rowH = Math.max(rowH, s.h);
    return pos;
  });
  const H = (top + pad + rowTop + rowH + pad) * em;
  const pctX = (e: number) => Math.round(((e * em) / W) * 10000) / 100;
  const pctY = (e: number) => Math.round(((e * em) / H) * 10000) / 100;

  const elements: any[] = fixed.map((f) => ({
    type: f.type, x: pctX(f.x), y: pctY(f.y), width: f.w, height: f.h, dropZones: [], backgroundOpacity: 0, multiple: false,
  }));
  const offset = elements.length;
  drags.forEach((d, i) => {
    elements.push({
      type: dragImgs[i] ? imageType(dragImgs[i]!, d.text, d.text) : textType(d.text),
      x: pctX(placed[i].x),
      y: pctY(placed[i].y),
      width: sizes[i].w,
      height: sizes[i].h,
      dropZones: zones.map((_z, k) => String(k)),
      backgroundOpacity: 100,
      multiple: !!d.multiple,
    });
  });

  const dropZones = zones.map((z, k) => ({
    label: `<div>${esc(z.label)}</div>`,
    showLabel: zoneBoxes[k].showLabel,
    x: pctX(zoneBoxes[k].x),
    y: pctY(zoneBoxes[k].y),
    width: zoneBoxes[k].w,
    height: zoneBoxes[k].h,
    correctElements: correctFor(z).map((i) => String(i + offset)),
    backgroundOpacity: 50,
    tipsAndFeedback: { tip: '', feedbackOnCorrect: '', feedbackOnIncorrect: '' },
    // Mehrere richtige Elemente brauchen Platz für alle; eine Gruppenzone nimmt eins.
    single: single(z),
    autoAlign: true,
  }));

  return [sub(ctx, 'H5P.DragQuestion', {
    question: {
      settings: { size: { width: W, height: Math.round(H) } },
      task: { elements, dropZones },
    },
    behaviour: { enableRetry: true, enableCheckButton: true, singlePoint: false, applyPenalties: true, showTitle: true },
  })];
};

/**
 * Reihenfolge → Drag and Drop mit nummerierten Plätzen (eine Sortieraufgabe
 * nimmt das Fragenset nicht an). Links die Elemente gemischt, rechts die
 * Plätze 1, 2, 3 … Gleiche Elemente passen auf die Plätze des jeweils anderen.
 * Ein H5P-Element ist Text oder Bild – bei beidem gewinnt das Bild.
 */
const convertSorting: Converter = (c, ctx) => {
  const p = puzzles();
  const items = p.sortingItems(c);
  if (items.length < 2) return null;
  const imgs = items.map((it) => (it.imageUrl ? ctx.images.add(it.imageUrl, 'element') : null));
  if (items.some((it, i) => it.imageUrl && !imgs[i])) ctx.notes.push(`${ctx.name}: nicht alle Bilder übernommen.`);
  if (items.some((it, i) => it.text && imgs[i])) ctx.notes.push(`${ctx.name}: bei Elementen mit Bild und Text nur das Bild übernommen.`);

  const W = 620;
  const em = 16;
  const pad = 0.5;
  const rowH = imgs.some(Boolean) ? 6 : 2.5;
  const H = items.length * (rowH + pad) * em + pad * em;
  const half = W / em / 2;
  const pctX = (e: number) => Math.round(((e * em) / W) * 10000) / 100;
  const pctY = (e: number) => Math.round(((e * em) / H) * 10000) / 100;
  const rowY = (i: number) => pad + i * (rowH + pad);

  // Startplätze gemischt, aber fest: dieselbe Datei ergibt dasselbe Paket.
  const start = p.shuffleForSorting(items, p.seededRandom(items.length * 31 + 7));
  const slotOf = new Map(start.map((it, i) => [it.index, i]));
  const elements = items.map((it, i) => ({
    type: imgs[i]
      ? {
        library: ctx.store.ref('H5P.Image'),
        params: fillDefaults(ctx.store.semantics('H5P.Image'), { file: { path: imgs[i]!.path, mime: imgs[i]!.mime, width: imgs[i]!.width, height: imgs[i]!.height }, alt: it.text }, null),
        subContentId: ctx.sub(),
        metadata: { contentType: 'Image', license: 'U', title: it.text.slice(0, 40) || `Bild ${i + 1}` },
      }
      : {
        library: ctx.store.ref('H5P.AdvancedText'),
        params: { text: `<p>${esc(it.text)}</p>` },
        subContentId: ctx.sub(),
        metadata: { contentType: 'Text', license: 'U', title: it.text.slice(0, 40) },
      },
    x: pctX(pad),
    y: pctY(rowY(slotOf.get(it.index)!)),
    width: half - 2 * pad,
    height: rowH,
    dropZones: items.map((_z, k) => String(k)),
    backgroundOpacity: 100,
    multiple: false,
  }));
  const dropZones = items.map((it, i) => ({
    label: `<div>${i + 1}.</div>`,
    showLabel: true,
    x: pctX(half + pad),
    y: pctY(rowY(i)),
    width: half - 2 * pad,
    height: rowH,
    correctElements: items.filter((o) => o.key === it.key).map((o) => String(o.index)),
    backgroundOpacity: 50,
    tipsAndFeedback: { tip: '', feedbackOnCorrect: '', feedbackOnIncorrect: '' },
    single: true,
    autoAlign: true,
  }));
  return [sub(ctx, 'H5P.DragQuestion', {
    question: {
      settings: { size: { width: W, height: Math.round(H) } },
      task: { elements, dropZones },
    },
    behaviour: { enableRetry: true, enableCheckButton: true, singlePoint: false, applyPenalties: true, showTitle: true },
  })];
};

/** Kreuzworträtsel → Lückentext: je Hinweis eine Zeile mit dem Lösungswort als Lücke. */
const convertCrossword: Converter = (c, ctx) => {
  const words = puzzles().crosswordWords(c);
  if (!words.length) return null;
  ctx.notes.push(`${ctx.name}: Kreuzworträtsel gibt es im H5P-Fragenset nicht – als Lückentext exportiert.`);
  if (words.some((w) => w.imageUrl)) ctx.notes.push(`${ctx.name}: Bilder zu den Hinweisen nicht übernommen.`);
  return [sub(ctx, 'H5P.Blanks', {
    media: media('', ctx),
    text: ctx.intro + (c.taskDescription || ''),
    questions: words.map((w) => `<p>${esc(w.clue || '…')}: *${esc(w.text.replace(/[*/]/g, ' '))}*</p>`),
    behaviour: { caseSensitive: false, showSolutionsRequiresInput: true, enableRetry: true, enableSolutionsButton: true },
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
  sorting: convertSorting,
  crossword: convertCrossword,
};

const TYPE_NAMES: Record<string, string> = {
  worksheet: 'Arbeitsblatt', document: 'Dokument', flashcards: 'Karteikarten', dictation: 'Diktat', arithmeticQuiz: 'Rechenquiz',
  branchingScenario: 'Verzweigung', video: 'Video', audioRecorder: 'Audio-Aufnahme', accordion: 'Akkordeon',
  collage: 'Collage', coursePresentation: 'Präsentation', dialogCards: 'Dialogkarten', imageHotspots: 'Bild-Hotspots',
  iframeEmbedder: 'Eingebettete Seite', formula: 'Formelaufgabe', memory: 'Memory',
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
    if (m.type === 'dragAndDrop' || m.type === 'sorting') { used.add('H5P.AdvancedText'); used.add('H5P.Image'); }
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
