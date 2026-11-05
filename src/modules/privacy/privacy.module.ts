import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PERSONAL_DATA_STORE, PrivacyService } from './application/privacy.service';
import { PrismaPersonalDataStore } from './infrastructure/prisma-personal-data.store';
import { PrivacyController } from './presentation/privacy.controller';

/** Derechos del titular de los datos (Ley 1581 de 2012): acceso y supresión. */
@Module({
  imports: [IdentityModule, InventoryModule],
  controllers: [PrivacyController],
  providers: [{ provide: PERSONAL_DATA_STORE, useClass: PrismaPersonalDataStore }, PrivacyService],
})
export class PrivacyModule {}
