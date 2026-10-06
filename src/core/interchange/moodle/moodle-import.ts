import { XmlNode, parseXml, child, children, textOf, decodeEntities } from './xml-lite';
import { imageSize } from './image-size';

/**
 * Moodle-XML (Fragensammlung) → Module dieser App.
 *
 * Jede Frage wird zu einem Modul. Was sich nicht abbilden lässt, landet mit
 * Grund in `skipped`; was nur vereinfacht ankommt, mit Hinweis in `notes` –
 * der Import meldet beides, statt still etwas wegzulassen.
 */

export interface MoodleModule {
  title: string;
  type: string;
  description: string;
  content: any;
  orderIndex: number;
}

export interface MoodleImportResult {
  title: string;
  modules: MoodleModule[];
  skipped: string[];
  notes: string[];
}

// ---- Hilfen für Text und Dateien ----

/** HTML zu einfachem Text: Absätze und Umbrüche bleiben als Zeilen erhalten. */
export function htmlToText(html: string): string {
  return decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
};

interface MoodleFile { name: string; dataUrl: string; buffer: Buffer }

/** Eingebettete Dateien (<file name="…" encoding="base64">) eines Elements. */
function filesOf(node: XmlNode | undefined): MoodleFile[] {
  return children(node, 'file')
    .filter((f) => (f.attrs.encoding || 'base64') === 'base64' && f.text.trim())
    .map((f) => {
      const name = f.attrs.name || 'bild';
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const b64 = f.text.replace(/\s+/g, '');
      return { name, dataUrl: `data:${MIME[ext] || 'application/octet-stream'};base64,${b64}`, buffer: Buffer.from(b64, 'base64') };
    })
    .filter((f) => f.dataUrl.startsWith('data:image/'));
}

/**
 * Text eines Moodle-Textfelds (questiontext, feedback …) als HTML, Bilder
 * herausgelöst: Das erste wird zu `image`, im Text bleiben keine
 * @@PLUGINFILE@@-Verweise zurück.
 */
function richText(node: XmlNode | undefined, ctx?: Ctx): { html: string; image: string } {
  const html = textOf(node, 'text');
  const files = filesOf(node);
  let image = '';
  let cleaned = html.replace(/<img[^>]*src="@@PLUGINFILE@@\/([^"]+)"[^>]*>/gi, (_m, file: string) => {
    const f = files.find((x) => x.name === decodeURIComponent(file));
    if (f && !image) image = f.dataUrl;
    return '';
  });
  // Verweise auf andere Anhänge (Audio, PDF …) führen hier ins Leere – Text behalten.
  cleaned = cleaned.replace(/<a[^>]*href="@@PLUGINFILE@@[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (_m, inner: string) => {
    ctx?.notes.push(`${ctx.name}: Dateianhang (z. B. Audio) nicht übernommen.`);
    return inner;
  });
  return { html: cleaned.replace(/<p>\s*<\/p>/gi, '').trim(), image };
}

/** Fragetext samt Bild – auch aus dem alten Feld <image_base64> von Moodle 1.9. */
function questionText(q: XmlNode, ctx?: Ctx): { html: string; image: string } {
  const text = richText(child(q, 'questiontext'), ctx);
  const b64 = textOf(q, 'image_base64').replace(/\s+/g, '');
  if (!text.image && b64) {
    const ext = (textOf(q, 'image').split('.').pop() || 'png').toLowerCase();
    if (MIME[ext]) text.image = `data:${MIME[ext]};base64,${b64}`;
  }
  return text;
}

/** Wörtliche Sternchen würden als Lücke gelesen – durch das gleich aussehende ∗ ersetzen. */
const literalStars = (s: string) => s.replace(/\*/g, '\u2217');

const fraction = (a: XmlNode) => parseFloat(a.attrs.fraction || '0') || 0;

