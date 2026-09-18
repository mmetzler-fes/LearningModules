/**
 * Abstraktion für den Mailversand.
 *
 * Die Anwendung ruft ausschließlich diese Schnittstelle auf und interessiert
 * sich nur für das Ergebnis `delivered`:
 *   delivered === true  → die Mail ist raus, das Passwort darf NICHT mehr
 *                         im UI angezeigt werden.
 *   delivered === false → es gibt (noch) keinen Versandweg, der Admin muss
 *                         das Passwort persönlich übergeben.
 *
 * Solange kein SMTP-Server konfiguriert ist, liefert der ConsoleMailService
 * `delivered: false`. Sobald SMTP eingerichtet wird, ändert sich nur die
 * Implementierung – Aufrufer und UI bleiben unverändert.
 */
export interface MailResult {
  delivered: boolean;
  /** Grund, falls nicht zugestellt (nur für Log/Anzeige im Admin-UI). */
  reason?: string;
}

export abstract class MailService {
  /** Initialpasswort für ein neu angelegtes Konto. */
  abstract sendInitialPassword(params: {
    to: string;
    displayName: string;
    password: string;
    role: string;
  }): Promise<MailResult>;

  /** Neu gesetztes Passwort nach "Passwort vergessen" oder Admin-Reset. */
  abstract sendPasswordReset(params: {
    to: string;
    displayName: string;
    password: string;
  }): Promise<MailResult>;
}
