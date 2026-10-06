// KI-Prompt-Generator: baut einen Prompt, mit dem eine KI (ChatGPT, Claude,
// Le Chat …) ein Lernthema als JSON-Datei erzeugt, die "📥 Thema
// importieren" direkt einliest.
//
// Die Feldbeschreibungen kommen aus H5P_TYPES – passt sich ein Editor an,
// passt sich der Prompt mit an. Dazu je Typ ein kleines Beispiel im echten
// Format und die Regeln, an denen KIs erfahrungsgemäß scheitern.

/** Aufgabentypen, die der Generator anbietet – alle automatisch bewertbar. */
export const AI_PROMPT_TYPES = ['multipleChoice', 'trueFalse', 'fillInTheBlanks', 'dragTheWords', 'markTheWords', 'dragAndDrop'];

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
  dragAndDrop: {
    taskDescription: 'Ordne die Bauteile ihrer Einheit zu.',
    backgroundImage: '',
    dropZones: [
      { label: 'Ohm', x: 5, y: 10, width: 28, height: 30 },
      { label: 'Farad', x: 36, y: 10, width: 28, height: 30 },
      { label: 'Henry', x: 67, y: 10, width: 28, height: 30 },
    ],
    draggables: [
      { text: 'Widerstand', correctZone: 'Ohm', multiple: false },
      { text: 'Kondensator', correctZone: 'Farad', multiple: false },
      { text: 'Spule', correctZone: 'Henry', multiple: false },
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
    'Mehrere Sätze mit \\n trennen.',
  ],
  dragAndDrop: [
    'Jede Zone hat eine eindeutige "label"; jedes Element nennt in "correctZone" genau diese Bezeichnung.',
    'Je Zone genau EIN richtiges Element – sonst kann die Aufgabe nie ganz richtig werden. Weitere Elemente ohne Zone sind Ablenker ("correctZone": "").',
    'Positionen x, y, width, height in Prozent (0–100), Zonen dürfen sich nicht überlappen.',
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
    if (f.type === 'list') for (const sub of f.itemFields || []) out.push(line(sub, '    '));
  }
  return out;
}

function typeName(type) {
  return (typeof H5P_TYPES !== 'undefined' && H5P_TYPES[type]?.name) || type;
}

/**
 * Prompt aus den Angaben des Dialogs.
 * @param o.title, o.description, o.level, o.language, o.count, o.types,
 *          o.files (Dateinamen, Text), o.link, o.linkImages
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

  L.push('## Inhalte');
  if (files.length) {
    L.push('Verwende ausschließlich die Inhalte der angehängten Materialien:');
    for (const f of files) L.push(`- ${f}`);
    L.push('Erfinde keine Fakten, die dort nicht stehen. Fehlt etwas Wichtiges, lass es weg.');
  } else {
    L.push('Falls Materialien angehängt sind, verwende ausschließlich deren Inhalte. Sonst stütze dich auf gesichertes Fachwissen passend zur Beschreibung.');
  }
  if (link) {
    L.push(`Weitere Materialien liegen hier: ${link}`);
    if (o.linkImages) {
      L.push('Bilder aus diesem öffentlichen Ordner darfst du als direkten Download-Link einbinden ("imageUrl" bzw. bei Drag and Drop "backgroundImage"),'
        + ' im Format <Ordner-Link>/download?path=/&files=<Dateiname>. Nur Dateien verwenden, die es dort wirklich gibt.');
    }
  }
  if (!link || !o.linkImages) {
    L.push('Bilder: "imageUrl" und "backgroundImage" bleiben leer (""). Bilder ergänzt die Lehrkraft später.');
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
  L.push('- Gültiges JSON: doppelte Anführungszeichen, keine Kommentare, kein Komma nach dem letzten Element.');
  L.push('- Prüfe vor der Ausgabe jede Aufgabe auf fachliche Richtigkeit und eindeutige Lösung.');
  return L.join('\n');
}