/** Lückenwert: Alternativen mit "/" – Sternchen und Schrägstriche im Wort entfernen. */
const gapWord = (s: string) => htmlToText(s).replace(/[*/]/g, ' ').replace(/\s+/g, ' ').trim();

// ---- Fragetypen ----

type Converter = (q: XmlNode, ctx: Ctx) => Omit<MoodleModule, 'title' | 'orderIndex'> | null;

interface Ctx { notes: string[]; name: string }

const convertMultichoice: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const answers = children(q, 'answer').map((a) => ({
    text: htmlToText(textOf(a, 'text')),
    correct: fraction(a) > 0,
    tip: htmlToText(textOf(a, 'feedback', 'text')),
  })).filter((a) => a.text);
  if (answers.length === 0) return null;
  const single = textOf(q, 'single');
  return {
    type: 'multipleChoice',
    description: '',
    content: {
      question: text.html,
      imageUrl: text.image,
      answers,
      singleAnswer: single ? single === 'true' || single === '1' : answers.filter((a) => a.correct).length <= 1,
      randomAnswers: textOf(q, 'shuffleanswers') !== '0' && textOf(q, 'shuffleanswers') !== 'false',
      enableRetry: true,
      enableSolutionsButton: true,
      passPercentage: 100,
    },
  };
};

const convertTrueFalse: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const answers = children(q, 'answer');
  const right = answers.find((a) => fraction(a) >= 100) || answers[0];
  const wrong = answers.find((a) => a !== right);
  if (!right) return null;
  return {
    type: 'trueFalse',
    description: '',
    content: {
      imageUrl: text.image,
      questions: [{
        question: htmlToText(text.html),
        correctAnswer: /^(true|wahr|richtig)$/i.test(textOf(right, 'text')) ? 'true' : 'false',
        feedbackCorrect: htmlToText(textOf(right, 'feedback', 'text')) || 'Richtig!',
        feedbackWrong: htmlToText(textOf(wrong, 'feedback', 'text')) || 'Leider falsch.',
      }],
      randomOrder: false,
      enableRetry: true,
      enableSolutionsButton: true,
    },
  };
};

/** Kurzantwort und Zahl: Aufgabentext oben, darunter eine Lücke mit allen vollen Antworten. */
const convertShortAnswer: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const right = children(q, 'answer').filter((a) => fraction(a) >= 100).map((a) => gapWord(textOf(a, 'text'))).filter(Boolean);
  if (right.length === 0) return null;
  // Platzhalter (*) in Moodle-Kurzantworten gibt es hier nicht.
  if (right.some((r) => r.includes('*')) || children(q, 'answer').some((a) => textOf(a, 'text').includes('*'))) {
    ctx.notes.push(`${ctx.name}: Platzhalter (*) in der Antwort entfernt.`);
  }
  if (q.attrs.type === 'numerical' && children(q, 'answer').some((a) => parseFloat(textOf(a, 'tolerance') || '0') > 0)) {
    ctx.notes.push(`${ctx.name}: Toleranz bei Zahlenantworten entfällt – nur der genaue Wert zählt.`);
  }
  return {
    type: 'fillInTheBlanks',
    description: '',
    content: {
      taskDescription: text.html,
      imageUrl: text.image,
      questions: [{ text: `Antwort: *${[...new Set(right)].join('/')}*` }],
      caseSensitive: textOf(q, 'usecase') === '1',
      enableRetry: true,
      enableSolutionsButton: true,
      showSolutionsRequiresInput: true,
    },
  };
};

/**
 * Lückentext (Cloze): {1:SHORTANSWER:=Berlin#Gut~%50%Bonn} usw. Jede Lücke
 * wird zu *Antwort/Alternative*; Auswahllücken (MULTICHOICE) werden zu
 * Eingabelücken mit der richtigen Option.
 */
