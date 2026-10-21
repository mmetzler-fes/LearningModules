import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PdfImportResult, postPdf } from './renderer.client';

/**
 * PDF-Import mit KI-Erkennung (pdf-ai/, eigener Container mit docling).
 * Trainierte Modelle, die im Container laufen – kein externer Dienst, kein
 * Token eines Anbieters. Adresse und Token: PDF_AI_URL, PDF_AI_TOKEN.
 */
@Injectable()
export class PdfAiClient {
  private readonly logger = new Logger('PdfAi');

  private base(): string {
    return (process.env.PDF_AI_URL || '').replace(/\/+$/, '');
  }

  configured(): boolean {
    return !!this.base();
  }

  async health(): Promise<{ ok: boolean; version: string; ocr: boolean } | null> {
    if (!this.configured()) return null;
    try {
      const res = await fetch(`${this.base()}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** `ocr`: Text gescannter Seiten erkennen (langsamer). Großzügige Zeit – die Modelle rechnen auf der CPU. */
  async convert(pdf: Buffer, ocr: boolean): Promise<PdfImportResult> {
    if (!this.configured()) throw new ServiceUnavailableException('Keine KI-Erkennung eingetragen (PDF_AI_URL).');
    return postPdf(`${this.base()}/convert`, process.env.PDF_AI_TOKEN, { pdf: pdf.toString('base64'), ocr }, this.logger, 'KI-Dienst', 600_000);
  }
}
