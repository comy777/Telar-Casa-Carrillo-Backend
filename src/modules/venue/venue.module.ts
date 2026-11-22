import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import {
  PublicVenue,
  QUOTE_REPOSITORY,
  QuoteDesk,
  VENUE_CONFIG,
  VENUE_REPOSITORY,
  VenueAdministration,
  type VenueConfig,
} from './application/venue.services';
import {
  PrismaQuoteRepository,
  PrismaVenueRepository,
} from './infrastructure/prisma-venue.repositories';
import {
  AdminQuotesController,
  AdminVenueController,
  PublicVenueController,
} from './presentation/venue.controllers';

/** «El lugar»: la página «Visítanos», sus actividades y las solicitudes de cotización. */
@Module({
  controllers: [PublicVenueController, AdminVenueController, AdminQuotesController],
  providers: [
    { provide: VENUE_REPOSITORY, useClass: PrismaVenueRepository },
    { provide: QUOTE_REPOSITORY, useClass: PrismaQuoteRepository },
    {
      provide: VENUE_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): VenueConfig => ({
        privacyPolicyVersion: config.get('PRIVACY_POLICY_VERSION', { infer: true }),
        adminAlertEmails: config.get('ADMIN_ALERT_EMAILS', { infer: true }),
      }),
    },
    PublicVenue,
    VenueAdministration,
    QuoteDesk,
  ],
})
export class VenueModule {}
