import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import {
  CONTACT_REPOSITORY,
  ContactInbox,
  CONTENT_REPOSITORY,
  CONTENT_SETTINGS,
  ContentAdministration,
  type ContentSettings,
  Newsletter,
  NEWSLETTER_REPOSITORY,
  PublicContent,
} from './application/content.services';
import {
  PrismaContactRepository,
  PrismaContentRepository,
  PrismaNewsletterRepository,
} from './infrastructure/prisma-content.repositories';
import {
  AdminContentController,
  AdminMessagesController,
  ContactController,
  PublicContentController,
} from './presentation/content.controllers';

/** Contenido editable de la tienda, boletín y formulario de contacto. */
@Module({
  controllers: [
    PublicContentController,
    ContactController,
    AdminContentController,
    AdminMessagesController,
  ],
  providers: [
    { provide: CONTENT_REPOSITORY, useClass: PrismaContentRepository },
    { provide: NEWSLETTER_REPOSITORY, useClass: PrismaNewsletterRepository },
    { provide: CONTACT_REPOSITORY, useClass: PrismaContactRepository },
    {
      provide: CONTENT_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ContentSettings => ({
        storefrontUrl: config.get('STOREFRONT_URL', { infer: true }),
        privacyPolicyVersion: config.get('PRIVACY_POLICY_VERSION', { infer: true }),
        adminAlertEmails: config.get('ADMIN_ALERT_EMAILS', { infer: true }),
      }),
    },
    PublicContent,
    ContentAdministration,
    Newsletter,
    ContactInbox,
  ],
  exports: [ContactInbox],
})
export class ContentModule {}
