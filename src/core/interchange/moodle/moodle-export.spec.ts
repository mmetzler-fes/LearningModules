import { exportMoodleXml, nearestGrade } from './moodle-export';
import { convertMoodleXml } from './moodle-import';
import { parseXml, children } from './xml-lite';
import { formulaEngine } from '../../formula/formula-engine';

/** Kleines, gültiges PNG-Kopfstück mit gegebener Größe als data:-URL. */
function pngDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Export und gleich wieder Import – so prüft der Test beide Richtungen. */
const roundTrip = (modules: any[]) => {
  const out = exportMoodleXml('Test', modules);
  return { out, back: convertMoodleXml(out.xml) };
};

describe('Moodle-XML-Export', () => {
  it('rundet auf Moodles erlaubte Bewertungsanteile', () => {
    expect(nearestGrade(100 / 3)).toBe(33.33333);
    expect(nearestGrade(-100 / 6)).toBe(-16.66667);
    expect(nearestGrade(100 / 13)).toBe(10);
  });

  it('Multiple Choice: Einzelwahl hin und zurück', () => {
    const { out, back } = roundTrip([{ type: 'multipleChoice', title: 'Farbe', content: {
      question: '<p>Himmel?</p>', answers: [{ text: 'blau', correct: true, tip: 'Genau' }, { text: 'grün & gelb', correct: false, tip: '' }],
      singleAnswer: true, randomAnswers: true,
    } }]);
    expect(out.count).toBe(1);
    expect(back.title).toBe('Test');
    expect(back.modules[0]).toMatchObject({ type: 'multipleChoice', title: '1. Farbe', content: {
      singleAnswer: true, answers: [{ text: 'blau', correct: true, tip: 'Genau' }, { text: 'grün & gelb', correct: false }],
    } });
  });

  it('Mehrfachauswahl: falsche Kreuze kosten Punkte', () => {
    const { out } = roundTrip([{ type: 'multipleChoice', title: 'MR', content: {
      answers: [{ text: 'a', correct: true }, { text: 'b', correct: true }, { text: 'c', correct: false }], singleAnswer: false,
    } }]);
    const fractions = children(children(parseXml(out.xml), 'question')[1], 'answer').map((a) => a.attrs.fraction);
    expect(fractions).toEqual(['50', '50', '-50']);
  });

  it('Wahr/Falsch: je Aussage eine Frage', () => {
    const { back } = roundTrip([{ type: 'trueFalse', title: 'TF', content: { questions: [
      { question: 'Eins', correctAnswer: 'true', feedbackCorrect: 'ok', feedbackWrong: 'nein' },
      { question: 'Zwei', correctAnswer: 'false' },
    ] } }]);
    expect(back.modules.map((m) => [m.title, m.content.questions[0].question, m.content.questions[0].correctAnswer]))
      .toEqual([['1. TF (1/2)', 'Eins', 'true'], ['2. TF (2/2)', 'Zwei', 'false']]);
    expect(back.modules[0].content.questions[0]).toMatchObject({ feedbackCorrect: 'ok', feedbackWrong: 'nein' });
  });

  it('Lückentext wird Cloze, Alternativen bleiben erhalten', () => {
    const { back } = roundTrip([{ type: 'fillInTheBlanks', title: 'Lücken', content: {
      taskDescription: '<p>Ergänze.</p>', questions: [{ text: 'Die Einheit ist *Farad/F*.' }, { text: 'Ohne Lücke.' }],
    } }]);
    expect(back.modules[0].content.questions).toEqual([{ text: 'Die Einheit ist *Farad/F*.' }]);
  });

  it('Drag the Words: Ablenker und mehrfach genutzte Wörter', () => {
    const { out, back } = roundTrip([{ type: 'dragTheWords', title: 'SQL', content: {
      textField: '*SELECT* a *FROM* t; *SELECT* b *FROM* u', distractors: '*WHERE*',
    } }]);
    expect(out.xml).toContain('<infinite/>');
    expect(back.modules[0].content).toMatchObject({ textField: '<p>*SELECT* a *FROM* t; *SELECT* b *FROM* u</p>', distractors: '*WHERE*' });
  });

  it('Drag and Drop ohne Bild wird Zuordnung – auch mit mehreren Elementen je Zone', () => {
    const { out } = roundTrip([{ type: 'dragAndDrop', title: 'SQL', content: {
      dropZones: [{ label: 'Projektion' }, { label: 'Selektion' }],
      draggables: [{ text: 'SELECT a', correctZone: 'Projektion' }, { text: 'SELECT b', correctZone: 'Projektion' }, { text: 'WHERE x', correctZone: 'Selektion' }],
    } }]);
    const q = children(parseXml(out.xml), 'question')[1];
    expect(q.attrs.type).toBe('match');
    expect(children(q, 'subquestion').length).toBe(3);
  });

  it('Drag and Drop mit Bild: eins je Zone → auf Bild, mehrere → Markierungen', () => {
    const bg = pngDataUrl(400, 200);
    const one = { dropZones: [{ label: 'A', x: 10, y: 20, width: 20, height: 10, correctDraggable: 'a' }, { label: 'B', x: 50, y: 50, width: 20, height: 10 }],
      draggables: [{ text: 'a', correctZone: 'A' }, { text: 'b', correctZone: 'B' }, { text: 'x', correctZone: '' }], backgroundImage: bg };
    const r1 = roundTrip([{ type: 'dragAndDrop', title: 'Bild', content: one }]);
    expect(children(parseXml(r1.out.xml), 'question')[1].attrs.type).toBe('ddimageortext');
    expect(r1.back.modules[0].content.dropZones.map((z: any) => [z.x, z.y, z.correctDraggable])).toEqual([[10, 20, 'a'], [50, 50, 'b']]);

    const many = { ...one, draggables: [...one.draggables, { text: 'a2', correctZone: 'A' }] };
    const r2 = roundTrip([{ type: 'dragAndDrop', title: 'Mehr', content: many }]);
    expect(children(parseXml(r2.out.xml), 'question')[1].attrs.type).toBe('ddmarker');
    expect(r2.out.notes.some((n) => n.includes('Markierungsfrage'))).toBe(true);
    // Zurück: drei Zonen (A doppelt für a und a2), richtige Elemente erhalten
    expect(r2.back.modules[0].content.dropZones.map((z: any) => z.correctDraggable).sort()).toEqual(['a', 'a2', 'b']);
  });

  it('Bilder werden als Moodle-Datei eingebettet', () => {
    const { out, back } = roundTrip([{ type: 'multipleChoice', title: 'Bild', content: {
      question: 'Was ist das?', imageUrl: pngDataUrl(10, 10), answers: [{ text: 'x', correct: true }],
    } }]);
    expect(out.xml).toContain('@@PLUGINFILE@@/bild1_1.png');
    expect(back.modules[0].content.imageUrl).toBe(pngDataUrl(10, 10));
  });

  it('Formelaufgabe: je Ergebnis eine berechnete Frage, Rundreise rechnet gleich', () => {
    const content = {
      question: '<p>U = {U} V, R = {R} Ω (I ≈ {={U}/{R}} A)</p>',
      variables: [{ name: 'U', min: 5, max: 24, decimals: 1 }, { name: 'R', min: 10, max: 470, decimals: 0 }],
      results: [
        { label: 'Strom I', formula: 'U/R', unit: 'A', tolerance: 1, toleranceType: 'relative', decimals: 3 },
        { label: 'Leistung P', formula: 'U^2/R', unit: 'W', tolerance: 0.05, toleranceType: 'absolute', decimals: 2 },
      ],
    };
    const { out, back } = roundTrip([{ type: 'formula', title: 'Ohm', content }]);
    expect(out.count).toBe(2);
    const qs = children(parseXml(out.xml), 'question').slice(1);
    expect(qs.map((x) => x.attrs.type)).toEqual(['calculated', 'calculated']);
    expect(out.xml).toContain('pow({U}, 2) / {R}');
    expect(out.xml).toContain('{={U} / {R}}');
    expect(out.xml).toContain('<tolerance>0.01</tolerance>');
    expect(out.xml).toContain('<tolerancetype>2</tolerancetype>');
    expect(out.xml.match(/<dataset_item>/g)?.length).toBe(2 * 2 * 10); // 2 Fragen × 2 Variablen × 10
    // Zurück: zwei Formelaufgaben, die gleich rechnen
    expect(back.modules.map((m) => m.type)).toEqual(['formula', 'formula']);
    const [i, p] = back.modules.map((m) => m.content.results[0]);
    expect(i).toMatchObject({ unit: 'A', tolerance: 1, toleranceType: 'relative', decimals: 3 });
    expect(p).toMatchObject({ unit: 'W', tolerance: 0.05, toleranceType: 'absolute', decimals: 2 });
    const f = formulaEngine();
    expect(f.evaluate(p.formula, { U: 10, R: 5 })).toBe(20);
    expect(back.modules[0].content.variables).toEqual(content.variables);
  });

  it('meldet, was Moodle nicht kennt', () => {
    const out = exportMoodleXml('T', [
      { type: 'markTheWords', title: 'Markieren', content: { textField: '*a* b' } },
      { type: 'multipleChoice', title: 'Leer', content: { answers: [] } },
      { type: 'essay', title: 'Aufsatz', content: { taskDescription: 'Schreib', sampleSolution: 'So' } },
    ]);
    expect(out.count).toBe(1);
    expect(out.skipped).toEqual([
      'Markieren: Mark the Words gibt es in Moodle-Tests nicht',
      'Leer: Inhalt unvollständig – nichts zu exportieren',
    ]);
  });

  it('Sonderzeichen machen das XML nicht kaputt', () => {
    const out = exportMoodleXml('A/B <&>', [{ type: 'essay', title: 'x ]]> "y" & <z>', content: { taskDescription: 'a ]]> b' } }]);
    const back = convertMoodleXml(out.xml);
    expect(back.modules[0].title).toBe('1. x ]]> "y" & <z>');
    expect(back.modules[0].content.taskDescription).toBe('a ]]> b');
  });
});
