import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLOCK, type Clock } from '../application/clock';
import { EMAIL_SENDER, type EmailSender } from '../application/email-sender';
import type { Env } from '../config/env.schema';
import { LogEmailSender } from './email/log-email-sender';
import { SmtpEmailSender } from './email/smtp-email-sender';

const systemClock: Clock = { now: () => new Date() };

/** Servicios técnicos compartidos por todos los módulos. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useValue: systemClock },
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EmailSender => {
        const host = config.get('SMTP_HOST', { infer: true });
        if (!host) return new LogEmailSender();
        return new SmtpEmailSender({
          host,
          port: config.get('SMTP_PORT', { infer: true }) ?? 587,
          user: config.get('SMTP_USER', { infer: true }),
          password: config.get('SMTP_PASSWORD', { infer: true }),
          from: config.get('EMAIL_FROM', { infer: true }) ?? 'no-reply@localhost',
        });
      },
    },
  ],
  exports: [CLOCK, EMAIL_SENDER],
})
export class PlatformModule {}