export function clozeToGaps(text: string): { text: string; choiceGaps: number; gaps: number } {
  let choiceGaps = 0;
  let gaps = 0;
  // Sternchen außerhalb der Lücken sind Text (z. B. Aufzählungen).
  text = text.replace(/\{[^{}]*\}|\*/g, (m) => (m === '*' ? '\u2217' : m));
  const out = text.replace(/\{(\d*):([A-Z_]+):((?:\\.|[^}\\])*)\}/g, (m, _w, kind: string, body: string) => {
    const parts = body.split(/(?<!\\)~/).map((p) => p.replace(/\\(.)/g, '$1'));
    const right = parts
      .map((p) => /^(=|%100%)(.*)$/.exec(p.trim()))
      .filter(Boolean)
      .map((r) => gapWord((r as RegExpExecArray)[2].split(/(?<!\\)#/)[0]))
      .filter(Boolean);
    if (right.length === 0) return m;
    gaps++;
    if (/^(MULTICHOICE|MC|MULTIRESPONSE|MR)/.test(kind)) choiceGaps++;
    return `*${[...new Set(right)].join('/')}*`;
  });
  return { text: out, choiceGaps, gaps };
}

const convertCloze: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const { text: withGaps, choiceGaps, gaps } = clozeToGaps(htmlToText(text.html));
  if (gaps === 0) return null;
  if (choiceGaps) ctx.notes.push(`${ctx.name}: ${choiceGaps} Auswahllücke(n) als Eingabelücke übernommen.`);
  // Absätze mit Lücke werden Sätze, der Rest Aufgabenbeschreibung.
  const lines = withGaps.split('\n').map((l) => l.trim()).filter(Boolean);
  const intro = lines.filter((l) => !l.includes('*'));
  const questions = lines.filter((l) => l.includes('*')).map((l) => ({ text: l }));
  return {
    type: 'fillInTheBlanks',
    description: '',
    content: {
      taskDescription: intro.map((l) => `<p>${escapeHtml(l)}</p>`).join(''),
      imageUrl: text.image,
      questions,
      caseSensitive: false,
      enableRetry: true,
      enableSolutionsButton: true,
      showSolutionsRequiresInput: true,
    },
  };
};

/** Drag and Drop in Text bzw. Auswahl in Text: [[n]] → *Wort*. */
const convertDragIntoText: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const boxTag = q.attrs.type === 'gapselect' ? 'selectoption' : 'dragbox';
  const boxes = children(q, boxTag).map((b) => htmlToText(textOf(b, 'text')).replace(/[*|]/g, ' ').trim());
  const used = new Set<number>();
  const body = literalStars(text.html).replace(/\[\[(\d+)\]\]/g, (m, n: string) => {
    const word = boxes[Number(n) - 1];
    if (!word) return m;
    used.add(Number(n) - 1);
    return `*${word}*`;
  });
  if (used.size === 0) return null;
  const distractors = boxes.filter((w, i) => w && !used.has(i) && !boxes.some((x, k) => used.has(k) && x === w));
  if (new Set(children(q, boxTag).map((b) => textOf(b, 'group'))).size > 1) {
    ctx.notes.push(`${ctx.name}: Wortgruppen zusammengefasst – alle Wörter passen in jede Lücke.`);
  }
  return {
    type: 'dragTheWords',
    description: '',
    content: {
      taskDescription: '',
      imageUrl: text.image,
      textField: body,
      distractors: distractors.map((d) => `*${d}*`).join(' '),
      enableRetry: true,
      enableSolutionsButton: true,
      instantFeedback: false,
    },
  };
};

