import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import type { AddressRepository, ShippingMethodRepository } from '../application/shipping.services';
import type { SavedAddress } from '../domain/address';
import type { ShippingMethodProps } from '../domain/shipping-method';

const cents = (value: Prisma.Decimal): number => Math.round(value.mul(100).toNumber());
const decimal = (value: number): Prisma.Decimal => new Prisma.Decimal(value).div(100);

type AddressRow = Prisma.AddressGetPayload<object>;

const toAddress = (row: AddressRow): SavedAddress => ({
  id: row.id,
  userId: row.userId,
  label: row.label,
  recipient: row.recipient,
  phone: row.phone,
  line1: row.line1,
  line2: row.line2,
  city: row.city,
  department: row.department,
  cityDaneCode: row.cityDaneCode ?? '',
  postalCode: row.postalCode,
  countryCode: 'CO',
  isDefault: row.isDefault,
});

@Injectable()
export class PrismaAddressRepository implements AddressRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async listForUser(userId: string): Promise<SavedAddress[]> {
    const rows = await this.db.client.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAddress);
  }

  async find(userId: string, id: string): Promise<SavedAddress | null> {
    const row = await this.db.client.address.findFirst({ where: { id, userId } });
    return row ? toAddress(row) : null;
  }

  async save(address: SavedAddress): Promise<void> {
    const { id, userId, countryCode, ...fields } = address;
    // Índice parcial: solo una predeterminada por usuario; se desmarca la anterior primero.
    if (fields.isDefault) {
      await this.db.client.address.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    await this.db.client.address.upsert({
      where: { id },
      create: { id, userId, countryCode, ...fields },
      update: { ...fields, countryCode },
    });
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.db.client.address.deleteMany({ where: { id, userId } });
  }
}

type MethodRow = Prisma.ShippingMethodGetPayload<object>;

const toMethod = (row: MethodRow): ShippingMethodProps => ({
  id: row.id,
  name: row.name,
  description: row.description,
  basePriceCents: cents(row.basePrice),
  freeShippingThresholdCents: row.freeShippingThreshold ? cents(row.freeShippingThreshold) : null,
  estimatedDelivery: row.estimatedDelivery,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
});

@Injectable()
export class PrismaShippingMethodRepository implements ShippingMethodRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async list(onlyActive: boolean): Promise<ShippingMethodProps[]> {
    const rows = await this.db.client.shippingMethod.findMany({
      where: onlyActive ? { isActive: true } : {},
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toMethod);
  }

  async find(id: string): Promise<ShippingMethodProps | null> {
    const row = await this.db.client.shippingMethod.findUnique({ where: { id } });
    return row ? toMethod(row) : null;
  }

  async save(method: ShippingMethodProps): Promise<void> {
    const { id, basePriceCents, freeShippingThresholdCents, ...rest } = method;
    const fields = {
      ...rest,
      basePrice: decimal(basePriceCents),
      freeShippingThreshold:
        freeShippingThresholdCents === null ? null : decimal(freeShippingThresholdCents),
    };
    await this.db.client.shippingMethod.upsert({
      where: { id },
      create: { id, ...fields },
      update: fields,
    });
  }
}
