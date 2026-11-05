import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from '../../application/email-sender';

export interface SmtpSettings {
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
}

@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    this.transporter = createTransport({
      host: settings.host,
      port: settings.port,
      // 465 usa TLS directo; los demás puertos negocian STARTTLS.
      secure: settings.port === 465,
      ...(settings.user ? { auth: { user: settings.user, pass: settings.password } } : {}),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.settings.from, ...message });
  }
}
