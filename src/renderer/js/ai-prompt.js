// KI-Prompt-Generator: baut einen Prompt, mit dem eine KI (ChatGPT, Claude,
// Le Chat …) ein Lernthema als JSON-Datei erzeugt, die "📥 Thema
// importieren" direkt einliest.
//
// Die Feldbeschreibungen kommen aus H5P_TYPES – passt sich ein Editor an,
// passt sich der Prompt mit an. Dazu je Typ ein kleines Beispiel im echten
// Format und die Regeln, an denen KIs erfahrungsgemäß scheitern.

/**
 * Aufgabentypen, die der Generator anbietet – alle automatisch bewertbar bis
 * auf Memory, ein Übungsspiel (zählt nicht in die Punkte).
 */
export const AI_PROMPT_TYPES = ['multipleChoice', 'trueFalse', 'fillInTheBlanks', 'dragTheWords', 'markTheWords', 'dragAndDrop', 'formula',
  'sorting', 'crossword', 'memory'];

/**
 * Module je Antwort. Längere Antworten brechen KIs gern mitten im JSON ab
 * (Gemini z. B. nach etwa sechs Modulen) – die Datei ist dann unbrauchbar.
 * Darüber hinaus kommt das Thema deshalb in mehreren vollständigen Teilen.
 */
export const AI_PROMPT_PART_SIZE = 5;

/** Kleines Beispiel je Typ – nur `content`, im Format, das der Import erwartet. */
export const AI_PROMPT_EXAMPLES = {
  multipleChoice: {
    question: 'Welches Bauteil speichert elektrische Ladung?',
    imageUrl: '',
    answers: [
      { text: 'Kondensator', correct: true, tip: 'Er besteht aus zwei Platten mit Isolator dazwischen.' },
      { text: 'Widerstand', correct: false, tip: '' },
      { text: 'Diode', correct: false, tip: '' },
      { text: 'Schalter', correct: false, tip: '' },
    ],
    singleAnswer: true,
    randomAnswers: true,
  },
  trueFalse: {
    imageUrl: '',
    questions: [
      { question: 'Ein Kondensator lässt Gleichstrom dauerhaft durch.', correctAnswer: 'false',
        feedbackCorrect: 'Richtig – nach dem Aufladen fließt kein Strom mehr.', feedbackWrong: 'Denk an den aufgeladenen Kondensator.' },
      { question: 'Die Einheit der Kapazität ist Farad.', correctAnswer: 'true',
        feedbackCorrect: 'Richtig!', feedbackWrong: 'Leider falsch.' },
    ],
    randomOrder: true,
  },
  fillInTheBlanks: {
    taskDescription: 'Ergänze die Lücken.',
    imageUrl: '',
    questions: [
      { text: 'Die Einheit der Kapazität ist *Farad/F*.' },
      { text: 'Ein Kondensator besteht aus zwei *Platten* und einem *Isolator/Dielektrikum*.' },
    ],
    caseSensitive: false,
  },
  dragTheWords: {
    taskDescription: 'Ziehe die Wörter in die richtigen Lücken.',
    imageUrl: '',
    textField: 'Ein Kondensator *speichert* elektrische *Ladung|Energie*. Seine Kapazität wird in *Farad* angegeben.',
    distractors: '*Ohm* *Volt*',
  },
  markTheWords: {
    taskDescription: 'Markiere alle Bauteile.',
    imageUrl: '',
    textField: 'Im Stromkreis liegen ein *Widerstand*, eine *Diode* und ein *Kondensator* an der Spannung.',
  },
  formula: {
    question: '<p>An einem Widerstand R = {R} Ω liegt die Spannung U = {U} V. Berechne Strom und Leistung.</p>',
    imageUrl: '',
    variables: [
      { name: 'U', min: 5, max: 24, decimals: 1 },
      { name: 'R', min: 10, max: 470, decimals: 0 },
    ],
    results: [
      { label: 'Strom I', formula: 'U/R', unit: 'A', tolerance: 1, toleranceType: 'relative', decimals: 3 },
      { label: 'Leistung P', formula: 'U^2/R', unit: 'W', tolerance: 1, toleranceType: 'relative', decimals: 2 },
    ],
    allowNewValues: true,
  },
  sorting: {
    taskDescription: 'Bringe die Arbeitsschritte beim Löten in die richtige Reihenfolge.',
    items: [
      { text: 'Bauteil einsetzen und Beinchen umbiegen', imageUrl: '' },
      { text: 'Lötstelle mit der Lötspitze erwärmen', imageUrl: '' },
      { text: 'Lötzinn zuführen', imageUrl: '' },
      { text: 'Lötkolben abnehmen und abkühlen lassen', imageUrl: '' },
      { text: 'Überstehende Beinchen abschneiden', imageUrl: '' },
    ],
    layout: 'vertical',
  },
  crossword: {
    taskDescription: 'Löse das Kreuzworträtsel zu elektrischen Größen.',
    words: [
      { answer: 'Kondensator', clue: 'Bauteil, das elektrische Ladung speichert', imageUrl: '' },
      { answer: 'Spannung', clue: 'Größe mit der Einheit Volt', imageUrl: '' },
      { answer: 'Widerstand', clue: 'Bauteil, das den Strom begrenzt', imageUrl: '' },
      { answer: 'Ampere', clue: 'Einheit der Stromstärke', imageUrl: '' },
      { answer: 'Leistung', clue: 'Produkt aus Spannung und Strom', imageUrl: '' },
      { answer: 'Diode', clue: 'Lässt Strom nur in eine Richtung durch', imageUrl: '' },
    ],
    seed: 0,
  },
  memory: {
    taskDescription: 'Finde die Paare aus Größe und Einheit.',
    pairs: [
      { aText: 'Spannung', aImage: '', bText: 'Volt', bImage: '' },
      { aText: 'Stromstärke', aImage: '', bText: 'Ampere', bImage: '' },
      { aText: 'Widerstand', aImage: '', bText: 'Ohm', bImage: '' },
      { aText: 'Kapazität', aImage: '', bText: 'Farad', bImage: '' },
      { aText: 'Leistung', aImage: '', bText: 'Watt', bImage: '' },
      { aText: 'Frequenz', aImage: '', bText: 'Hertz', bImage: '' },
    ],
  },
  dragAndDrop: {
    taskDescription: 'Ordne jedem Bauteil seine Einheit zu.',
    layout: 'pairs',
    dropZones: [
      { label: 'Widerstand', correctDraggable: 'Ohm', imageUrl: '', hideText: false },
      { label: 'Kondensator', correctDraggable: 'Farad', imageUrl: '', hideText: false },
      { label: 'Spule', correctDraggable: 'Henry', imageUrl: '', hideText: false },
    ],
    draggables: [
      { text: 'Ohm', correctZone: 'Widerstand', imageUrl: '', hideText: false, multiple: false },
      { text: 'Farad', correctZone: 'Kondensator', imageUrl: '', hideText: false, multiple: false },
      { text: 'Henry', correctZone: 'Spule', imageUrl: '', hideText: false, multiple: false },
      { text: 'Volt', correctZone: '', imageUrl: '', hideText: false, multiple: false },
    ],
  },
};