/** Zuordnung: je Teilfrage eine Zone, die Antworten als ziehbare Elemente. */
const convertMatch: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const subs = children(q, 'subquestion').map((s) => ({
    label: htmlToText(textOf(s, 'text')),
    answer: htmlToText(textOf(s, 'answer', 'text')),
  })).filter((s) => s.answer);
  const pairs = subs.filter((s) => s.label);
  if (pairs.length === 0) return null;
  const cols = pairs.length > 4 ? 3 : 2;
  const rows = Math.ceil(pairs.length / cols);
  const w = Math.floor(90 / cols);
  const h = Math.min(30, Math.floor(85 / rows));
  // Gleiche Zonennamen würden die Zuordnung vermischen – durchnummerieren.
  const labels = pairs.map((p, i) => (pairs.filter((x) => x.label === p.label).length > 1 ? `${p.label} (${i + 1})` : p.label));
  return {
    type: 'dragAndDrop',
    description: '',
    content: {
      taskDescription: text.html,
      backgroundImage: text.image,
      dropZones: pairs.map((_p, i) => ({
        label: labels[i], x: 5 + (i % cols) * w, y: 5 + Math.floor(i / cols) * (h + 3), width: w - 4, height: h,
        correctDraggable: pairs[i].answer, group: '',
      })),
      draggables: [
        ...pairs.map((p, i) => ({ text: p.answer, correctZone: labels[i], multiple: false })),
        ...subs.filter((s) => !s.label).map((s) => ({ text: s.answer, correctZone: '', multiple: false })),
      ],
    },
  };
};

/** Gruppenname wie im Editor: Gruppe A, B, … */
const groupName = (n: number) => {
  let s = '';
  for (let k = n; k >= 0; k = Math.floor(k / 26) - 1) s = String.fromCharCode(65 + (k % 26)) + s;
  return `Gruppe ${s}`;
};

/**
 * Zonen, die dasselbe Element erwarten, werden eine Ablagegruppe – so ist
 * egal, welche Kopie in welcher landet (z. B. drei Bahnhöfe auf einer Karte).
 */
function groupSameChoice(zones: Array<{ correctDraggable: string; group: string }>) {
  const byChoice = new Map<string, typeof zones>();
  for (const z of zones) {
    if (!z.correctDraggable) continue;
    byChoice.set(z.correctDraggable, [...(byChoice.get(z.correctDraggable) || []), z]);
  }
  let n = 0;
  for (const list of byChoice.values()) {
    if (list.length < 2) continue;
    const name = groupName(n++);
    for (const z of list) z.group = name;
  }
}

const pct = (v: number, total: number) => Math.round((v / total) * 1000) / 10;

/** Drag and Drop auf Bild: Pixelpositionen auf dem Hintergrundbild → Prozent. */
const convertDdImage: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const bg = filesOf(q)[0];
  const size = bg && imageSize(bg.buffer);
  if (!bg || !size) return null;
  const drags = children(q, 'drag').map((d) => {
    const lines = htmlToText(textOf(d, 'text')).split('\n').filter(Boolean);
    return {
      no: textOf(d, 'no'),
      text: lines.join(' ') || (filesOf(d)[0] ? `Bild ${textOf(d, 'no')}` : ''),
      lines,
      image: !!filesOf(d)[0],
      infinite: !!child(d, 'infinite'),
    };
  });
  if (drags.some((d) => d.image)) ctx.notes.push(`${ctx.name}: Bild-Elemente als Text „Bild n“ übernommen.`);
  // Moodle bemisst die Zone nach dem größten Element (mehrzeilig möglich);
  // hier eine Schätzung aus Zeilenlänge und Zeilenzahl.
  const longest = Math.max(4, ...drags.flatMap((d) => d.lines.map((l) => l.length)));
  const lineCount = Math.max(1, ...drags.map((d) => d.lines.length));
  const boxW = Math.min(size.width * 0.4, longest * 7.5 + 16);
  const boxH = Math.min(size.height * 0.4, lineCount * 18 + 10);
  const zones = children(q, 'drop').map((d, i) => {
    const choice = drags.find((x) => x.no === textOf(d, 'choice'));
    return {
      label: htmlToText(textOf(d, 'text')) || String(i + 1),
      x: pct(parseFloat(textOf(d, 'xleft')) || 0, size.width),
      y: pct(parseFloat(textOf(d, 'ytop')) || 0, size.height),
      width: pct(boxW, size.width),
      height: pct(boxH, size.height),
      correctDraggable: choice?.text || '',
      group: '',
    };
  });
  groupSameChoice(zones);
  const zoneOf = (dragText: string) => zones.find((z) => z.correctDraggable === dragText)?.label || '';
  return {
    type: 'dragAndDrop',
    description: '',
    content: {
      taskDescription: text.html,
      backgroundImage: bg.dataUrl,
      dropZones: zones,
      draggables: drags.filter((d) => d.text).map((d) => ({
        text: d.text,
        correctZone: zoneOf(d.text),
        multiple: d.infinite || zones.filter((z) => z.correctDraggable === d.text).length > 1,
      })),
    },
  };
};

