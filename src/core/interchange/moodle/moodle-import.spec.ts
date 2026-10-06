import { convertMoodleXml, clozeToGaps, looksLikeMoodleXml, markerBox } from './moodle-import';
import { imageSize } from './image-size';

/** Kopf eines PNG mit gegebener Größe – mehr liest imageSize nicht. */
function pngHeader(width: number, height: number): string {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf.toString('base64');
}

const quiz = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n${body}\n</quiz>`;
const q = (type: string, name: string, inner: string) =>
  `<question type="${type}"><name><text>${name}</text></name>${inner}</question>`;
const text = (s: string) => `<questiontext format="html"><text><![CDATA[${s}]]></text></questiontext>`;

describe('Moodle-XML-Import', () => {
  it('erkennt Moodle-XML am Wurzelelement', () => {
    expect(looksLikeMoodleXml(Buffer.from(quiz('')))).toBe(true);
    expect(looksLikeMoodleXml(Buffer.from('<!-- x -->\n<quiz>'))).toBe(true);
    expect(looksLikeMoodleXml(Buffer.from('{"topic":{}}'))).toBe(false);
    expect(looksLikeMoodleXml(Buffer.from('<html><body>'))).toBe(false);
  });

  it('nimmt den Titel aus der Kategorie', () => {
    const r = convertMoodleXml(quiz(
      '<question type="category"><category><text>$course$/top/Spanisch/Vokabeln</text></category></question>'
      + q('truefalse', 'TF', text('Madrid ist die Hauptstadt.')
        + '<answer fraction="100"><text>true</text><feedback><text>Genau</text></feedback></answer>'
        + '<answer fraction="0"><text>false</text><feedback><text>Nein</text></feedback></answer>'),
    ));
    expect(r.title).toBe('Vokabeln');
    expect(r.modules[0]).toMatchObject({
      type: 'trueFalse',
      title: '1. TF',
      content: { questions: [{ question: 'Madrid ist die Hauptstadt.', correctAnswer: 'true', feedbackCorrect: 'Genau', feedbackWrong: 'Nein' }] },
    });
  });

  it('Multiple Choice mit Feedback als Tipp und Einzel-/Mehrfachwahl', () => {
    const r = convertMoodleXml(quiz(q('multichoice', 'MC', text('<p>Welche Farbe?</p>')
      + '<single>false</single><shuffleanswers>0</shuffleanswers>'
      + '<answer fraction="50"><text>Rot</text><feedback><text>ja</text></feedback></answer>'
      + '<answer fraction="50"><text>Gelb</text></answer>'
      + '<answer fraction="-100"><text>Blau</text></answer>')));
    expect(r.modules[0].content).toMatchObject({
      question: '<p>Welche Farbe?</p>',
      singleAnswer: false,
      randomAnswers: false,
      answers: [{ text: 'Rot', correct: true, tip: 'ja' }, { text: 'Gelb', correct: true }, { text: 'Blau', correct: false }],
    });
  });

  it('Cloze: Lücken mit Alternativen, Sternchen im Text bleiben Text', () => {
    expect(clozeToGaps('* Paris: {1:SHORTANSWER:=Frankreich~=France#gut~%50%FR}').text)
      .toBe('∗ Paris: *Frankreich/France*');
    const mc = clozeToGaps('{1:MULTICHOICE:Bonn~=Berlin}');
    expect(mc).toEqual({ text: '*Berlin*', choiceGaps: 1, gaps: 1 });
  });

  it('Drag and Drop in Text wird zu Drag the Words mit Ablenkern', () => {
    const r = convertMoodleXml(quiz(q('ddwtos', 'DW', text('Die [[1]] sitzt auf der [[2]].')
      + '<dragbox><text>Katze</text><group>1</group></dragbox>'
      + '<dragbox><text>Matte</text><group>1</group></dragbox>'
      + '<dragbox><text>Hund</text><group>1</group></dragbox>')));
    expect(r.modules[0]).toMatchObject({
      type: 'dragTheWords',
      content: { textField: 'Die *Katze* sitzt auf der *Matte*.', distractors: '*Hund*' },
    });
  });

  it('Zuordnung wird zu Drag and Drop, leere Teilfragen sind Ablenker', () => {
    const r = convertMoodleXml(quiz(q('match', 'Tiere', text('Ordne zu.')
      + '<subquestion><text>Frosch</text><answer><text>Amphibie</text></answer></subquestion>'
      + '<subquestion><text>Katze</text><answer><text>Säugetier</text></answer></subquestion>'
      + '<subquestion><text></text><answer><text>Insekt</text></answer></subquestion>')));
    const c = r.modules[0].content;
    expect(c.dropZones.map((z: any) => [z.label, z.correctDraggable])).toEqual([['Frosch', 'Amphibie'], ['Katze', 'Säugetier']]);
    expect(c.draggables).toEqual([
      { text: 'Amphibie', correctZone: 'Frosch', multiple: false },
      { text: 'Säugetier', correctZone: 'Katze', multiple: false },
      { text: 'Insekt', correctZone: '', multiple: false },
    ]);
  });

  it('Markierungen: Pixel → Prozent, gleiche Marker werden eine Ablagegruppe', () => {
    const bg = `<file name="karte.png" encoding="base64">${pngHeader(400, 200)}</file>`;
    const r = convertMoodleXml(quiz(q('ddmarker', 'Karte', text('Setze die Marker.') + bg
      + '<drag><no>1</no><text>Schule</text><noofdrags>1</noofdrags></drag>'
      + '<drag><no>2</no><text>Bahnhof</text><noofdrags>2</noofdrags></drag>'
      + '<drop><no>1</no><shape>rectangle</shape><coords>40,20;80,40</coords><choice>1</choice></drop>'
      + '<drop><no>2</no><shape>circle</shape><coords>200,100;10</coords><choice>2</choice></drop>'
      + '<drop><no>3</no><shape>polygon</shape><coords>300,100;340,100;320,160</coords><choice>2</choice></drop>')));
    const c = r.modules[0].content;
    expect(c.backgroundImage.startsWith('data:image/png;base64,')).toBe(true);
    expect(c.dropZones[0]).toMatchObject({ x: 10, y: 10, width: 20, height: 20, correctDraggable: 'Schule', group: '' });
    expect(c.dropZones[1]).toMatchObject({ correctDraggable: 'Bahnhof', group: 'Gruppe A', width: 6, height: 10 });
    expect(c.dropZones[2]).toMatchObject({ group: 'Gruppe A', x: 75, y: 50, width: 10, height: 30 });
    expect(c.draggables).toEqual([
      { text: 'Schule', correctZone: '1', multiple: false },
      { text: 'Bahnhof', correctZone: '2', multiple: true },
    ]);
    expect(r.notes.some((n) => n.includes('Vieleck'))).toBe(true);
  });

  it('meldet nicht unterstützte und leere Fragen', () => {
    const r = convertMoodleXml(quiz(
      q('calculated', 'Rechnung', text('{a}+{b}'))
      + q('multichoice', 'Leer', text('Ohne Antworten'))
      + q('essay', 'Aufsatz', text('Schreibe.')),
    ));
    expect(r.modules.map((m) => m.type)).toEqual(['essay']);
    expect(r.skipped).toEqual([
      'Rechnung (calculated): Berechnete Fragen gibt es hier nicht',
      'Leer (multichoice): Inhalt unvollständig – nichts zum Übernehmen',
    ]);
  });

  it('wirft bei Nicht-Moodle-XML', () => {
    expect(() => convertMoodleXml('<html></html>')).toThrow(/Keine Moodle-XML-Datei/);
  });

  it('Hilfsfunktionen: Bildgröße und Markerform', () => {
    expect(imageSize(Buffer.from(pngHeader(640, 480), 'base64'))).toEqual({ width: 640, height: 480 });
    expect(markerBox('circle', '50,60;5')).toEqual({ x: 45, y: 55, w: 10, h: 10 });
    expect(markerBox('rectangle', 'x,1;2,3')).toBeNull();
  });
});
