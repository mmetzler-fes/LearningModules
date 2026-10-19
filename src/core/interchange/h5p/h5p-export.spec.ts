import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { buildH5pPackage, fillDefaults, LibraryStore } from './h5p-export';
import { processH5pBuffer } from './h5p-parser';

const LIBS = fs.readFileSync(path.resolve(__dirname, '../../../../assets/h5p/libraries.zip'));

/** Kleines PNG-Kopfstück mit gegebener Größe als data:-URL. */
function pngDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const MODULES = [
  { id: 'm1', type: 'multipleChoice', title: '1. Farbe', content: {
    question: '<p>Himmel?</p>', imageUrl: pngDataUrl(20, 10),
    answers: [{ text: 'blau', correct: true, tip: 'Genau' }, { text: 'grün', correct: false }], singleAnswer: true,
  } },
  { id: 'm2', type: 'trueFalse', title: '2. TF', content: { questions: [
    { question: 'Eins', correctAnswer: 'true', feedbackCorrect: 'ok' }, { question: 'Zwei', correctAnswer: 'false' },
  ] } },
  { id: 'm3', type: 'fillInTheBlanks', title: '3. Lücken', content: { questions: [{ text: 'Einheit: *Farad/F*' }], caseSensitive: false } },
  { id: 'm4', type: 'dragTheWords', title: '4. SQL', content: { textField: '<p>*SELECT|select* a *FROM* t</p>', distractors: '*WHERE*' } },
  { id: 'm5', type: 'markTheWords', title: '5. Markieren', content: { textField: 'Der Hund *läuft*.' } },
  { id: 'm6', type: 'essay', title: '6. Aufsatz', content: { taskDescription: 'Schreibe', sampleSolution: 'So' } },
  { id: 'm7', type: 'dragAndDrop', title: '7. Zuordnung', content: {
    backgroundImage: pngDataUrl(400, 200),
    dropZones: [{ label: 'Projektion', x: 0, y: 0, width: 50, height: 50 }, { label: 'Selektion', x: 50, y: 0, width: 50, height: 50 }],
    draggables: [{ text: 'SELECT a', correctZone: 'Projektion' }, { text: 'SELECT b', correctZone: 'Projektion' },
      { text: 'WHERE x', correctZone: 'Selektion' }, { text: 'ORDER BY', correctZone: '' }],
  } },
  { id: 'm8', type: 'worksheet', title: '8. Blatt', content: { html: '<p>x</p>' } },
];