/** Markierungen: Kreis, Rechteck oder Vieleck als umschließendes Rechteck. */
export function markerBox(shape: string, coords: string): { x: number; y: number; w: number; h: number } | null {
  const nums = coords.split(/[;,]/).map((n) => parseFloat(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (shape === 'circle' && nums.length >= 3) {
    const [cx, cy, r] = nums;
    return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  }
  if (shape === 'rectangle' && nums.length >= 4) {
    const [x, y, w, h] = nums;
    return { x, y, w, h };
  }
  if (nums.length >= 4) {
    const xs = nums.filter((_n, i) => i % 2 === 0);
    const ys = nums.filter((_n, i) => i % 2 === 1);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return null;
}

const convertDdMarker: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const bg = filesOf(q)[0];
  const size = bg && imageSize(bg.buffer);
  if (!bg || !size) return null;
  const drags = children(q, 'drag').map((d) => ({
    no: textOf(d, 'no'), text: htmlToText(textOf(d, 'text')), count: parseInt(textOf(d, 'noofdrags') || '1', 10),
  }));
  // Zonen unter 6 % lassen sich mit dem Finger kaum treffen – um die Mitte vergrößern.
  const MIN = 6;
  const zones = children(q, 'drop').map((d, i) => {
    const box = markerBox(textOf(d, 'shape'), textOf(d, 'coords'));
    if (!box) return null;
    let x = pct(box.x, size.width), y = pct(box.y, size.height);
    let w = pct(box.w, size.width), h = pct(box.h, size.height);
    if (w < MIN) { x -= (MIN - w) / 2; w = MIN; }
    if (h < MIN) { y -= (MIN - h) / 2; h = MIN; }
    const choice = drags.find((x2) => x2.no === textOf(d, 'choice'));
    return {
      label: String(i + 1),
      x: Math.max(0, Math.round(x * 10) / 10), y: Math.max(0, Math.round(y * 10) / 10),
      width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10,
      correctDraggable: choice?.text || '', group: '',
    };
  }).filter(Boolean) as Array<{ label: string; x: number; y: number; width: number; height: number; correctDraggable: string; group: string }>;
  if (zones.length === 0) return null;
  if (children(q, 'drop').some((d) => textOf(d, 'shape') === 'polygon')) {
    ctx.notes.push(`${ctx.name}: Vieleck-Zonen als umschließendes Rechteck übernommen.`);
  }
  groupSameChoice(zones);
  return {
    type: 'dragAndDrop',
    description: '',
    content: {
      taskDescription: text.html,
      backgroundImage: bg.dataUrl,
      dropZones: zones,
      draggables: drags.filter((d) => d.text).map((d) => ({
        text: d.text,
        correctZone: zones.find((z) => z.correctDraggable === d.text)?.label || '',
        // noofdrags 0 = unbegrenzt; mehrere Zonen für dasselbe Element brauchen Kopien.
        multiple: d.count !== 1 || zones.filter((z) => z.correctDraggable === d.text).length > 1,
      })),
    },
  };
};

const convertEssay: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  return {
    type: 'essay',
    description: '',
    content: {
      taskDescription: htmlToText(text.html),
      imageUrl: text.image,
      sampleSolution: htmlToText(textOf(q, 'graderinfo', 'text')),
      minChars: 0,
      inputFieldSize: 10,
      enableRetry: true,
      ignoreScoring: true,
      pointsHost: 1,
    },
  };
};

const convertDescription: Converter = (q, ctx) => {
  const text = questionText(q, ctx);
  const img = text.image ? `<p><img src="${text.image}" alt="" /></p>` : '';
  return { type: 'worksheet', description: '', content: { html: text.html + img } };
};

const CONVERTERS: Record<string, Converter> = {
  multichoice: convertMultichoice,
  truefalse: convertTrueFalse,
  shortanswer: convertShortAnswer,
  numerical: convertShortAnswer,
  multianswer: convertCloze,
  cloze: convertCloze,
  ddwtos: convertDragIntoText,
  gapselect: convertDragIntoText,
  match: convertMatch,
  matching: convertMatch,
  ddimageortext: convertDdImage,
  ddmarker: convertDdMarker,
  essay: convertEssay,
  description: convertDescription,
};

const UNSUPPORTED: Record<string, string> = {
  calculated: 'Berechnete Fragen gibt es hier nicht',
  calculatedsimple: 'Berechnete Fragen gibt es hier nicht',
  calculatedmulti: 'Berechnete Fragen gibt es hier nicht',
  randomsamatch: 'Zufällige Zuordnung braucht die Moodle-Fragensammlung',
  random: 'Zufallsfrage braucht die Moodle-Fragensammlung',
};

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Ist das eine Moodle-XML-Datei? (<quiz> als Wurzel) */
export function looksLikeMoodleXml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 2048).toString('utf-8').replace(/^﻿/, '');
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<quiz[\s>]/.test(head);
}

