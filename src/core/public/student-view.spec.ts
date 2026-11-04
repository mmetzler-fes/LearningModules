import { embeddedQuizIds, forStudents, hasSolutionBlocks, studentModule, withoutSolutionBlocks } from './student-view';

describe('Eingebettete Quizze eines Dokuments', () => {
  it('findet Quiz-Blöcke auch in Aufgaben und Kästen, jedes einmal', () => {
    const doc = {
      type: 'document',
      content: JSON.stringify({
        spec: {
          content: [
            { type: 'quiz', module: 'q1' },
            { type: 'task', title: 'A', blocks: [{ type: 'box', blocks: [{ type: 'quiz', module: 'q2' }, { type: 'quiz', module: 'q1' }] }] },
          ],
        },
      }),
    };
    expect(embeddedQuizIds(doc)).toEqual(['q1', 'q2']);
  });

  it('andere Modultypen betten nichts ein', () => {
    expect(embeddedQuizIds({ type: 'quiz', content: { spec: { content: [{ type: 'quiz', module: 'x' }] } } })).toEqual([]);
  });
});

describe('Lösungen für Schüler', () => {
  const spec = { content: [
    { type: 'text', text: 'Aufgabe' },
    { type: 'solution', blocks: [{ type: 'text', text: 'GEHEIM' }] },
    { type: 'task', blocks: [{ type: 'box', blocks: [{ type: 'solution', blocks: [{ type: 'text', text: 'GEHEIM' }] }, { type: 'text', text: 'bleibt' }] }] },
    { type: 'table', rows: [[{ blocks: [{ type: 'solution', blocks: [{ type: 'text', text: 'GEHEIM' }] }] }]] },
  ] };
  const doc = { id: 'd', type: 'document', content: { kind: 'arbeitsblatt', spec, legacyHtml: '<p>GEHEIM</p>' } };

  it('entfernt Lösungen überall und das alte HTML', () => {
    const out = JSON.stringify(forStudents(doc));
    expect(out).not.toContain('GEHEIM');
    expect(out).toContain('bleibt');
    expect(out).toContain('arbeitsblatt');
  });
  it('liest gespeicherten JSON-Text', () => {
    expect(JSON.stringify(forStudents({ ...doc, content: JSON.stringify(doc.content) }))).not.toContain('GEHEIM');
  });
  it('freigegebene Lösung bleibt, das alte HTML nicht', () => {
    const out = JSON.stringify(studentModule((m) => m.id === 'd')(doc));
    expect(out.match(/GEHEIM/g)).toHaveLength(3);
    expect(out).not.toContain('legacyHtml');
  });
  it('gilt auch für Untermodule', () => {
    expect(JSON.stringify(forStudents({ id: 'r', type: 'x', subModules: [doc] }))).not.toContain('GEHEIM');
  });
  it('lässt sich direkt an map geben', () => {
    expect(JSON.stringify([doc].map(forStudents))).not.toContain('GEHEIM');
  });
  it('erkennt Dokumente mit Lösung', () => {
    expect(hasSolutionBlocks(doc)).toBe(true);
    expect(hasSolutionBlocks({ type: 'document', content: { spec: withoutSolutionBlocks(spec) } })).toBe(false);
    expect(hasSolutionBlocks({ type: 'text', content: { spec } })).toBe(false);
  });
  it('Audio Recorder weiter ohne Zugang', () => {
    const out: any = forStudents({ type: 'audioRecorder', content: { uploadUrl: 'u', uploadPassword: 'p', a: 1 } });
    expect(out.content).toEqual({ a: 1, uploadConfigured: true });
  });
});
