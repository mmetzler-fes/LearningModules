import * as fs from 'fs';
import * as path from 'path';
import { loadBrowserModule } from './browser-module';

/** OneNote im Browser: src/renderer/js/onenote.js und cab.js */
interface OneNote {
  readOneSection(bytes: Uint8Array): { pages: Array<{ title: string; level: number; files: any[]; images: any[] }> };
  notebookPlan(paths: string[]): { classNotebook: boolean; root: any; skipped: number };
  sectionModules(pages: any[]): { modules: Array<{ title: string; files: any[]; printouts: any[] }>; empty: number };
  jpegsToPdf(images: Array<{ bytes: Uint8Array; width: number; height: number }>): Uint8Array;
}
interface Cab {
  readCab(bytes: Uint8Array): { files: Array<{ name: string; size: number }>; extract(f: any): Uint8Array };
}
const one = loadBrowserModule<OneNote>('onenote.js');
const cab = loadBrowserModule<Cab>('cab.js');

const file = (name: string) => ({ name, size: 3, data: () => new Uint8Array([1, 2, 3]) });
const page = (title: string, level = 1, files: string[] = [], images: string[] = []) =>
  ({ title, level, files: files.map(file), images: images.map(file) });

describe('OneNote übernehmen: Aufbau', () => {
  it('Klassennotizbuch: nur Inhaltsbibliothek und Nur für Lehrer, Schüler werden nur gezählt', () => {
    const plan = one.notebookPlan([
      'Willkommen.one', 'Max Muster/Handouts.one', 'Max Muster/Hausaufgaben.one',
      '_Collaboration Space/Zusammenarbeit.one', '_Inhaltsbibliothek/SPS 10.one', '_Inhaltsbibliothek/SPS 2.one',
      '_Nur für Lehrer/Lösungen.one', '_Nur für Lehrer/OneNote_RecycleBin/OneNote_DeletedPages.one',
    ]);
    expect(plan.classNotebook).toBe(true);
    expect(plan.skipped).toBe(4);
    expect(JSON.stringify(plan.root)).not.toContain('Max Muster');
    expect(plan.root.groups.map((g: any) => g.title)).toEqual(['Inhaltsbibliothek', 'Nur für Lehrer']);
    expect(plan.root.groups[0].sections.map((s: any) => s.title)).toEqual(['SPS 2', 'SPS 10']);
    expect(plan.root.groups[1].sections.map((s: any) => s.path)).toEqual(['_Nur für Lehrer/Lösungen.one']);
  });

  it('gewöhnliches Notizbuch: alles, verschachtelt', () => {
    const plan = one.notebookPlan(['A.one', 'Gruppe/B.one', 'Gruppe/Innen/C.one']);
    expect(plan.classNotebook).toBe(false);
    expect(plan.root.sections.map((s: any) => s.title)).toEqual(['A']);
    expect(plan.root.groups[0].groups[0].sections[0].path).toBe('Gruppe/Innen/C.one');
  });

  it('je Seite mit Anlagen ein Modul, Unterseiten mit Titel der Hauptseite, Ausdruck ohne Original als printouts', () => {
    const { modules, empty } = one.sectionModules([
      page('Zeitglieder', 1, ['Blatt.pdf'], ['Blatt_1.png', 'Blatt_2.png', 'Foto.jpg']),
      page('Lösung', 2, [], ['Loesung.pdf_2.png', 'Loesung.pdf_1.png']),
      page('Nur Text'),
    ]);
    expect(empty).toBe(1);
    expect(modules.map((m) => m.title)).toEqual(['Zeitglieder', 'Zeitglieder › Lösung']);
    expect(modules[0].printouts).toEqual([]); // Original liegt bei
    expect(modules[1].printouts[0].name).toBe('Loesung.pdf');
    expect(modules[1].printouts[0].images.map((i: any) => i.name)).toEqual(['Loesung.pdf_1.png', 'Loesung.pdf_2.png']);
  });

  it('setzt ein PDF aus JPEG-Seiten zusammen', () => {
    const pdf = Buffer.from(one.jpegsToPdf([{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 100, height: 200 }])).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('/MediaBox [0 0 595.28 1190.56]');
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
  });

  it('weist Fremdes ab', () => {
    expect(() => cab.readCab(new Uint8Array(40))).toThrow(/onepkg/);
    expect(() => one.readOneSection(new Uint8Array(2048))).toThrow(/\.one/);
  });
});

/**
 * Mit einem echten Export – nur, wenn einer unter data/onenote-sample/ liegt
 * (nicht im Repository: echte Klassennotizbücher enthalten Schülernamen).
 */
const sampleDir = path.resolve(process.cwd(), 'data/onenote-sample');
const sample = fs.existsSync(sampleDir) ? fs.readdirSync(sampleDir).find((f) => f.endsWith('.onepkg')) : undefined;
(sample ? describe : describe.skip)('OneNote übernehmen: echter Export', () => {
  it('entpackt das Paket und findet in jedem Abschnitt Seiten mit vollständigen PDFs', () => {
    const pkg = cab.readCab(new Uint8Array(fs.readFileSync(path.join(sampleDir, sample!))));
    const plan = one.notebookPlan(pkg.files.map((f) => f.name));
    const sections: any[] = [];
    const visit = (n: any) => { sections.push(...n.sections); n.groups.forEach(visit); };
    visit(plan.root);
    expect(sections.length).toBeGreaterThan(0);
    let pdfs = 0;
    for (const s of sections) {
      const { pages } = one.readOneSection(pkg.extract(pkg.files.find((f) => f.name === s.path)));
      for (const p of pages) {
        for (const f of p.files.filter((x: any) => x.kind.ext === 'pdf')) {
          expect(Buffer.from(f.data()).subarray(-1024).toString('latin1')).toContain('%%EOF');
          pdfs++;
        }
      }
    }
    expect(pdfs).toBeGreaterThan(0);
  }, 60000);
});