export function convertMoodleXml(xml: string, fallbackTitle = 'Moodle-Import'): MoodleImportResult {
  let root: XmlNode;
  try {
    root = parseXml(xml.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`Die XML-Datei lässt sich nicht lesen: ${(e as Error).message}`);
  }
  if (root.name !== 'quiz') throw new Error('Keine Moodle-XML-Datei (Wurzelelement <quiz> fehlt).');

  const modules: MoodleModule[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];
  let category = '';

  for (const q of children(root, 'question')) {
    const type = q.attrs.type || '';
    if (type === 'category') {
      // "$course$/top/Spanisch/Vokabeln" → "Vokabeln" als Titelvorschlag
      const path = textOf(q, 'category', 'text') || textOf(q, 'category');
      const last = path.split('/').map((s) => s.trim()).filter((s) => s && !/^\$\w+\$$/.test(s) && s !== 'top').pop();
      if (last && !/^(Default for|Standard für)/i.test(last) && !category) category = last;
      continue;
    }
    // Fragenamen sind in Moodle reiner Text – keine Tags entfernen.
    const name = textOf(q, 'name', 'text').replace(/\s+/g, ' ').trim() || `Frage ${modules.length + skipped.length + 1}`;
    const convert = CONVERTERS[type];
    if (!convert) {
      skipped.push(`${name} (${type || 'ohne Typ'}): ${UNSUPPORTED[type] || 'Fragetyp wird nicht unterstützt'}`);
      continue;
    }
    let mod: ReturnType<Converter> = null;
    try {
      mod = convert(q, { notes, name });
    } catch {
      mod = null;
    }
    if (!mod) {
      skipped.push(`${name} (${type}): Inhalt unvollständig – nichts zum Übernehmen`);
      continue;
    }
    modules.push({ ...mod, title: `${modules.length + 1}. ${name}`, orderIndex: modules.length });
  }
  return { title: category || fallbackTitle, modules, skipped, notes: [...new Set(notes)] };
}
