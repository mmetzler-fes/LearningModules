import { BadRequestException, Injectable } from '@nestjs/common';
import { docSpec } from './docspec';
import { RenderJob, WorksheetOutput, WorksheetRendererClient } from './renderer.client';

/** Druckbreite der Grundvorlage in cm (Textbreite, 33 Karos à 0,5 cm). */
const TEXT_WIDTH_CM = 16.5;
const PRINTABLE_IMAGES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' };

/**
 * Modultyp „Dokument“ drucken: Spec prüfen (dieselbe Prüfung wie im Editor,
 * src/renderer/js/docspec.js), für den Renderer aufbereiten, rendern.
 */
@Injectable()
export class WorksheetsService {
  constructor(private readonly renderer: WorksheetRendererClient) {}

  async status() {
    return { configured: this.renderer.configured(), renderer: await this.renderer.health() };
  }

  async render(spec: unknown, title: string, output: WorksheetOutput) {
    const errors = docSpec().validateDocSpec(spec);
    if (errors.length) throw new BadRequestException({ message: 'Das Dokument enthält Fehler.', errors });
    const { job, warnings } = this.prepare(spec as Record<string, any>, title, [output]);
    const result = await this.renderer.render(job);
    const file = result.files[output];
    if (!file) throw new BadRequestException('Der Renderer hat die Datei nicht geliefert.');
    return { file, warnings: [...warnings, ...result.warnings] };
  }

  /**
   * Spec → Auftrag für den Renderer. Der Titel des Moduls wird zum Titel des
   * Blatts; Bilder aus der App (data:) gehen als Dateien mit, alles andere
   * steht vorerst als Hinweis im Druck.
   */
  prepare(spec: Record<string, any>, title: string, outputs: WorksheetOutput[]): { job: RenderJob; warnings: string[] } {
    const files: Record<string, string> = {};
    const warnings: string[] = [];
    let n = 0;

    const imageBlock = (block: Record<string, any>): Record<string, any> => {
      const src = String(block.src ?? '');
      const label = block.caption || block.alt || 'Bild';
      const data = /^data:([^;,]+);base64,(.*)$/s.exec(src);
      const ext = data ? PRINTABLE_IMAGES[data[1].toLowerCase()] : undefined;
      if (!data || !ext) {
        warnings.push(data
          ? `„${label}“: ${data[1]} lässt sich nicht drucken – bitte PNG, JPEG oder SVG.`
          : `„${label}“: Bilder aus der Nextcloud oder dem Netz kommen noch nicht in den Druck.`);
        return { type: 'note', text: `[${label}]` };
      }
      const name = `bilder/bild-${++n}.${ext}`;
      files[name] = data[2];
      const { src: _src, alt: _alt, ...rest } = block;
      const width = widthInCm(block.width);
      return { ...rest, file: name, ...(width ? { width } : { width: '12cm' }) };
    };

    const walk = (blocks: any[]): any[] => blocks.map((block) => {
      if (!block || typeof block !== 'object') return block;
      if (block.type === 'image' && block.src !== undefined) return imageBlock(block);
      if (block.type === 'code' && block.file !== undefined && block.code === undefined) {
        warnings.push(`Code aus „${block.file}“ gibt es nur im Kurs-Projekt – im Druck steht ein Hinweis.`);
        return { type: 'note', text: `[Code aus ${block.file}]` };
      }
      if (block.type === 'image' && block.file !== undefined) {
        warnings.push(`Bild „${block.file}“ gibt es nur im Kurs-Projekt – im Druck steht ein Hinweis.`);
        return { type: 'note', text: `[Bild ${block.file}]` };
      }
      return Array.isArray(block.blocks) ? { ...block, blocks: walk(block.blocks) } : block;
    });

    const { titel: _t, nummer: _n, ...rest } = spec;
    return {
      job: {
        spec: { ...rest, titel: title || 'Dokument', content: walk(spec.content) },
        course: { titelmuster: '{titel}' },
        files,
        outputs,
      },
      warnings,
    };
  }
}

/** Breitenangabe der Web-Ansicht (9cm, 90mm, 50%, 300px) → cm für den Generator. */
export function widthInCm(width: unknown): string | null {
  const m = /^(\d+(?:\.\d+)?)(cm|mm|px|%)$/.exec(String(width ?? ''));
  if (!m) return null;
  const v = parseFloat(m[1]);
  const cm = m[2] === 'cm' ? v : m[2] === 'mm' ? v / 10 : m[2] === '%' ? (v / 100) * TEXT_WIDTH_CM : v / 37.8;
  return `${Math.min(cm, TEXT_WIDTH_CM).toFixed(2)}cm`;
}
