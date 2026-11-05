import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLOCK, type Clock } from '../application/clock';
import { DOMAIN_EVENTS } from '../application/domain-events';
import { EMAIL_SENDER, type EmailSender } from '../application/email-sender';
import { IMAGE_STORAGE, type ImageStorage } from '../application/image-storage';
import type { Env } from '../config/env.schema';
import { LogEmailSender } from './email/log-email-sender';
import { InProcessEventBus } from './events/in-process-event-bus';
import { SmtpEmailSender } from './email/smtp-email-sender';
import { CloudinaryImageStorage } from './storage/cloudinary-image-storage';
import { LocalImageStorage } from './storage/local-image-storage';

const systemClock: Clock = { now: () => new Date() };

/** Servicios técnicos compartidos por todos los módulos. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: DOMAIN_EVENTS, useClass: InProcessEventBus },
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
    {
      provide: IMAGE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ImageStorage => {
        const cloudName = config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
        if (!cloudName) {
          return new LocalImageStorage(
            config.get('MEDIA_LOCAL_DIR', { infer: true }),
            config.get('API_PUBLIC_URL', { infer: true }),
          );
        }
        // La validación del entorno garantiza clave y secreto cuando hay cloud name.
        return new CloudinaryImageStorage({
          cloudName,
          apiKey: config.get('CLOUDINARY_API_KEY', { infer: true }) ?? '',
          apiSecret: config.get('CLOUDINARY_API_SECRET', { infer: true }) ?? '',
          rootFolder: config.get('CLOUDINARY_FOLDER', { infer: true }),
        });
      },
    },
  ],
  exports: [CLOCK, EMAIL_SENDER, IMAGE_STORAGE, DOMAIN_EVENTS],
})
export class PlatformModule {}