/** Regeln je Typ, die sich nicht aus den Feldern ablesen lassen. */
const RULES = {
  multipleChoice: [
    'Genau eine richtige Antwort → "singleAnswer": true; mehrere richtige → "singleAnswer": false.',
    '3–5 Antworten, plausible Ablenker. "tip" erklärt kurz, warum eine Antwort stimmt oder nicht (darf leer sein).',
  ],
  trueFalse: [
    '"correctAnswer" ist der Text "true" oder "false" (in Anführungszeichen, kein Boolean).',
    'Mehrere Aussagen zu einem Thema gehören als Liste in EIN Modul; jede wird einzeln abgefragt.',
    'Ausgewogen wahr und falsch, keine doppelten Verneinungen.',
  ],
  fillInTheBlanks: [
    'Jede Lücke steht in *Sternchen*: *Antwort*. Alternative richtige Antworten mit / trennen: *Farad/F*.',
    'Ein Satz je Listeneintrag in "questions". Lücken nur für eindeutige Begriffe.',
  ],
  dragTheWords: [
    'Ziehbare Wörter stehen im Text in *Sternchen*. Mehrere richtige Wörter für eine Lücke mit | trennen: *Ladung|Energie*.',
    '"distractors" enthält zusätzliche falsche Wörter, ebenfalls in *Sternchen*, durch Leerzeichen getrennt (darf leer sein).',
    'Hier nie / als Trenner verwenden – das gehört zum Lückentext.',
  ],
  markTheWords: [
    'Die richtig zu markierenden Wörter stehen im Text in *Sternchen*, alle anderen ohne.',
    'Jeder Satz braucht mindestens ein Wort in *Sternchen* – ohne Sternchen gibt es nichts zu markieren und die Aufgabe ist unlösbar.',
    'Mehrere Sätze mit \\n trennen.',
  ],
  formula: [
    'Für Rechenaufgaben: Im Text stehen Variablen als {Name}; jeder Schüler bekommt Zufallswerte zwischen "min" und "max".',
    'Formeln mit + - * / ^ und Klammern, Dezimalzahlen mit Punkt, Funktionen z. B. sqrt(), sin() (Bogenmaß), deg2rad(), rad2deg(), ln(), log10(), pi.',
    'Wertebereiche so wählen, dass die Ergebnisse sinnvoll sind (keine Division durch 0, keine negativen Wurzeln).',
    '"tolerance" in Prozent ("relative") oder als feste Abweichung ("absolute"); "decimals" = Nachkommastellen der Lösung.',
  ],
  dragAndDrop: [
    'Kein Hintergrundbild und keine Positionen: Die Zonen stehen als Liste, die Plattform ordnet sie selbst an.',
    'Paare (Begriff ↔ Erklärung, Wort ↔ Übersetzung, Bild ↔ Wort): "layout": "pairs", je Zone genau ein Element. 4–8 Paare.',
    'Gruppen (Elemente in Kategorien einsortieren): "layout": "", 2–4 Zonen als Gruppennamen, je Gruppe 2–5 Elemente mit dieser Zone als "correctZone".',
    'Jede Zone hat eine eindeutige "label"; jedes Element nennt in "correctZone" genau diese Bezeichnung. Bei Paaren steht in "correctDraggable" der Text des passenden Elements.',
    'Ablenker sind Elemente mit "correctZone": "" – höchstens zwei.',
    'Bild statt Text (nur mit einem Bild aus der Liste oben): "imageUrl" setzen und "hideText": true, wenn der Text die Lösung verraten würde. "label" bzw. "text" bleibt trotzdem ausgefüllt und eindeutig.',
  ],
  sorting: [
    '"items" stehen in der RICHTIGEN Reihenfolge – die Plattform mischt sie für die Schüler selbst.',
    '3–8 Elemente mit eindeutiger Reihenfolge (Arbeitsschritte, Zeitfolgen, Größen). Keine zwei Elemente, deren Reihenfolge strittig ist.',
    'Jedes Element ist ein Objekt mit "text" (und "imageUrl"), keine bloße Zeichenkette. Elemente kurz halten.',
    '"layout": "vertical"; "horizontal" nur bei sehr kurzen Texten.',
  ],
  crossword: [
    '"answer" ist ein einzelnes Wort oder ein fester Begriff. Leerzeichen und Bindestriche fallen im Gitter weg; Umlaute und ß sind je ein Feld.',
    '6–12 Wörter mit mindestens 3 Buchstaben, die gemeinsame Buchstaben haben – nur so kreuzen sie sich.',
    '"clue" ist eine eindeutige Frage oder Umschreibung, die das Lösungswort nicht enthält.',
    '"seed": 0 – das Gitter ordnet die Plattform selbst an.',
  ],
  memory: [
    'Memory ist ein Übungsspiel ohne Bewertung (zählt nicht in die Punkte). Höchstens ein Memory je Thema, nur wenn es ausdrücklich gewünscht ist oder gut passt.',
    '6–10 Paare. "aText" und "bText" gehören zusammen (Begriff ↔ Erklärung, Größe ↔ Einheit, Wort ↔ Übersetzung), höchstens etwa fünf Wörter je Karte.',
    'Jede Karte passt zu genau einem Paar – keine zwei Karten mit gleicher Bedeutung.',
  ],
};

