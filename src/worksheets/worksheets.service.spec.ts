import { BadRequestException } from '@nestjs/common';
import { WorksheetsService, widthInCm } from './worksheets.service';
import { WorksheetRendererClient } from './renderer.client';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('WorksheetsService.prepare', () => {
  const service = new WorksheetsService({} as WorksheetRendererClient);

  it('Titel des Moduls wird Titel des Blatts, Titelmuster ohne Kurs', () => {
    const { job } = service.prepare({ titel: 'alt', nummer: 3, content: ['x'] }, 'Ohmsches Gesetz', ['odt']);
    expect(job.spec).toEqual({ titel: 'Ohmsches Gesetz', content: ['x'] });
    expect(job.course).toEqual({ titelmuster: '{titel}' });
    expect(job.outputs).toEqual(['odt']);
  });

  it('Bilder aus der App gehen als Datei mit, auch verschachtelt', () => {
    const { job, warnings } = service.prepare({ content: [
      { type: 'task', title: 'A', blocks: [{ type: 'image', src: PNG, width: '50%', caption: 'Schaltung' }] },
    ] }, 'T', ['pdf']);
    expect(warnings).toEqual([]);
    expect(job.files).toEqual({ 'bilder/bild-1.png': 'iVBORw0KGgo=' });
    expect(job.spec.content[0].blocks[0]).toEqual({ type: 'image', file: 'bilder/bild-1.png', width: '8.25cm', caption: 'Schaltung' });
  });

  it('nicht druckbare Bilder und Dateiverweise werden zum Hinweis', () => {
    const { job, warnings } = service.prepare({ content: [
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

describe('WorksheetsService.render', () => {
  it('lehnt fehlerhafte Specs mit der Fehlerliste ab, ohne den Renderer zu fragen', async () => {
    const renderer = { render: jest.fn() } as unknown as WorksheetRendererClient;
    const service = new WorksheetsService(renderer);
    await expect(service.render({ content: [{ type: 'task' }] }, 'T', 'odt')).rejects.toBeInstanceOf(BadRequestException);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('liefert die Datei und sammelt Hinweise', async () => {
    const renderer = { render: jest.fn().mockResolvedValue({ files: { pdf: Buffer.from('%PDF') }, warnings: ['vom Renderer'] }) };
    const service = new WorksheetsService(renderer as unknown as WorksheetRendererClient);
    const out = await service.render({ content: [{ type: 'image', src: 'https://x/a.png' }] }, 'T', 'pdf');
    expect(out.file.toString()).toBe('%PDF');
    expect(out.warnings).toEqual([expect.stringContaining('Nextcloud'), 'vom Renderer']);
  });
});

describe('widthInCm', () => {
  it.each([
    ['9cm', '9.00cm'], ['90mm', '9.00cm'], ['100%', '16.50cm'], ['378px', '10.00cm'], ['40cm', '16.50cm'],
  ])('%s → %s', (w, cm) => expect(widthInCm(w)).toBe(cm));
  it('unbekannt → null', () => expect(widthInCm('breit')).toBeNull());
});
