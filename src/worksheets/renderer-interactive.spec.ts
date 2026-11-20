import { withoutInteractiveCode } from './renderer.client';

describe('Druck: interaktive Darstellungen', () => {
  it('ersetzt Code mit view: result durch einen Hinweis – auch in Lösungen und Skripten', () => {
    const job = {
      sheets: [{ titel: 'A', spec: { content: [
        { type: 'code', run: true, code: 'print(1)' },
        { type: 'solution', blocks: [{ type: 'code', run: true, view: 'result', code: 'regler("f", 1, 2)' }] },
      ] } }],
      outputs: ['pdf'],
    };
    const out: any = withoutInteractiveCode(job);
    expect(out.sheets[0].spec.content[0]).toEqual({ type: 'code', run: true, code: 'print(1)' });
    expect(out.sheets[0].spec.content[1].blocks[0].type).toBe('note');
    expect(out.outputs).toEqual(['pdf']);
    expect(job.sheets[0].spec.content[1].blocks[0].type).toBe('code'); // Original unverändert
  });
});