/** Felder eines Typs als Stichpunkte, abgeleitet aus H5P_TYPES. */
function describeFields(type) {
  const def = (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[type]) || null;
  if (!def) return [];
  const line = (f, indent = '') => {
    const parts = [`${indent}- "${f.key}": ${f.label}`];
    if (f.required) parts.push('(Pflicht)');
    if (f.default !== undefined && f.type !== 'list') parts.push(`(Standard: ${JSON.stringify(f.default)})`);
    return parts.join(' ');
  };
  const out = [];
  for (const f of def.fields || []) {
    if (f.advanced) continue;
    out.push(line(f));
    if (f.type === 'list') for (const sub of f.itemFields || []) if (!sub.advanced) out.push(line(sub, '    '));
  }
  return out;
}

/** Beschreibung der Quiz-Typen (Felder, Regeln, Beispiel) – auch für den Dokument-Prompt. */
export function describeQuizTypes(types) {
  const L = [];
  for (const t of types) {
    L.push('');
    L.push(`### "${t}" – ${typeName(t)}`);
    L.push('Felder in "content":');
    L.push(...describeFields(t));
    L.push('Regeln:');
    for (const r of RULES[t] || []) L.push(`- ${r}`);
    L.push('Beispiel für "content":');
    L.push('```json');
    L.push(JSON.stringify(AI_PROMPT_EXAMPLES[t], null, 2));
    L.push('```');
  }
  return L;
}

// ==================== Material aus eigenen Dokumenten ====================

