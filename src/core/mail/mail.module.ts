import { Global, Module, Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import { ConsoleMailService } from './console-mail.service';
import { SmtpMailService } from './smtp-mail.service';

/**
 * Wählt die Versand-Implementierung anhand von MAIL_TRANSPORT aus.
 * Ohne gesetzte Variable bleibt es beim Console-Modus (kein Versand).
 */
@Global()
@Module({
  providers: [
    {
      provide: MailService,
      useFactory: (): MailService => {
        const transport = (process.env.MAIL_TRANSPORT || 'console').toLowerCase();
        if (transport === 'smtp') {
          new Logger('Mail').log(`SMTP-Versand aktiv über ${process.env.SMTP_HOST}`);
          return new SmtpMailService();
        }
        return new ConsoleMailService();
      },
    },
  ],
  exports: [MailService],
})
export class MailModule {}