describe('H5P-Export', () => {
  const result = buildH5pPackage('SQL-Grundlagen', MODULES, LIBS);
  const zip = new AdmZip(result.buffer);
  const json = (name: string) => JSON.parse(zip.getEntry(name)!.getData().toString('utf-8'));
  const content = json('content/content.json');
  const lib = (q: any) => q.library.split(' ')[0];

  it('baut ein Fragenset mit einer Frage je Aufgabe (Wahr/Falsch je Aussage)', () => {
    expect(result.count).toBe(8);
    expect(content.questions.map(lib)).toEqual([
      'H5P.MultiChoice', 'H5P.TrueFalse', 'H5P.TrueFalse', 'H5P.Blanks', 'H5P.DragText', 'H5P.MarkTheWords', 'H5P.Essay', 'H5P.DragQuestion',
    ]);
    expect(result.skipped).toEqual(['8. Blatt: Arbeitsblatt gibt es im H5P-Fragenset nicht']);
    expect(result.notes).toEqual(['4. SQL: Lücken mit mehreren richtigen Wörtern – nur das erste übernommen.']);
  });

  it('legt alle nötigen Bibliotheken bei und nennt sie in h5p.json', () => {
    const h5p = json('h5p.json');
    expect(h5p.mainLibrary).toBe('H5P.QuestionSet');
    const store = new LibraryStore(LIBS);
    for (const dep of h5p.preloadedDependencies) {
      // Jede Abhängigkeit (auch transitiv) liegt als Ordner im Paket
      for (const l of store.closure([dep.machineName])) {
        expect(zip.getEntry(`${l.dir}/library.json`)).toBeTruthy();
      }
    }
    // Das Fragenset muss genau diese Versionen der Fragetypen annehmen
    const options = store.semantics('H5P.QuestionSet').find((f: any) => f.name === 'questions').field.options;
    for (const q of content.questions) expect(options).toContain(q.library);
  });

  it('füllt Texte mit den deutschen Vorgaben der Bibliothek', () => {
    const mc = content.questions[0].params;
    expect(mc.UI.checkAnswerButton).toBe('Überprüfen');
    expect(mc.behaviour).toMatchObject({ type: 'single', enableRetry: true, showSolutionsRequiresInput: true });
    expect(content.texts.finishButton).toBeTruthy();
  });

  it('Bilder liegen als Datei im Paket', () => {
    const path0 = content.questions[0].params.media.type.params.file.path;
    expect(path0).toMatch(/^images\/bild-\d+\.png$/);
    expect(zip.getEntry(`content/${path0}`)).toBeTruthy();
  });

  it('Drag and Drop: Bild oben, Elemente darunter, mehrere richtige je Zone', () => {
    const dq = content.questions[7].params.question;
    const [image, ...texts] = dq.task.elements;
    expect(image.type.library).toBe('H5P.Image 1.1');
    expect(image.dropZones).toEqual([]);
    // Elemente starten unterhalb des Bildes (Bild = 310 von insgesamt size.height)
    const imageHeightPct = (310 / dq.settings.size.height) * 100;
    for (const t of texts) expect(t.y).toBeGreaterThanOrEqual(imageHeightPct);
    expect(dq.task.dropZones.map((z: any) => [z.correctElements, z.single])).toEqual([[['1', '2'], false], [['3'], true]]);
  });

  it('Rundreise: unser eigener H5P-Import liest das Paket wieder ein', () => {
    const back = processH5pBuffer(result.buffer, 'SQL-Grundlagen.h5p');
    expect(back.success).not.toBe(false);
    const types = back.topic.modules.map((m: any) => m.type);
    expect(types.slice(0, 4)).toEqual(['multipleChoice', 'trueFalse', 'trueFalse', 'fillInTheBlanks']);
    expect(back.topic.modules[0].content.answers[0]).toMatchObject({ text: 'blau', correct: true, tip: 'Genau' });
  });

  it('Rundreise Drag and Drop mit Bild: Hintergrund statt Element, Zonen relativ zum Bild', () => {
    const back = processH5pBuffer(result.buffer, 'SQL-Grundlagen.h5p');
    const dnd = back.topic.modules.find((m: any) => m.type === 'dragAndDrop').content;
    expect(dnd.backgroundImage).toMatch(/^data:image\/png;base64,/);
    expect(dnd.draggables.map((x: any) => x.text)).toEqual(['SELECT a', 'SELECT b', 'WHERE x', 'ORDER BY']);
    expect(dnd.dropZones.map((z: any) => [z.label, z.x, z.y, z.width, z.height])).toEqual([['Projektion', 0, 0, 50, 50], ['Selektion', 50, 0, 50, 50]]);
  });

  it('Paare: je Zeile feste Karte und Zone, Bilder als H5P.Image – und zurück', () => {
    const pairs = buildH5pPackage('Tiere', [{ id: 'p1', type: 'dragAndDrop', title: 'Tiere', content: {
      layout: 'pairs',
      dropZones: [
        { label: 'Hund', correctDraggable: 'dog' },
        { label: 'Bild 2', correctDraggable: 'cat', imageUrl: pngDataUrl(40, 40), hideText: true },
      ],
      draggables: [
        { text: 'dog', correctZone: 'Hund' },
        { text: 'cat', correctZone: 'Bild 2' },
        { text: 'Maus', correctZone: '', imageUrl: pngDataUrl(80, 40), hideText: true },
      ],
    } }], LIBS);
    expect(pairs.notes).toEqual([]);
    const c = JSON.parse(new AdmZip(pairs.buffer).getEntry('content/content.json')!.getData().toString('utf-8'));
    const dq = c.questions[0].params.question.task;
    const lib = (e: any) => e.type.library.split(' ')[0];
    // Zwei feste Karten (Text, Bild), dann die drei ziehbaren Elemente
    expect(dq.elements.map((e: any) => [lib(e), e.dropZones.length])).toEqual([
      ['H5P.AdvancedText', 0], ['H5P.Image', 0], ['H5P.AdvancedText', 2], ['H5P.AdvancedText', 2], ['H5P.Image', 2],
    ]);
    expect(dq.elements[4].width).toBe(10); // Seitenverhältnis 2:1 bei 5 em Höhe
    expect(dq.dropZones.map((z: any) => [z.correctElements, z.single, z.showLabel])).toEqual([[['2'], true, false], [['3'], true, false]]);
    // Karte und Zone stehen in derselben Zeile, die Zone rechts
    for (const k of [0, 1]) {
      expect(dq.dropZones[k].y).toBe(dq.elements[k].y);
      expect(dq.dropZones[k].x).toBeGreaterThan(dq.elements[k].x);
    }

    const back = processH5pBuffer(pairs.buffer, 'Tiere.h5p').topic.modules[0].content;
    expect(back.layout).toBe('pairs');
    expect(back.backgroundImage).toBe('');
    expect(back.dropZones.map((z: any) => [z.label, z.correctDraggable, !!z.imageUrl, z.hideText])).toEqual([
      ['Hund', 'dog', false, false], ['Bild 2', 'cat', true, true],
    ]);
    expect(back.draggables.map((x: any) => [x.text, x.correctZone, !!x.imageUrl, x.hideText])).toEqual([
      ['dog', 'Hund', false, false], ['cat', 'Bild 2', false, false], ['Maus', '', true, true],
    ]);
  });

  it('Reihenfolge wird Drag and Drop mit nummerierten Plätzen, Kreuzworträtsel Lückentext', () => {
    const more = buildH5pPackage('Spiele', [
      { id: 's1', type: 'sorting', title: 'Ablauf', content: { items: [{ text: 'A' }, { text: 'B', imageUrl: pngDataUrl(40, 30) }, { text: 'A' }] } },
      { id: 'c1', type: 'crossword', title: 'Rätsel', content: { words: [{ answer: 'Ohm', clue: 'Einheit R' }] } },
      { id: 'm1', type: 'memory', title: 'Spiel', content: { pairs: [{ aText: 'a' }, { aText: 'b' }] } },
    ], LIBS);
    const c = JSON.parse(new AdmZip(more.buffer).getEntry('content/content.json')!.getData().toString('utf-8'));
    expect(c.questions.map(lib)).toEqual(['H5P.DragQuestion', 'H5P.Blanks']);
    expect(more.skipped).toEqual(['Spiel: Memory gibt es im H5P-Fragenset nicht']);
    const dq = c.questions[0].params.question.task;
    expect(dq.dropZones.map((z: any) => z.label)).toEqual(['<div>1.</div>', '<div>2.</div>', '<div>3.</div>']);
    // Gleiche Elemente passen auf die Plätze des jeweils anderen
    expect(dq.dropZones.map((z: any) => z.correctElements)).toEqual([['0', '2'], ['1'], ['0', '2']]);
    expect(dq.elements[1].type.library).toBe('H5P.Image 1.1');
    // Die Elemente starten nicht in der richtigen Reihenfolge
    const startOrder = dq.elements.map((e: any, i: number) => [e.y, i]).sort((a: any, b: any) => a[0] - b[0]).map((x: any) => x[1]);
    expect(startOrder).not.toEqual([0, 1, 2]);
    expect(c.questions[1].params.questions).toEqual(['<p>Einheit R: *Ohm*</p>']);
  });

  it('fillDefaults: Gruppe mit einem Feld wird flach gespeichert', () => {
    const sem = [{ name: 'g', type: 'group', fields: [{ name: 'x', type: 'text', default: 'A' }] }, { name: 'n', type: 'number', default: 3 }];
    expect(fillDefaults(sem, {}, null)).toEqual({ g: 'A', n: 3 });
    expect(fillDefaults(sem, { n: 5 }, [{ fields: [{ default: 'Ä' }] }, {}])).toEqual({ g: 'Ä', n: 5 });
  });
});
