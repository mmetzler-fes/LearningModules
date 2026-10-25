import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

/**
 * Anbindung an den Arbeitsblatt-Renderer (worksheet-renderer/, eigener
 * Container). Er bekommt Spec, Kursangaben, Vorlage und Dateien und liefert
 * .odt/.pdf samt Lösungsblatt. Adresse und Token: WORKSHEET_RENDERER_URL,
 * WORKSHEET_RENDERER_TOKEN.
 */
export type WorksheetOutput = 'odt' | 'loesung' | 'pdf' | 'loesung_pdf';
export const WORKSHEET_OUTPUTS: WorksheetOutput[] = ['odt', 'loesung', 'pdf', 'loesung_pdf'];

export interface RenderJob {
  spec: Record<string, any>;
  course?: Record<string, any>;
  /** .ott als base64; ohne gilt die Grundvorlage des Renderers. */
  template?: string;
  /** Pfad → base64, worauf die Spec mit `file:` verweist. */
  files?: Record<string, string>;
  outputs: WorksheetOutput[];
}

export interface RenderResult {
  files: Partial<Record<WorksheetOutput, Buffer>>;
  warnings: string[];
}

export interface PdfImportResult {
  spec: { content: any[] };
  title: string;
  warnings: string[];
}

/**
 * PDF an einen Import-Dienst schicken (Renderer bzw. pdf-ai) – beide
 * antworten mit `{ spec, title, warnings }` oder `{ error }`.
 */
export async function postPdf(url: string, token: string | undefined, body: Record<string, any>, logger: Logger, name: string, timeoutMs = 300_000): Promise<PdfImportResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    logger.warn(`${name} nicht erreichbar: ${err?.message || err}`);
    throw new ServiceUnavailableException(`Der ${name} ist gerade nicht erreichbar.`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logger.error(`${name} lehnt das Token ab.`);
    throw new ServiceUnavailableException(`Der ${name} ist falsch eingerichtet (Token).`);
  }
  if (!res.ok) throw new UnprocessableEntityException(data.error || `Das PDF ließ sich nicht übernehmen (${res.status}).`);
  if (!data?.spec || !Array.isArray(data.spec.content)) throw new UnprocessableEntityException('Der Import lieferte kein Dokument.');
  return { spec: data.spec, title: String(data.title || ''), warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [] };
}

/** Ein PDF dauert 1–3 s; der Renderer wartet selbst bis zu 120 s auf einen freien Platz. */
const RENDER_TIMEOUT_MS = 150_000;

@Injectable()
export class WorksheetRendererClient {
  private readonly logger = new Logger('WorksheetRenderer');

  private base(): string {
    return (process.env.WORKSHEET_RENDERER_URL || '').replace(/\/+$/, '');
  }

  configured(): boolean {
    return !!this.base();
  }

