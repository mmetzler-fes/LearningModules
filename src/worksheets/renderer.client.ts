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