const cellText = (c) => String(c && typeof c === 'object' ? c.text ?? '' : c ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

/**
 * Inhalt eines Dokuments (docspec) als kompakter Text für den Prompt – kürzer
 * als das JSON, und die KI liest ihn wie ein Blatt. Lösungen bleiben drin
 * (markiert), Schreibfelder und Abstände fallen weg, Bilder werden zum
 * Platzhalter mit Bildunterschrift.
 */
export function docSpecToText(spec) {
  const out = [];
  const list = (items, depth, ordered) => (items || []).forEach((it, i) => {
    const text = typeof it === 'object' && it ? it.text : it;
    out.push(`${'  '.repeat(depth)}${ordered ? `${i + 1}.` : '-'} ${String(text ?? '')}`);
    if (it && typeof it === 'object' && Array.isArray(it.items)) list(it.items, depth + 1, ordered);
  });
  const walk = (blocks) => {
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (!b || typeof b !== 'object') continue;
      switch (b.type) {
        case 'section': out.push('', `## ${b.title || b.text || ''}`); break;
        case 'task':
        case 'subtask':
          out.push('', `${b.type === 'task' ? '###' : '####'} Aufgabe: ${b.title || ''}`);
          if (b.title && b.text) out.push(b.text);
          else if (!b.title && b.text) out[out.length - 1] += String(b.text);
          break;
        case 'heading': out.push('', `${'#'.repeat(Math.min(4, (Number(b.level) || 1) + 1))} ${b.text || b.title || ''}`); break;
        case 'text': out.push(String(b.text ?? '')); break;
        case 'note': out.push(`Hinweis: ${b.text ?? ''}`); break;
        case 'list': list(b.items, 0, !!b.ordered); break;
        case 'code': out.push(`\`\`\`${b.caption ? ` ${b.caption}` : ''}`, String(b.code ?? ''), '```'); break;
        case 'formula': out.push(`Formel (StarMath): ${b.math ?? ''}`); break;
        case 'image': out.push(`[Abbildung${b.caption ? `: ${b.caption}` : ''}]`); break;
        case 'quiz': out.push(`[Eingebettetes Quiz${b.title ? `: ${b.title}` : ''}]`); break;
        case 'table': {
          const rows = Array.isArray(b.rows) ? b.rows : [];
          const head = Array.isArray(b.header) ? b.header : null;
          const width = Math.max(1, ...[head, ...rows].filter(Array.isArray).map((r) => r.length));
          const line = (r) => `| ${Array.from({ length: width }, (_, i) => cellText(r[i])).join(' | ')} |`;
          out.push(line(head || Array(width).fill('')), `|${' --- |'.repeat(width)}`, ...rows.filter(Array.isArray).map(line));
          break;
        }
        case 'box': out.push(`[Kasten${b.title ? `: ${b.title}` : ''}]`); if (b.text) out.push(b.text); break;
        case 'solution': out.push('[Lösung]'); if (b.text) out.push(b.text); break;
        default: break;
      }
      if (Array.isArray(b.blocks)) walk(b.blocks);
      if (b.type === 'box') out.push('[Ende Kasten]');
      if (b.type === 'solution') out.push('[Ende Lösung]');
    }
  };
  if (spec?.title) out.push(`# ${spec.title}`);
  walk(spec?.content);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Grobe Größe (≈ 4 Zeichen je Token) – lange Prompts schaffen nicht alle Chats. */
export function promptSize(text) {
  const tokens = Math.round(text.length / 4 / 1000);
  return `Umfang etwa ${tokens || '<1'}k Tokens${tokens > 30 ? ' – sehr lang; bei Abbrüchen weniger Dokumente wählen oder in mehreren Durchgängen arbeiten.' : '.'}`;
}

/** Abschnitt „Material“: die Dokumente der Lehrkraft als Text, je mit Pfad und Titel. */
function materialLines(material) {
  const L = [];
  L.push('## Material der Lehrkraft');
  L.push(`Es folgen ${material.length === 1 ? 'ein Dokument' : `${material.length} Dokumente`} der Lehrkraft als Text (Lösungen stehen zwischen [Lösung] und [Ende Lösung], Formeln in StarMath, Abbildungen nur als [Abbildung: …]).`);
  for (const m of material) {
    L.push('');
    L.push(`### ${m.path ? `${m.path} › ` : ''}${m.title || 'Dokument'}`);
    L.push('"""');
    L.push(String(m.text || '').trim() || '(leer)');
    L.push('"""');
  }
  L.push('');
  return L;
}

function typeName(type) {
  return (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[type]?.name) || type;
}

/**
 * Prompt aus den Angaben des Dialogs.
 * @param o.title, o.description, o.level, o.language, o.count, o.types,
 *          o.files (Dateinamen, Text), o.link, o.linkImages,
 *          o.ncImages (Bilder der eigenen Nextcloud als "nc:<Ordner>/<Datei>")
 */
export function buildAiPrompt(o) {
  const types = AI_PROMPT_TYPES.filter((t) => o.types.includes(t));
  const files = String(o.files || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const link = String(o.link || '').trim();
  const count = o.count || 10;
  const parts = Math.ceil(count / AI_PROMPT_PART_SIZE);
  const L = [];

  L.push('Du erstellst ein digitales Lernthema mit Quiz-Aufgaben für den Unterricht.');
  L.push('Das Ergebnis ist EINE JSON-Datei, die eine Lernplattform direkt importiert. Halte das Format exakt ein.');
  L.push('');
  L.push('## Auftrag');
  if (o.title) L.push(`- Thema: ${o.title}`);
  L.push(`- Beschreibung: ${o.description}`);
  if (o.level) L.push(`- Klassenstufe/Niveau: ${o.level}`);
  L.push(`- Sprache der Aufgaben: ${o.language || 'Deutsch'}`);
  L.push(`- Anzahl Module: etwa ${count}, sinnvoll auf diese Aufgabentypen verteilt: ${types.map(typeName).join(', ')}`);
  L.push('- Die Aufgaben steigen im Schwierigkeitsgrad an und decken die Inhalte breit ab.');
  L.push('');

  const material = (o.material || []).filter((m) => m && m.text);
  if (material.length) L.push(...materialLines(material));
  L.push('## Inhalte');
  if (material.length || files.length) {
    L.push(`Verwende ausschließlich ${material.length ? 'das Material oben' : ''}${material.length && files.length ? ' und ' : ''}${files.length ? 'die Inhalte der angehängten Materialien:' : '.'}`);
    for (const f of files) L.push(`- ${f}`);
    L.push('Erfinde keine Fakten, die dort nicht stehen. Fehlt etwas Wichtiges, lass es weg.');
    if (material.length) L.push('Frage den Stoff ab, nicht die Blätter: keine Fragen nach Aufgabennummern, Überschriften oder dem Aufbau des Materials.');
  } else {
    L.push('Falls Materialien angehängt sind, verwende ausschließlich deren Inhalte. Sonst stütze dich auf gesichertes Fachwissen passend zur Beschreibung.');
  }
  // Bilder aus der eigenen Nextcloud: Die KI wählt nur aus der Liste, der
  // Import macht aus "nc:<Ordner>/<Datei>" die Lese-URL. Eine URL selbst zu
  // bauen, überfordert KIs – sie erfinden dann Dateien.
  const ncImages = (o.ncImages || []).filter(Boolean);
  if (ncImages.length) {
    L.push('Bilder: Es gibt NUR die folgenden Bilder. Trage in "imageUrl", "aImage" bzw. "bImage" einen dieser Werte'
      + ' genau so ein, wie er hier steht (mit "nc:"), oder lass das Feld leer (""). Wähle ein Bild nur, wenn sein Dateiname wirklich'
      + ' zur Aufgabe passt; jedes Bild höchstens einmal. Erfinde keine Bilder und keine URLs.');
    for (const r of ncImages) L.push(`- ${r}`);
  }
  if (link) {
    L.push(`Weitere Materialien liegen hier: ${link}`);
    if (o.linkImages && !ncImages.length) {
      L.push('Bilder aus diesem öffentlichen Ordner darfst du als direkten Download-Link einbinden ("imageUrl", bei Memory "aImage"/"bImage"),'
        + ' im Format <Ordner-Link>/download?path=/&files=<Dateiname>. Nur Dateien verwenden, die es dort wirklich gibt.');
    }
  }
  if (!ncImages.length && (!link || !o.linkImages)) {
    L.push('Bilder: "imageUrl", "aImage" und "bImage" bleiben leer (""). Bilder ergänzt die Lehrkraft später.');
  }
  L.push('');

  L.push('## Dateiformat');
  L.push('```json');
  L.push(JSON.stringify({
    topic: {
      title: o.title || 'Titel des Themas',
      description: 'Ein bis zwei Sätze, worum es geht.',
      modules: [{ title: '1. Kurzer Titel der Aufgabe', type: types[0] || 'multipleChoice', description: '', content: { '…': 'je nach Typ, siehe unten' }, orderIndex: 0 }],
    },
  }, null, 2));
  L.push('```');
  L.push('- "orderIndex": 0, 1, 2 … in der gewünschten Reihenfolge, über alle Teile hinweg fortlaufend.');
  L.push('- "title": kurz und nummeriert. "description": optionale Arbeitsanweisung als einfaches HTML (z. B. "<p>…</p>"), sonst "".');
  L.push('- "type": genau einer der Werte unten. "content": Aufbau je Typ wie beschrieben.');
  L.push('');

  L.push('## Aufgabentypen');
  L.push(...describeQuizTypes(types));
  L.push('');

  L.push('## Ausgabe');
  if (parts > 1) {
    L.push(`- Lange Antworten werden abgeschnitten. Gib deshalb höchstens ${AI_PROMPT_PART_SIZE} Module pro Antwort aus – insgesamt ${parts} Teile.`);
    L.push('- Jeder Teil ist eine vollständige, gültige JSON-Datei im obigen Format (mit "topic", "title", "description" und "modules"), die mit } endet.');
    L.push('- Plane vorher alle Module, damit sich nichts wiederholt. Nummerierung in "title" und "orderIndex" laufen über die Teile weiter.');
    L.push(`- Gib nur den JSON-Codeblock aus. Einzige Ausnahme: Direkt danach eine Zeile "Teil x von ${parts} – schreibe »weiter« für den nächsten Teil." (beim letzten Teil weglassen).`);
    L.push('- Auf "weiter" folgt der nächste Teil im selben Format.');
  } else {
    L.push('- Gib NUR den JSON-Code in einem einzigen ```json-Codeblock aus – kein Text davor oder danach.');
  }
  L.push('- Kompakt bleiben: "description" der Module nur, wenn sie über die Aufgabe hinaus etwas sagt, sonst "".');
  L.push('- Lücken- und Markieraufgaben vor der Ausgabe prüfen: Stehen die Lösungswörter wirklich in *Sternchen*?');
  L.push('- Gültiges JSON: doppelte Anführungszeichen, keine Kommentare, kein Komma nach dem letzten Element.');
  L.push('- Prüfe vor der Ausgabe jede Aufgabe auf fachliche Richtigkeit und eindeutige Lösung.');
  return L.join('\n');
}

// ==================== Dokumente (Modultyp „Dokument“) ====================

/** Kleines, vollständiges Beispiel einer Dokument-Spec. */
export const DOC_PROMPT_EXAMPLE = {
  content: [
    { type: 'section', text: 'Worum es geht' },
    { type: 'list', items: ['Du kannst das ohmsche Gesetz anwenden.', 'Du kannst Ströme in einfachen Schaltungen berechnen.'] },
    { type: 'section', text: 'Schritt 1 – Spannung, Strom, Widerstand' },
    { type: 'text', text: 'Der **Widerstand** R begrenzt den Strom. Es gilt:' },
    { type: 'formula', math: 'I = U over R' },
    { type: 'task', title: 'Strom berechnen', text: 'Berechne den Strom für U = 12 V und R = 240 Ω.', blocks: [
      { type: 'karo', lines: 4 },
      { type: 'solution', blocks: [{ type: 'text', text: 'I = U / R = 12 V / 240 Ω = 0,05 A = 50 mA' }] },
    ] },
  ],
};

/**
 * Prompt für Dokumente (Arbeitsblatt, Klassenarbeit, Text). Jedes Blatt ist
 * eine eigene JSON-Datei im Format von „📥 Thema importieren“ mit einem Modul
 * vom Typ "document" – auf Wunsch gefolgt von passenden Quiz-Modulen.
 * @param o.title, o.description, o.kind, o.level, o.language, o.pages, o.sheets,
 *          o.quizCount, o.quizTypes, o.files, o.ncImages, o.guidelines, o.kurs,
 *          o.existing ([{slug, pfad, titel}] für Verweise),
 *          o.examples ([{title, kind, spec}] – vorhandene Blätter als Vorbild)
 */
export function buildDocPrompt(o) {
  const kind = ['arbeitsblatt', 'klassenarbeit', 'text'].includes(o.kind) ? o.kind : 'arbeitsblatt';
  const kindName = { arbeitsblatt: 'Arbeitsblatt', klassenarbeit: 'Klassenarbeit', text: 'Text zum Lesen' }[kind];
  const sheets = Math.max(1, Math.min(10, Number(o.sheets) || 1));
  const quiz = Math.max(0, Math.min(10, Number(o.quizCount) || 0));
  const quizTypes = (o.quizTypes || []).filter((t) => AI_PROMPT_TYPES.includes(t));
  const files = String(o.files || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const ncImages = (o.ncImages || []).filter(Boolean);
  const L = [];

  L.push(`Du erstellst ${sheets === 1 ? `ein ${kindName}` : `${sheets} aufeinander aufbauende Dokumente (${kindName})`} für den Unterricht.`);
  L.push('Das Ergebnis ist eine JSON-Datei je Blatt, die eine Lernplattform direkt importiert und daraus eine Web-Ansicht sowie ein druckfertiges Blatt mit Lösungsblatt (LibreOffice) erzeugt. Halte das Format exakt ein.');
  L.push('');
  L.push('## Auftrag');
  if (o.kurs) L.push(`- Kurs: ${o.kurs}`);
  if (o.title) L.push(`- Thema: ${o.title}`);
  L.push(`- Fragestellung / Inhalt: ${o.description}`);
  if (o.level) L.push(`- Klassenstufe/Niveau: ${o.level}`);
  L.push(`- Sprache: ${o.language || 'Deutsch'}`);
  L.push(`- Umfang: etwa ${Math.max(1, Number(o.pages) || 3)} Seiten A4 je Blatt (gedruckt).`);
  if (quiz) L.push(`- Zusätzlich ${quiz} Quiz-Module zum selben Stoff, im selben Thema hinter dem Dokument.`);
  L.push('');

  if (o.guidelines) {
    L.push('## Fachliche Vorgaben der Lehrkraft (verbindlich)');
    L.push(String(o.guidelines).trim());
    L.push('');
  }

  // Vorhandene Blätter als Vorbild – im selben Format, das die KI liefern soll.
  const examples = (o.examples || []).filter((e) => e && e.spec);
  if (examples.length) {
    L.push('## Vorhandene Blätter als Vorbild');
    L.push(`${examples.length === 1 ? 'Dieses Blatt der Lehrkraft zeigt' : 'Diese Blätter der Lehrkraft zeigen'} Stil, Niveau, Aufbau und Art der Aufgaben – orientiere dich daran (Sprache, Länge der Aufgabenstellungen, Schreibfelder, Lösungen), übernimm aber keine Aufgaben wörtlich. Sie stehen im selben Format, das du liefern sollst ("content.spec").`);
    for (const e of examples) {
      L.push(`### ${e.title || 'Blatt'}${e.kind && e.kind !== 'arbeitsblatt' ? ` (${e.kind})` : ''}`);
      L.push('```json');
      L.push(JSON.stringify(e.spec));
      L.push('```');
    }
    L.push('');
  }

  const material = (o.material || []).filter((m) => m && m.text);
  if (material.length) L.push(...materialLines(material));
  L.push('## Inhalte');
  if (material.length || files.length) {
    L.push(`Verwende ausschließlich ${material.length ? 'das Material oben' : ''}${material.length && files.length ? ' und ' : ''}${files.length ? 'die Inhalte der angehängten Materialien:' : '.'}`);
    for (const f of files) L.push(`- ${f}`);
    L.push('Erfinde keine Fakten, die dort nicht stehen.');
    if (material.length) L.push('Das Material darf neu gegliedert, gekürzt, ergänzt um Erklärungen und Übungen und sprachlich verbessert werden – fachlich bleibt es dabei.');
  } else {
    L.push('Falls Materialien angehängt sind, verwende ausschließlich deren Inhalte. Sonst stütze dich auf gesichertes Fachwissen.');
  }
  if (ncImages.length) {
    L.push('Bilder: Es gibt NUR die folgenden Bilder. Ein Bild ist ein Block {"type": "image", "src": "<Wert genau wie hier>", "width": "8cm", "caption": "…"}; nur verwenden, wenn der Dateiname wirklich passt.');
    for (const r of ncImages) L.push(`- ${r}`);
  } else {
    L.push('Bilder: keine image-Blöcke verwenden. Wo eine Abbildung hilft, schreibe einen note-Block „[Abbildung: …]“ als Platzhalter.');
  }
  L.push('');

  L.push('## Dateiformat (je Blatt eine Datei)');
  L.push('```json');
  const modules = [{ title: o.title || 'Titel des Blatts', type: 'document', description: '', orderIndex: 0, content: { kind, spec: { content: ['… Blöcke, siehe unten …'] } } }];
  if (quiz) modules.push({ title: '1. Kurzer Titel der Aufgabe', type: quizTypes[0] || 'multipleChoice', description: '', content: { '…': 'je nach Typ, siehe unten' }, orderIndex: 1 });
  L.push(JSON.stringify({ topic: { title: o.title || 'Titel des Blatts', description: 'Ein Satz, worum es geht.', modules } }, null, 2));
  L.push('```');
  L.push('');

  L.push('## Blöcke in "content.spec.content"');
  L.push('Ein Blatt ist eine Liste von Blöcken. Überschriften nummeriert das System selbst – nie „Aufgabe 3“ oder „1.2“ in einen Titel schreiben.');
  L.push('- {"type": "section", "text": "…"} – Abschnitt (Ebene 1, nummeriert 1., 2., …)');
  L.push('- {"type": "task", "title": "…", "text": "Aufgabenstellung", "blocks": [ … ]} – Aufgabe (Ebene 2, 1.1 …); "subtask" ebenso für Ebene 3');
  L.push('- {"type": "heading", "level": 1, "text": "…"} – Überschrift OHNE Nummer');
  L.push('- {"type": "text", "text": "…"} – Fließtext; eine Leerzeile (\\n\\n) trennt Absätze; optional "align": "center"');
  L.push('- {"type": "list", "items": ["…", {"text": "…", "items": ["…"]}]} – Aufzählung; "ordered": true für 1. 2. 3.');
  L.push('- {"type": "note", "text": "…"} – kursiver Hinweis');
  L.push('- {"type": "code", "caption": "datei.ino", "code": "…"} – Quelltext, Zeilen mit \\n');
  L.push('- {"type": "formula", "math": "I = U over R"} – freistehende Formel in StarMath (LibreOffice): over, sqrt{…}, x^2, U_A, cdot, %pi, left( … right), Text in "…"');
  L.push('- {"type": "table", "header": ["…", "…"], "rows": [["…", "…"]]} – Tabelle; eine Zelle darf {"text": "…", "colspan": 2} oder "rowspan" sein');
  L.push('- {"type": "box", "title": "Merke", "blocks": [ … ]} – Kasten mit Rahmen');
  L.push('- {"type": "karo", "lines": 6} – Karopapier zum Schreiben (Zeilen à 0,5 cm)');
  L.push('- {"type": "solution", "blocks": [ … ]} – Musterlösung: im Arbeitsblatt ausgeblendet, im Lösungsblatt rot über dem Karo davor');
  L.push('- {"type": "spacer", "lines": 3} und {"type": "pagebreak"} – nur sparsam');
  L.push('Auszeichnung im Text: **fett**, *kursiv*, `code`, x^{2}, CO_{2}, n_S (Index), [Link](https://…). Ein \\ am Zeilenende erzwingt den Umbruch.');
  L.push('');
  L.push('Beispiel für "content.spec":');
  L.push('```json');
  L.push(JSON.stringify(DOC_PROMPT_EXAMPLE, null, 2));
  L.push('```');
  L.push('');

  L.push('## Regeln');
  if (kind === 'arbeitsblatt') {
    L.push('- Aufbau: „Worum es geht“ mit Lernzielen → mehrere Abschnitte „Schritt n – …“ → „Sicherung“ mit Abschlussübung.');
    L.push('- Kleinschrittig: erst erklären, dann ein Beispiel zeigen, dann üben lassen. Neue Begriffe beim ersten Auftreten erklären.');
  } else if (kind === 'klassenarbeit') {
    L.push('- Keine Erklärteile: nur Aufgaben (task) mit Punktzahl im Titel, z. B. „Strom berechnen (4 P)“. Am Anfang ein note mit Hilfsmitteln und Gesamtpunktzahl.');
  } else {
    L.push('- Ein gut lesbarer Text mit Überschriften (heading/section), Beispielen und Merkkästen (box); Aufgaben nur, wo sie dem Verständnis dienen.');
  }
  if (kind !== 'text') {
    L.push('- Zu jeder Aufgabe gehören ein karo-Block und direkt danach ein solution-Block. Karozeilen nach Antwortumfang: kurze Antwort 4–6, Erklärung 6–8, Rechnung zwei je Rechenschritt.');
    L.push('- Musterlösungen erklären auch das Warum, nicht nur das Ergebnis. Typische Fehler gezielt als Aufgabe aufgreifen.');
  }
  const existing = (o.existing || []).filter((e) => e && e.slug);
  if (existing.length) {
    L.push('- Verweise auf vorhandene Blätter nur so: {{blatt:<slug>}} ergibt die Nummer, {{titel:<slug>}} den Titel. Vorhandene Blätter:');
    for (const e of existing.slice(0, 80)) L.push(`  - ${e.slug}: ${e.pfad ? `${e.pfad} ` : ''}${e.titel}`);
  }
  if (sheets > 1) L.push('- Gib jedem Blatt in "content.slug" einen Kurznamen (klein, mit _), damit spätere Blätter mit {{blatt:…}} darauf verweisen können.');
  L.push('');

  if (quiz) {
    L.push('## Quiz-Module (nach dem Dokument, orderIndex 1, 2 …)');
    L.push(`Etwa ${quiz} Module zum Stoff des Blatts, sinnvoll verteilt auf: ${quizTypes.map(typeName).join(', ')}.`);
    L.push(...describeQuizTypes(quizTypes));
    L.push('');
  }

  L.push('## Ausgabe');
  if (sheets > 1) {
    L.push(`- Je Antwort GENAU EIN Blatt als vollständige JSON-Datei in einem einzigen \`\`\`json-Codeblock – insgesamt ${sheets} Antworten.`);
    L.push(`- Plane vorher alle Blätter, damit sie aufeinander aufbauen und sich nichts wiederholt. Nach dem Codeblock nur die Zeile „Blatt x von ${sheets} – schreibe »weiter« für das nächste.“ (beim letzten weglassen).`);
  } else {
    L.push('- Gib NUR den JSON-Code in einem einzigen ```json-Codeblock aus – kein Text davor oder danach.');
  }
  L.push('- Gültiges JSON: doppelte Anführungszeichen, Zeilenumbrüche in Texten als \\n, keine Kommentare, kein Komma nach dem letzten Element.');
  L.push('- Prüfe vor der Ausgabe alles auf fachliche Richtigkeit und eindeutige Lösungen.');
  return L.join('\n');
}
