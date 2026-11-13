import { docSpec } from './docspec';
import { escInline, plainText, quizPrintBlocks } from './quiz-print';

const valid = (blocks: any[] | null) => {
  expect(blocks).not.toBeNull();
  // Bilder kommen im Druck als Datei – für die Prüfung reicht eine erlaubte Adresse.
  const json = JSON.stringify(blocks).replace(/"src":"[^"]*"/g, '"src":"https://x.de/a.png"');
  expect(docSpec().validateDocSpec({ content: JSON.parse(json) })).toEqual([]);
};
const solutionText = (blocks: any[]) => JSON.stringify(blocks.filter((b) => b.type === 'solution'));
const studentText = (blocks: any[]) => JSON.stringify(blocks.filter((b) => b.type !== 'solution'));

describe('quiz-print (Druckfassung der Quizze)', () => {
  it('Multiple Choice: Kästchen in derselben festen Mischung, Lösung nur im Lösungsblock', () => {
    const q = { id: 'mc1', type: 'multipleChoice', content: { question: 'Was speichert Ladung?', answers: [
      { text: 'Widerstand', correct: false }, { text: 'Kondensator', correct: true }, { text: 'Diode', correct: false }] } };
    const b = quizPrintBlocks(q)!;
    valid(b);
    const list = b.find((x) => x.type === 'list');
    expect(list.marker).toBe('check');
    expect([...list.items].sort()).toEqual(['Diode', 'Kondensator', 'Widerstand']);
    expect(quizPrintBlocks(q)!.find((x) => x.type === 'list').items).toEqual(list.items);
    expect(solutionText(b)).toContain('Kondensator');
  });

  it('Wahr/Falsch: Tabelle mit Kästchen, Lösung je Nummer', () => {
    const b = quizPrintBlocks({ id: 't', type: 'trueFalse', content: { questions: [
      { question: 'Farad ist die Einheit der Kapazität.', correctAnswer: 'true' }, { question: 'Gleichstrom fließt dauerhaft.', correctAnswer: 'false' }] } })!;
    valid(b);
    expect(b[0].rows[0][0]).toBe('1. Farad ist die Einheit der Kapazität.');
    expect(solutionText(b)).toContain('1. wahr');
    expect(solutionText(b)).toContain('2. falsch');
  });

  it('Lückentext: Lücken statt Antworten, Lösung unterstrichen mit der ersten Variante', () => {
    const b = quizPrintBlocks({ id: 'f', type: 'fillInTheBlanks', content: { taskDescription: '<p>Ergänze.</p>',
      questions: [{ text: 'Die Einheit ist *Farad/F*.' }] } })!;
    valid(b);
    expect(studentText(b)).not.toContain('Farad');
    expect(studentText(b)).toContain('__________');
    expect(solutionText(b)).toContain('++Farad++');
  });

  it('Wörter ziehen: Wortkasten mit Ablenkern, Lücken im Text', () => {
    const b = quizPrintBlocks({ id: 'd', type: 'dragTheWords', content: { textField: 'Der *Sternpunkt|N* ist geerdet.', distractors: '*Phase*' } })!;
    valid(b);
    const bank = b.find((x) => x.type === 'box').blocks[0].text;
    expect(bank).toContain('Sternpunkt');
    expect(bank).toContain('Phase');
    expect(solutionText(b)).toContain('++Sternpunkt++');
  });

  it('Wörter markieren: Text ohne Sternchen, Lösung unterstrichen', () => {
    const b = quizPrintBlocks({ id: 'm', type: 'markTheWords', content: { textField: 'Der *Hund* liegt.' } })!;
    valid(b);
    expect(studentText(b)).toContain('Der Hund liegt.');
    expect(solutionText(b)).toContain('++Hund++');
  });

  it('Drag and Drop auf dem Bild: nummerierte Felder an den Zonen, Lösung je Nummer', () => {
    const q = { id: 'dd', type: 'dragAndDrop', content: { backgroundImage: 'https://lm.example/api/nextcloud/files/a.png',
      dropZones: [{ label: 'Ablagezone 1', correctDraggable: 'SF1', x: 5, y: 10, width: 7.75, height: 4.25 },
        { label: 'Ablagezone 2', correctDraggable: 'N', x: 95, y: 98, width: 20, height: 20 }],
      draggables: [{ text: 'SF1', correctZone: 'Ablagezone 1' }, { text: 'N', correctZone: 'Ablagezone 2' }, { text: 'S', correctZone: '' }] } };
    const b = quizPrintBlocks(q, () => ({ width: 800, height: 400 }))!;
    valid(b);
    const group = b.find((x) => x.type === 'group');
    expect(group.ratio).toBe(0.5);
    expect(group.items[1]).toMatchObject({ text: '1', x: 5, y: 10 });
    expect(group.items[2].x + group.items[2].w).toBeLessThanOrEqual(100);
    expect(solutionText(b)).toContain('1: SF1');
    // Ohne Bildgröße: Zonen als Tabelle
    const t = quizPrintBlocks(q)!;
    valid(t);
    expect(t.some((x) => x.type === 'table')).toBe(true);
  });

  it('Nicht druckbare Typen: null; zusammengesetzte Quizze je Teil', () => {
    expect(quizPrintBlocks({ id: 'x', type: 'flashcards', content: {} })).toBeNull();
    const b = quizPrintBlocks({ id: 's', type: 'questionSet', content: {}, children: [
      { id: 'k', type: 'markTheWords', title: 'Teil 1', content: { textField: '*a* b' } }] })!;
    valid(b);
    expect(b[0].text).toContain('Teil 1');
  });

  it('Text: HTML wird zu Zeilen, Sternchen bleiben Zeichen', () => {
    expect(plainText('<p>A&amp;B</p><p>C<br>D</p>')).toBe('A&B\nC\nD');
    expect(escInline('8*7 [x]')).toBe('8\\*7 \\[x\\]');
  });
});