  /** Stand des Renderers für die Anzeige; null, wenn er nicht antwortet. */
  async health(): Promise<{ ok: boolean; api: number; version: string; soffice: boolean } | null> {
    if (!this.configured()) return null;
    try {
      const res = await fetch(`${this.base()}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** Vorlage prüfen: Platzhalter ({{TITEL}}, {{INHALT}}) und Absatzvorlagen. */
  async inspect(templateBase64: string): Promise<{ placeholders: string[]; hasTitle: boolean; hasContent: boolean; paragraphStyles: string[] }> {
    if (!this.configured()) throw new ServiceUnavailableException('Kein Renderer eingetragen (WORKSHEET_RENDERER_URL).');
    let res: Response;
    try {
      res = await fetch(`${this.base()}/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.WORKSHEET_RENDERER_TOKEN ? { Authorization: `Bearer ${process.env.WORKSHEET_RENDERER_TOKEN}` } : {}) },
        body: JSON.stringify({ template: templateBase64 }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ServiceUnavailableException('Der Renderer ist gerade nicht erreichbar.');
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new UnprocessableEntityException(body.error || 'Die Vorlage ließ sich nicht prüfen.');
    return body;
  }

  /**
   * PDF → Spec (POST /import-pdf, worksheet-renderer/tools/pdf_import.py):
   * `text` erkennt die Struktur, `pages` liefert jede Seite als Bild.
   */
  async importPdf(pdf: Buffer, mode: 'text' | 'pages'): Promise<PdfImportResult> {
    if (!this.configured()) throw new ServiceUnavailableException('Kein Renderer eingetragen (WORKSHEET_RENDERER_URL).');
    return postPdf(`${this.base()}/import-pdf`, process.env.WORKSHEET_RENDERER_TOKEN, { pdf: pdf.toString('base64'), mode }, this.logger, 'Renderer');
  }

  /**
   * Word-Datei (.docx, .doc, .rtf) mit LibreOffice nach .odt (POST /convert-odt) –
   * für den .odt-Import. Dauert ein paar Sekunden.
   */
  async convertToOdt(file: Buffer, name: string): Promise<Buffer> {
    if (!this.configured()) throw new ServiceUnavailableException('Word-Dateien lassen sich nur mit dem Renderer umwandeln – bitte als .odt speichern.');
    let res: Response;
    try {
      res = await fetch(`${this.base()}/convert-odt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.WORKSHEET_RENDERER_TOKEN ? { Authorization: `Bearer ${process.env.WORKSHEET_RENDERER_TOKEN}` } : {}) },
        body: JSON.stringify({ file: file.toString('base64'), name }),
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      });
    } catch (err: any) {
      this.logger.warn(`Renderer nicht erreichbar: ${err?.message || err}`);
      throw new ServiceUnavailableException('Der Renderer ist gerade nicht erreichbar.');
    }
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 401) {
      this.logger.error('Renderer lehnt das Token ab.');
      throw new ServiceUnavailableException('Der Renderer ist falsch eingerichtet (Token).');
    }
    if (!res.ok || typeof body.odt !== 'string') throw new UnprocessableEntityException(body.error || `Die Datei ließ sich nicht umwandeln (${res.status}).`);
    return Buffer.from(body.odt, 'base64');
  }

  /**
   * Zeichnungen einer .odt, wie LibreOffice sie zeichnet (POST /export-drawings):
   * das Dokument mit Namen `lmdraw-<n>` an den Zeichnungen und je Name das SVG.
   * null, wenn der Renderer fehlt, es nicht kann oder scheitert – dann baut der
   * Import die Zeichnungen wie bisher selbst nach.
   */
  async exportDrawings(odt: Buffer): Promise<{ odt: Buffer; drawings: Map<string, { svg: Buffer; odg?: Buffer; widthMm: number }>; warnings: string[] } | null> {
    if (!this.configured()) return null;
    try {
      const res = await fetch(`${this.base()}/export-drawings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.WORKSHEET_RENDERER_TOKEN ? { Authorization: `Bearer ${process.env.WORKSHEET_RENDERER_TOKEN}` } : {}) },
        body: JSON.stringify({ odt: odt.toString('base64') }),
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.odt !== 'string' || !Array.isArray(body.drawings)) {
        if (res.status !== 404) this.logger.warn(`Zeichnungen exportieren: ${body.error || res.status}`);
        return null;
      }
      const drawings = new Map<string, { svg: Buffer; odg?: Buffer; widthMm: number }>();
      for (const d of body.drawings) {
        if (typeof d?.name !== 'string' || typeof d.svg !== 'string') continue;
        drawings.set(d.name, {
          svg: Buffer.from(d.svg, 'base64'), widthMm: Number(d.width_mm) || 0,
          ...(typeof d.odg === 'string' ? { odg: Buffer.from(d.odg, 'base64') } : {}),
        });
      }
      return { odt: Buffer.from(body.odt, 'base64'), drawings, warnings: Array.isArray(body.warnings) ? body.warnings.map(String) : [] };
    } catch (err: any) {
      this.logger.warn(`Zeichnungen exportieren: ${err?.message || err}`);
      return null;
    }
  }

  /** Bearbeitete Zeichnung (.odg) wieder als SVG (POST /render-drawing). */
  async renderDrawing(odg: Buffer): Promise<{ svg: Buffer; widthMm: number }> {
    if (!this.configured()) throw new ServiceUnavailableException('Zeichnungen lassen sich nur mit dem Renderer neu zeichnen.');
    let res: Response;
    try {
      res = await fetch(`${this.base()}/render-drawing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.WORKSHEET_RENDERER_TOKEN ? { Authorization: `Bearer ${process.env.WORKSHEET_RENDERER_TOKEN}` } : {}) },
        body: JSON.stringify({ odg: odg.toString('base64') }),
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      });
    } catch (err: any) {
      this.logger.warn(`Renderer nicht erreichbar: ${err?.message || err}`);
      throw new ServiceUnavailableException('Der Renderer ist gerade nicht erreichbar.');
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.svg !== 'string') throw new UnprocessableEntityException(body.error || `Die Zeichnung ließ sich nicht umwandeln (${res.status}).`);
    return { svg: Buffer.from(body.svg, 'base64'), widthMm: Number(body.width_mm) || 0 };
  }

  /** Skript (Kompendium) aus mehreren Blättern (POST /render-script). */
  renderScript(job: { sheets: Array<{ titel: string; spec: Record<string, any> }>; course?: Record<string, any>; skript?: Record<string, any>; template?: string; files?: Record<string, string>; outputs: WorksheetOutput[] }) {
    return this.render(job as any, '/render-script');
  }

  async render(job: RenderJob, path = '/render'): Promise<RenderResult> {
    if (!this.configured()) throw new ServiceUnavailableException('Kein Renderer eingetragen (WORKSHEET_RENDERER_URL).');
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.WORKSHEET_RENDERER_TOKEN ? { Authorization: `Bearer ${process.env.WORKSHEET_RENDERER_TOKEN}` } : {}),
        },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      });
    } catch (err: any) {
      this.logger.warn(`Renderer nicht erreichbar: ${err?.message || err}`);
      throw new ServiceUnavailableException('Der Renderer ist gerade nicht erreichbar.');
    }
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 400 || res.status === 422) {
      throw new UnprocessableEntityException({ message: body.error || 'Das Dokument ließ sich nicht erzeugen.', warnings: body.warnings || [] });
    }
    if (res.status === 401) {
      this.logger.error('Renderer lehnt das Token ab – WORKSHEET_RENDERER_TOKEN prüfen.');
      throw new ServiceUnavailableException('Der Renderer ist falsch eingerichtet (Token).');
    }
    if (!res.ok) throw new ServiceUnavailableException(body.error || `Renderer antwortet mit ${res.status}.`);
    const files: RenderResult['files'] = {};
    for (const [key, value] of Object.entries(body.files || {})) {
      files[key as WorksheetOutput] = Buffer.from(String(value), 'base64');
    }
    return { files, warnings: Array.isArray(body.warnings) ? body.warnings : [] };
  }
}
