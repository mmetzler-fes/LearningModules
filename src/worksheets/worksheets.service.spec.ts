import { BadRequestException } from '@nestjs/common';
import { DocContext, WorksheetsService, safeInkSvg, widthInCm } from './worksheets.service';
import { WorksheetRendererClient } from './renderer.client';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const user = { userId: 'u1' };

const ctx = (over: Partial<DocContext> = {}): DocContext => ({
  pfad: '2.1', slug: '13_ad', folder: 'Sensoren',
  course: { kurs: 'Arduino', titelmuster: '{kurs} {pfad} – {titel}', autor: 'M. M.', meta: { SCHULE: 'FES' } },
  refs: { '13_ad': { pfad: '2.1', titel: 'AD-Wandler' }, '06_v': { pfad: '1.6', titel: 'Verzweigungen' } },
  ...over,
});

describe('WorksheetsService.prepare', () => {
  const service = new WorksheetsService({} as WorksheetRendererClient);

  it('ohne Notebook: Titel des Moduls ist die Kopfzeile', async () => {
    const { job } = await service.prepare({ titel: 'alt', nummer: 3, kurs: 'X', content: ['x'] }, 'Ohmsches Gesetz', ['odt']);
    expect(job.spec).toEqual({ titel: 'Ohmsches Gesetz', meta: { TITEL: 'Ohmsches Gesetz' }, content: ['x'] });
    expect(job.outputs).toEqual(['odt']);
  });

  it('mit Notebook: Kopfzeile aus dem Kurs, Verweise aufgelöst, Kurs-Meta übernommen', async () => {
    const { job, warnings } = await service.prepare(
      { content: ['Siehe Blatt {{blatt:06_v}} und {{blatt:weg}}'] }, 'Der AD-Wandler', ['pdf'], ctx());
    expect(job.spec.meta).toEqual({ SCHULE: 'FES', TITEL: 'Arduino 2.1 – Der AD-Wandler' });
    expect(job.spec.content).toEqual(['Siehe Blatt 1.6 und ⚠ Blatt fehlt: weg']);
    expect(job.course).toEqual({ autor: 'M. M.' });
    expect(warnings).toEqual(['Verweis auf fehlende Blätter: weg']);
  });

  it('eigene Kopfzeile in meta.TITEL (Klassenarbeit) hat Vorrang', async () => {
    const { job } = await service.prepare({ meta: { TITEL: 'Arduino – KA' }, content: ['x'] }, 'KA', ['odt'], ctx());
    expect(job.spec.meta.TITEL).toBe('Arduino – KA');
  });

  it('Bilder aus der App gehen als Datei mit, auch verschachtelt', async () => {
    const { job, warnings } = await service.prepare({ content: [
      { type: 'task', title: 'A', blocks: [{ type: 'image', src: PNG, width: '50%', caption: 'Schaltung' }] },
    ] }, 'T', ['pdf']);
    expect(warnings).toEqual([]);
    expect(job.files).toEqual({ 'bilder/bild-1.png': 'iVBORw0KGgo=' });
    expect(job.spec.content[0].blocks[0]).toEqual({ type: 'image', file: 'bilder/bild-1.png', width: '8.25cm', caption: 'Schaltung' });
  });

  it('Bildgruppe: jedes Bild als Datei, Lage in Prozent bleibt; was nicht druckbar ist, fällt heraus', async () => {
    const { job, warnings } = await service.prepare({ content: [
      { type: 'group', width: '12cm', ratio: 0.5, caption: 'K', items: [
        { src: PNG, x: 0, y: 0, w: 50, h: 100, alt: 'a' },
        { src: 'https://example.org/b.png', x: 50, y: 0, w: 50, h: 100 }] },
      { type: 'group', ratio: 1, items: [{ src: 'https://example.org/c.png', x: 0, y: 0, w: 100, h: 100 }] },
    ] }, 'T', ['pdf']);
    expect(warnings).toHaveLength(2);
    expect(job.files).toEqual({ 'bilder/bild-1.png': 'iVBORw0KGgo=' });
    expect(job.spec.content[0]).toEqual({ type: 'group', width: '12.00cm', ratio: 0.5, caption: 'K',
      items: [{ file: 'bilder/bild-1.png', x: 0, y: 0, w: 50, h: 100 }] });
    expect(job.spec.content[1]).toEqual({ type: 'note', text: '[Bildgruppe]' });
  });

  it('Beschriftung aus dem Stift-Editor: SVG als Datei, Lage in cm – auch an neu gebauten Bausteinen', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 36" width="72pt" height="36pt"><g><path d="M0,0L72,36"/></g></svg>';
    const ink = { svg, x: 72, y: -36, w: 72, h: 36 };
    const { job, warnings } = await service.prepare({ content: [
      { type: 'karo', lines: 4, ink },
      { type: 'image', src: PNG, width: '6cm', ink },
      { type: 'text', text: 'x', ink: { ...ink, svg: '<svg><image href="file:///etc/passwd"/></svg>' } },
    ] }, 'T', ['pdf']);
    expect(job.files?.['stift/stift-1.svg']).toBe(Buffer.from(svg).toString('base64'));
    expect(job.spec.content[0]).toEqual({ type: 'karo', lines: 4, ink: { file: 'stift/stift-1.svg', x: 2.54, y: -1.27, width: 2.54, height: 1.27 } });
    expect(job.spec.content[1].ink.file).toBe('stift/stift-2.svg');
    expect(job.spec.content[1].file).toBe('bilder/bild-1.png');
    expect(job.spec.content[2]).toEqual({ type: 'text', text: 'x' });
    expect(warnings).toEqual(['Eine Beschriftung ließ sich nicht drucken (unerwarteter Inhalt).']);
  });

  it('Bilder in einer Tabelle in einer Zelle gehen auch als Datei mit', async () => {
    const { job } = await service.prepare({ content: [
      { type: 'table', rows: [[{ text: 'a', blocks: [{ type: 'image', src: PNG, width: '2cm' }] }]] },
    ] }, 'T', ['pdf']);
    expect(job.spec.content[0].rows[0][0].blocks[0]).toEqual({ type: 'image', file: 'bilder/bild-1.png', width: '2.00cm' });
  });

  it('safeInkSvg: nur Zeichnung, keine Verweise', () => {
    expect(safeInkSvg('<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0"/><text><tspan>Hi</tspan></text></g></svg>')).toBe(true);
    expect(safeInkSvg('<svg><use href="#a"/></svg>')).toBe(false);
    expect(safeInkSvg('<svg><script>x</script></svg>')).toBe(false);
    expect(safeInkSvg('<svg><path style="fill:url(http://x)"/></svg>')).toBe(false);
    expect(safeInkSvg('<?xml version="1.0"?><svg/>')).toBe(false);
  });

  it('Bilder aus der Nextcloud holt der Server über ihren App-Link', async () => {
    const nextcloud = { readImageByUrl: jest.fn().mockResolvedValue({ type: 'image/jpeg', data: Buffer.from('jpg') }) };
    const s = new WorksheetsService({} as WorksheetRendererClient, undefined, undefined, undefined, nextcloud as any);
    const { job } = await s.prepare({ content: [{ type: 'image', src: '/api/nextcloud/files/x/Thema/a.jpg' }] }, 'T', ['pdf']);
    expect(nextcloud.readImageByUrl).toHaveBeenCalledWith('/api/nextcloud/files/x/Thema/a.jpg');
    expect(job.files).toEqual({ 'bilder/bild-1.jpg': Buffer.from('jpg').toString('base64') });
  });

  it('nicht druckbare Bilder und Dateiverweise werden zum Hinweis', async () => {
    const { job, warnings } = await service.prepare({ content: [
      { type: 'image', src: 'https://cloud.example/a.png', caption: 'Foto' },
      { type: 'image', src: 'data:image/webp;base64,AAAA' },
      { type: 'code', file: 'quellcodes/a.ino' },
    ] }, 'T', ['odt']);
    expect(job.spec.content).toEqual([
      { type: 'note', text: '[Foto]' },
      { type: 'note', text: '[Bild]' },
      { type: 'note', text: '[Code aus quellcodes/a.ino]' },
    ]);
    expect(job.files).toEqual({});
    expect(warnings).toHaveLength(3);
  });
});

