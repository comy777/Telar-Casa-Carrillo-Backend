import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from '../../application/email-sender';

/**
 * Solo para desarrollo sin SMTP: escribe el correo en el log para poder copiar
 * los enlaces de verificación y recuperación. La validación del entorno impide
 * usarlo en producción.
 */
@Injectable()
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');

  send(message: EmailMessage): Promise<void> {
    this.logger.log(`Para: ${message.to} | Asunto: ${message.subject}\n${message.text}`);
    return Promise.resolve();
  }
}
