import { studentInkSpec } from './student-ink-pdf';
import { withoutSolutionBlocks } from './student-view';

describe('Schüler-PDF aus dem Stift-Editor', () => {
  const full = { content: [{ type: 'section', text: 'A' }, { type: 'solution', blocks: ['geheim'] }, 'Text', { type: 'karo', height: 3 }] };
  const stripped = withoutSolutionBlocks(full);
  const ink = { overlays: [{ path: '2', svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>', x: 0, y: 0, w: 10, h: 10 }] };

  it('nimmt das Dokument, wie der Schüler es sieht (ohne Lösungen, mit Block-IDs), und setzt die Beschriftung ein', () => {
    const sent = JSON.parse(JSON.stringify(stripped));
    sent.content[0].id = 'b_abc';
    sent.content[1] = { type: 'text', text: 'Text', id: 'b_x' };
    const { spec, full: isFull } = studentInkSpec(sent, full, stripped, ink);
    expect(isFull).toBe(false);
    expect(spec.content[2].ink).toMatchObject({ x: 0, w: 10 });
    expect(JSON.stringify(spec)).not.toContain('geheim');
  });

  it('lehnt ein verändertes Dokument ab (z. B. eingeschmuggelte Inhalte)', () => {
    const sent = { content: [{ type: 'section', text: 'Anderes' }] };
    expect(() => studentInkSpec(sent, full, stripped, ink)).toThrow(/geändert/);
  });

  it('freigegebene Lösungen: volles Dokument erlaubt', () => {
    expect(studentInkSpec(JSON.parse(JSON.stringify(full)), full, stripped, {}).full).toBe(true);
  });
});
