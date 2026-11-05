import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { OrderingModule } from '../ordering/ordering.module';
import {
  NOTIFICATION_SETTINGS,
  type NotificationSettings,
  NotificationsService,
} from './application/notifications.service';

@Module({
  imports: [OrderingModule, FulfillmentModule],
  providers: [
    {
      provide: NOTIFICATION_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): NotificationSettings => ({
        storefrontUrl: config.get('STOREFRONT_URL', { infer: true }),
        adminUrl: config.get('ADMIN_URL', { infer: true }),
        adminEmails: config.get('ADMIN_ALERT_EMAILS', { infer: true }),
      }),
    },
    NotificationsService,
  ],
})
export class NotificationsModule {}