describe('WorksheetsService.header', () => {
  it('Titelmuster mit Abschnitt; ohne Nummer ohne Reste', () => {
    expect(WorksheetsService.header(ctx({ course: { kurs: 'Arduino', titelmuster: '{abschnitt} {nummer}: {titel}', autor: '', meta: {} } }), 'AD'))
      .toBe('Sensoren 1: AD');
    expect(WorksheetsService.header(ctx({ pfad: '' }), 'KA')).toBe('Arduino – KA');
    expect(WorksheetsService.header(null, '')).toBe('Dokument');
  });
});

describe('WorksheetsService.render', () => {
  it('lehnt fehlerhafte Specs mit der Fehlerliste ab, ohne den Renderer zu fragen', async () => {
    const renderer = { render: jest.fn() } as unknown as WorksheetRendererClient;
    const service = new WorksheetsService(renderer);
    await expect(service.render(user, { spec: { content: [{ type: 'task' }] }, title: 'T', output: 'odt' })).rejects.toBeInstanceOf(BadRequestException);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('liefert die Datei und sammelt Hinweise', async () => {
    const renderer = { render: jest.fn().mockResolvedValue({ files: { pdf: Buffer.from('%PDF') }, warnings: ['vom Renderer'] }) };
    const service = new WorksheetsService(renderer as unknown as WorksheetRendererClient);
    const out = await service.render(user, { spec: { content: [{ type: 'image', src: 'https://x/a.png' }] }, title: 'T', output: 'pdf' });
    expect(out.file.toString()).toBe('%PDF');
    expect(out.warnings).toEqual([expect.stringContaining('aus dem Netz'), 'vom Renderer']);
  });
});

describe('widthInCm', () => {
  it.each([
    ['9cm', '9.00cm'], ['90mm', '9.00cm'], ['100%', '16.50cm'], ['378px', '10.00cm'], ['22cm', '22.00cm'], ['40cm', '25.50cm'],
  ])('%s → %s', (w, cm) => expect(widthInCm(w)).toBe(cm));
  it('unbekannt → null', () => expect(widthInCm('breit')).toBeNull());
});

describe('WorksheetsService.importPdf', () => {
  const pdf = Buffer.from('%PDF-1.7 …');
  const renderer = (spec: any) => ({ importPdf: jest.fn().mockResolvedValue({ spec, title: 'Blatt', warnings: ['w'] }) }) as any;
  const ai = (spec: any) => ({ convert: jest.fn().mockResolvedValue({ spec, title: 'KI', warnings: [] }) }) as any;

  it('lehnt Nicht-PDFs ab', async () => {
    await expect(new WorksheetsService(renderer({ content: [] })).importPdf(Buffer.from('hallo'), 'text')).rejects.toThrow(BadRequestException);
  });

  it('Text und Seiten über den Renderer, KI über pdf-ai', async () => {
    const r = renderer({ content: [{ type: 'section', text: 'A' }] });
    const k = ai({ content: [{ type: 'text', text: 'B' }] });
    const service = new WorksheetsService(r, undefined, undefined, undefined, undefined, undefined, undefined, undefined, k);
    expect((await service.importPdf(pdf, 'pages')).mode).toBe('pages');
    expect(r.importPdf).toHaveBeenCalledWith(pdf, 'pages');
    const res = await service.importPdf(pdf, 'ai', true);
    expect(k.convert).toHaveBeenCalledWith(pdf, true);
    expect(res.title).toBe('KI');
  });

  it('meldet Fehler im Ergebnis als Hinweis', async () => {
    const res = await new WorksheetsService(renderer({ content: [{ type: 'gibtsnicht' }] })).importPdf(pdf, 'text');
    expect(res.warnings[0]).toBe('w');
    expect(res.warnings.some((w) => /Unbekannter Blocktyp/.test(w))).toBe(true);
  });
});
