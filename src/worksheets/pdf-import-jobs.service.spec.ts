import { PdfImportJobs, figureBlocks } from './pdf-import-jobs.service';

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

function setup({ canStore = true } = {}) {
  const spec = { content: [
    { type: 'text', text: 'Titel' },
    { type: 'image', src: 'data:a', _fig: { page: 2, box: [1, 2, 3, 4], skip: [] } },
    { type: 'box', blocks: [{ type: 'image', src: 'data:b', _fig: { page: 2, box: [5, 6, 7, 8] } }] },
    { type: 'image', src: 'data:c', _fig: { page: 7, box: [1, 1, 9, 9] } },
    { type: 'image', src: 'data:foto' },
  ] };
  const pages: number[] = [];
  const worksheets: any = { importPdf: async () => ({ spec: JSON.parse(JSON.stringify(spec)), title: 'T', warnings: [], mode: 'text' }) };
  const renderer: any = {
    exportPdfFigures: async (_pdf: Buffer, page: number, figs: Array<{ id: string }>) => {
      pages.push(page);
      return { figures: figs.map((f) => ({ id: f.id, svg: Buffer.from('<svg/>'), odg: Buffer.from('odg'), widthMm: 50 })), warnings: [] };
    },
  };
  const drawings: any = {
    canStore: async () => canStore,
    storeImported: async (_u: any, _t: string, _n: string, drawn: Map<string, any>) =>
      new Map([...drawn.keys()].map((id) => [id, { url: `/api/nc/${id}.svg`, source: `/api/nc/${id}.odg` }])),
  };
  return { jobs: new PdfImportJobs(worksheets, renderer, drawings), pages };
}

describe('PDF-Import als Auftrag', () => {
  const user = { userId: 'u1' };

  it('findet Bildbereiche auch in Kästen', () => {
    expect(figureBlocks({ content: [{ type: 'image', _fig: { box: [1] } }, { type: 'box', blocks: [{ type: 'image', _fig: { box: [2] } }] }] })).toHaveLength(2);
  });

  it('Schaubilder Seite für Seite, dann verknüpft mit .odg; Fortschritt zählt mit', async () => {
    const { jobs, pages } = setup();
    const { id } = jobs.start(user, Buffer.from('%PDF'), 'Folien.pdf', { mode: 'text', ocr: false, figures: true, topicId: 't1' });
    await until(() => jobs.get(user, id).state !== 'running');
    const job = jobs.get(user, id);
    expect(job.state).toBe('done');
    expect(pages).toEqual([2, 7]);
    expect(job.total).toBe(3);
    expect(job.done).toBe(3);
    const imgs = figureBlocks(job.result!.spec);
    expect(imgs).toHaveLength(0); // _fig ist weg
    const all = JSON.stringify(job.result!.spec);
    expect(all).toContain('"source":"/api/nc/f1.odg"');
    expect(all).toContain('/api/nc/f3.svg');
    expect(all).toContain('data:foto');
  });

  it('ohne Nextcloud/eigenes Lernthema: Bilder bleiben, mit Hinweis', async () => {
    const { jobs, pages } = setup({ canStore: false });
    const { id } = jobs.start(user, Buffer.from('%PDF'), 'Folien.pdf', { mode: 'text', ocr: false, figures: true });
    await until(() => jobs.get(user, id).state !== 'running');
    const job = jobs.get(user, id);
    expect(pages).toEqual([]);
    expect(job.result!.warnings.join(' ')).toMatch(/Nextcloud/);
    expect(JSON.stringify(job.result!.spec)).not.toContain('_fig');
  });

  it('fremde Aufträge sind nicht zu sehen', () => {
    const { jobs } = setup();
    const { id } = jobs.start(user, Buffer.from('%PDF'), 'x.pdf', { mode: 'text', ocr: false, figures: false });
    expect(() => jobs.get({ userId: 'u2' }, id)).toThrow(/nicht/);
  });
});
