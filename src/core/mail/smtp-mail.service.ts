import { Injectable, Logger } from '@nestjs/common';
import { MailService, MailResult } from './mail.service';

/**
 * Echter Mailversand über SMTP.
 *
 * Wird erst aktiv, wenn MAIL_TRANSPORT=smtp gesetzt ist. Voraussetzung:
 *
 *   bun add nodemailer  (bzw. npm i nodemailer)
 *
 * Konfiguration über Umgebungsvariablen:
 *   MAIL_TRANSPORT=smtp
 *   SMTP_HOST=mail.schule.de
 *   SMTP_PORT=587
 *   SMTP_SECURE=false          # true bei Port 465
 *   SMTP_REQUIRE_TLS=true      # Vorgabe; "false" erlaubt unverschlüsselten Versand
 *   SMTP_USER=lernmodule@schule.de
 *   SMTP_PASS=geheim
 *   MAIL_FROM="LearningModules <lernmodule@schule.de>"
 *   APP_URL=https://lernmodule.schule.de   # für den Link in der Mail
 *
 * nodemailer wird absichtlich erst zur Laufzeit geladen, damit die Anwendung
 * ohne das Paket startet, solange kein SMTP genutzt wird.
 */
@Injectable()
export class SmtpMailService extends MailService {
  private readonly logger = new Logger('Mail');
  private transporter: any = null;

  private async getTransporter(): Promise<any> {
    if (this.transporter) return this.transporter;

    const moduleName = 'nodemailer';
    const nodemailer: any = await import(moduleName);
    const create = nodemailer.createTransport || nodemailer.default?.createTransport;

    // Wir verschicken Passwörter: unverschlüsselte Zustellung ist standardmäßig
    // verboten. requireTLS erzwingt STARTTLS auf Port 587/25; bei secure=true
    // (Port 465) ist die Verbindung ohnehin von Beginn an verschlüsselt.
    const requireTls = (process.env.SMTP_REQUIRE_TLS || 'true').toLowerCase() !== 'false';

    this.transporter = create({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      requireTLS: requireTls,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    return this.transporter;
  }

  private get appUrl(): string {
    return process.env.APP_URL || 'http://localhost:3000';
  }

  /**
   * Übersetzt die üblichen Versandfehler in einen Satz, mit dem der Admin im
   * Dialog etwas anfangen kann. Der technische Wortlaut steht im Log.
   */
  private describeError(err: any): string {
    const msg = String(err?.message || err);
    const code = String(err?.code || '');

    if (/ssl|tls|starttls|wrong version number/i.test(msg)) {
      return 'Der Mailserver bietet keine verschlüsselte Verbindung an. Passwörter werden ' +
        'deshalb nicht versandt. Prüfen Sie SMTP_PORT/SMTP_SECURE – oder setzen Sie ' +
        'SMTP_REQUIRE_TLS=false, wenn unverschlüsselter Versand vertretbar ist.';
    }
    if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'EDNS'].includes(code)) {
      return `Der Mailserver ist nicht erreichbar (${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}). ` +
        'Prüfen Sie SMTP_HOST, SMTP_PORT und ob der Port ausgehend freigeschaltet ist.';
    }
    if (/auth|535|534|530/i.test(msg)) {
      return 'Anmeldung am Mailserver fehlgeschlagen. Prüfen Sie SMTP_USER und SMTP_PASS ' +
        '– bei Microsoft 365 muss "Authenticated SMTP" für das Postfach freigegeben sein.';
    }
    if (/MODULE_NOT_FOUND|Cannot find module/i.test(msg)) {
      return 'Das Paket nodemailer fehlt im Image. Bitte das Image neu bauen.';
    }
    return `Mailversand fehlgeschlagen: ${msg}`;
  }

  private async send(to: string, subject: string, text: string): Promise<MailResult> {
    try {
      const transporter = await this.getTransporter();
      await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
      });
      this.logger.log(`Mail an ${to} versandt: ${subject}`);
      return { delivered: true };
    } catch (err: any) {
      // Kein harter Fehler: der Admin bekommt das Passwort dann im UI angezeigt.
      this.logger.error(`Mailversand an ${to} fehlgeschlagen: ${err?.message || err}`);
      return { delivered: false, reason: this.describeError(err) };
    }
  }

  async sendInitialPassword(params: {
    to: string;
    displayName: string;
    password: string;
    role: string;
  }): Promise<MailResult> {
    const roleLabel = params.role === 'admin' ? 'Administrator' : 'Lehrkraft';
    return this.send(
      params.to,
      'Ihr Zugang zu LearningModules',
      `Hallo ${params.displayName},\n\n` +
        `für Sie wurde ein Zugang als ${roleLabel} eingerichtet.\n\n` +
        `Adresse:        ${this.appUrl}\n` +
        `E-Mail:         ${params.to}\n` +
        `Initialpasswort: ${params.password}\n\n` +
        `Bitte melden Sie sich an. Beim ersten Login werden Sie aufgefordert,\n` +
        `ein eigenes Passwort zu vergeben.\n`,
    );
  }

  async sendPasswordReset(params: { to: string; displayName: string; password: string }): Promise<MailResult> {
    return this.send(
      params.to,
      'Ihr neues Passwort für LearningModules',
      `Hallo ${params.displayName},\n\n` +
        `Ihr Passwort wurde zurückgesetzt.\n\n` +
        `Adresse:       ${this.appUrl}\n` +
        `E-Mail:        ${params.to}\n` +
        `Neues Passwort: ${params.password}\n\n` +
        `Beim nächsten Login werden Sie aufgefordert, ein eigenes Passwort zu vergeben.\n`,
    );
  }
}
