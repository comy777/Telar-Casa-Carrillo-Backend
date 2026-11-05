import { Module } from '@nestjs/common';
import {
  ADDRESS_REPOSITORY,
  AddressBook,
  SHIPPING_METHOD_REPOSITORY,
  ShippingMethods,
} from './application/shipping.services';
import {
  PrismaAddressRepository,
  PrismaShippingMethodRepository,
} from './infrastructure/prisma-shipping.repositories';
import {
  AddressBookController,
  AdminShippingMethodsController,
  ShippingMethodsController,
} from './presentation/shipping.controllers';

@Module({
  controllers: [AddressBookController, ShippingMethodsController, AdminShippingMethodsController],
  providers: [
    { provide: ADDRESS_REPOSITORY, useClass: PrismaAddressRepository },
    { provide: SHIPPING_METHOD_REPOSITORY, useClass: PrismaShippingMethodRepository },
    AddressBook,
    ShippingMethods,
  ],
  exports: [AddressBook, ShippingMethods],
})
export class ShippingModule {}
