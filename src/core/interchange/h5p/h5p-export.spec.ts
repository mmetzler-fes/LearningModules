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

  it('fillDefaults: Gruppe mit einem Feld wird flach gespeichert', () => {
    const sem = [{ name: 'g', type: 'group', fields: [{ name: 'x', type: 'text', default: 'A' }] }, { name: 'n', type: 'number', default: 3 }];
    expect(fillDefaults(sem, {}, null)).toEqual({ g: 'A', n: 3 });
    expect(fillDefaults(sem, { n: 5 }, [{ fields: [{ default: 'Ä' }] }, {}])).toEqual({ g: 'Ä', n: 5 });
  });
});
