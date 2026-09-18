import { Injectable, Logger } from '@nestjs/common';
import { MailService, MailResult } from './mail.service';

/**
 * Standard-Implementierung ohne Mailversand.
 *
 * Schreibt das Passwort ins Server-Log und meldet `delivered: false`, damit
 * der Aufrufer es dem Admin im UI anzeigt. Das ist der Betriebsmodus, solange
 * kein SMTP-Zugang konfiguriert ist.
 */
@Injectable()
export class ConsoleMailService extends MailService {
  private readonly logger = new Logger('Mail');

  async sendInitialPassword(params: {
    to: string;
    displayName: string;
    password: string;
    role: string;
  }): Promise<MailResult> {
    this.logger.log(`Initialpasswort für ${params.to} (${params.role}): ${params.password}`);
    return { delivered: false, reason: 'Kein Mailversand konfiguriert (MAIL_TRANSPORT=console).' };
  }

  async sendPasswordReset(params: { to: string; displayName: string; password: string }): Promise<MailResult> {
    this.logger.log(`Neues Passwort für ${params.to}: ${params.password}`);
    return { delivered: false, reason: 'Kein Mailversand konfiguriert (MAIL_TRANSPORT=console).' };
  }
}
