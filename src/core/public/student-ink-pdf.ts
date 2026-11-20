import { BadRequestException } from '@nestjs/common';
import { loadBrowserModule } from '../browser-module';

interface InkPrint {
  applyInkToSpec(spec: unknown, data: { karo?: any[]; overlays?: any[]; inserts?: any[] }): any;
}

/** Höchstens so viel Beschriftung (JSON) je PDF – ein dicht beschriebenes Blatt hat wenige hundert kB. */
export const MAX_INK_BYTES = 8 * 1024 * 1024;

/** Gleich bis auf die Block-IDs (die Ansicht stempelt sie, das Gespeicherte hat sie nicht immer). */
function normalized(v: any): any {
  if (Array.isArray(v)) return v.map(normalized);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) if (k !== 'id') out[k] = normalized(v[k]);
    // Ein bloßer Text und { type: 'text', text } sind dasselbe (die Ansicht macht manchmal das eine zum anderen).
    if (out.type === 'text' && Object.keys(out).length === 2 && typeof out.text === 'string') return out.text;
    return out;
  }
  return v;
}

/**
 * Dokument für das Schüler-PDF aus dem Stift-Editor: `sent` ist das Dokument, wie es der Schüler
 * sieht (die Pfade der Beschriftung zählen darin) – es muss dem gespeicherten mit Lösungen (`full`)
 * oder ohne Lösungen (`stripped`) entsprechen. Darauf kommt die Beschriftung (lm-editor/src/ink/ink-print.js).
 */
export function studentInkSpec(sent: unknown, full: unknown, stripped: unknown, ink: any): { spec: any; full: boolean } {
  if (!sent || typeof sent !== 'object') throw new BadRequestException('Dokument fehlt.');
  const key = JSON.stringify(normalized(sent));
  const isFull = key === JSON.stringify(normalized(full));
  if (!isFull && key !== JSON.stringify(normalized(stripped))) {
    throw new BadRequestException('Das Dokument wurde inzwischen geändert – bitte die Seite neu laden.');
  }
  const data = ink && typeof ink === 'object' ? ink : {};
  if (JSON.stringify(data).length > MAX_INK_BYTES) throw new BadRequestException('Die Beschriftung ist zu groß für ein PDF.');
  const pick = (v: any) => (Array.isArray(v) ? v : []);
  const { applyInkToSpec } = loadBrowserModule<InkPrint>('../lm-editor/src/ink/ink-print.js');
  const spec = applyInkToSpec(JSON.parse(JSON.stringify(sent)), { karo: pick(data.karo), overlays: pick(data.overlays), inserts: pick(data.inserts) });
  return { spec, full: isFull };
}
