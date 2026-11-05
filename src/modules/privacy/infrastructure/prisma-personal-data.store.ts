import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import {
  ACTIVE_ORDER_STATUSES,
  type PersonalData,
  type PersonalDataStore,
} from '../application/privacy.service';

@Injectable()
export class PrismaPersonalDataStore implements PersonalDataStore {
  constructor(private readonly db: PrismaClientProvider) {}

  async collect(userId: string): Promise<Omit<PersonalData, 'generatedAt'> | null> {
    const user = await this.db.client.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { select: { name: true } } } },
        addresses: true,
        orders: { include: { items: true }, orderBy: { createdAt: 'asc' } },
        carts: { include: { items: { select: { variantId: true, quantity: true } } } },
      },
    });
    if (!user) return null;
    return {
      account: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        documentType: user.documentType,
        documentNumber: user.documentNumber,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        termsAcceptedAt: user.termsAcceptedAt,
        privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt,
        privacyPolicyVersion: user.privacyPolicyVersion,
        roles: user.roles.map((r) => r.role.name),
        createdAt: user.createdAt,
      },
      addresses: user.addresses.map(({ userId: _u, ...address }) => address),
      orders: user.orders.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        total: order.grandTotal.toNumber(),
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        customerDocumentType: order.customerDocumentType,
        customerDocumentNumber: order.customerDocumentNumber,
        shippingAddress: order.shippingAddressSnapshot,
        billingAddress: order.billingAddressSnapshot,
        termsAcceptedAt: order.termsAcceptedAt,
        items: order.items.map((item) => ({
          productName: item.productName,
          variantName: item.variantName,
          quantity: item.quantity,
          lineTotal: item.lineTotal.toNumber(),
        })),
      })),
      cart: user.carts.flatMap((cart) => cart.items),
    };
  }

  async activeOrderNumbers(userId: string): Promise<string[]> {
    const rows = await this.db.client.order.findMany({
      where: { userId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
      select: { orderNumber: true },
    });
    return rows.map((row) => row.orderNumber);
  }

  async cartIds(userId: string): Promise<string[]> {
    const rows = await this.db.client.cart.findMany({ where: { userId }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  async anonymize(userId: string, now: Date): Promise<void> {
    const client = this.db.client;
    await client.address.deleteMany({ where: { userId } });
    await client.refreshToken.deleteMany({ where: { userId } });
    await client.userToken.deleteMany({ where: { userId } });
    await client.cart.deleteMany({ where: { userId } });
    await client.userRole.deleteMany({ where: { userId } });
    await client.order.updateMany({ where: { userId }, data: { userId: null } });
    await client.couponRedemption.updateMany({ where: { userId }, data: { userId: null } });
    await client.user.update({
      where: { id: userId },
      data: {
        email: `eliminado-${userId}@anon.invalid`,
        firstName: 'Cuenta',
        lastName: 'eliminada',
        phone: null,
        documentType: null,
        documentNumber: null,
        // Hash inutilizable: nadie puede volver a iniciar sesión con esta cuenta.
        passwordHash: `!deleted:${randomBytes(16).toString('hex')}`,
        status: 'SUSPENDED',
        updatedAt: now,
      },
    });
  }
}
