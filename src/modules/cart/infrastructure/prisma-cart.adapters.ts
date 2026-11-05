import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError } from '../../../shared/domain/errors';
import { PrismaClientProvider } from '../../../shared/infrastructure/prisma/prisma-client.provider';
import { uniqueViolationFields } from '../../../shared/infrastructure/prisma/prisma-errors';
import type {
  CartCatalog,
  CartRepository,
  GuestCartKeys,
  PurchasableVariant,
} from '../application/ports';
import { Cart } from '../domain/cart';

const cartInclude = {
  items: { select: { variantId: true, quantity: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CartInclude;

type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

const toDomain = (row: CartRow): Cart =>
  Cart.restore({
    id: row.id,
    userId: row.userId,
    guestKeyHash: row.guestKey,
    lines: row.items,
    expiresAt: row.expiresAt,
  });

@Injectable()
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly db: PrismaClientProvider) {}

  async findById(id: string): Promise<Cart | null> {
    const row = await this.db.client.cart.findUnique({ where: { id }, include: cartInclude });
    return row ? toDomain(row) : null;
  }

  async findByUserId(userId: string): Promise<Cart | null> {
    const row = await this.db.client.cart.findUnique({ where: { userId }, include: cartInclude });
    return row ? toDomain(row) : null;
  }

  async findByGuestKeyHash(hash: string): Promise<Cart | null> {
    const row = await this.db.client.cart.findUnique({
      where: { guestKey: hash },
      include: cartInclude,
    });
    return row ? toDomain(row) : null;
  }

  async save(cart: Cart): Promise<void> {
    const s = cart.toSnapshot();
    const client = this.db.client;
    try {
      await client.cart.upsert({
        where: { id: s.id },
        create: { id: s.id, userId: s.userId, guestKey: s.guestKeyHash, expiresAt: s.expiresAt },
        // updatedAt cambia siempre: sirve de "última actividad".
        update: { expiresAt: s.expiresAt, updatedAt: new Date() },
      });
    } catch (error) {
      // Dos peticiones simultáneas crearon el carrito del mismo usuario: el cliente reintenta.
      if (uniqueViolationFields(error)?.includes('userId')) {
        throw new ConflictError('El carrito se está actualizando, intenta de nuevo', 'CART_BUSY');
      }
      throw error;
    }
    const variantIds = s.lines.map((line) => line.variantId);
    await client.cartItem.deleteMany({ where: { cartId: s.id, variantId: { notIn: variantIds } } });
    for (const line of s.lines) {
      await client.cartItem.upsert({
        where: { cartId_variantId: { cartId: s.id, variantId: line.variantId } },
        create: { cartId: s.id, variantId: line.variantId, quantity: line.quantity },
        update: { quantity: line.quantity },
      });
    }
  }

  async delete(id: string): Promise<void> {
    await this.db.client.cart.deleteMany({ where: { id } });
  }

  async findExpiredGuestCartIds(now: Date, limit: number): Promise<string[]> {
    const rows = await this.db.client.cart.findMany({
      where: { userId: null, expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }
}

/** Lee del catálogo lo necesario para mostrar y cobrar el carrito. */
@Injectable()
export class PrismaCartCatalog implements CartCatalog {
  constructor(private readonly db: PrismaClientProvider) {}

  async lookup(variantIds: string[]): Promise<Map<string, PurchasableVariant>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.db.client.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          include: {
            images: {
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              select: { url: true, altText: true, variantId: true },
            },
          },
        },
      },
    });
    return new Map(
      rows.map((row) => {
        const images = row.product.images;
        // Imagen de la variante si la hay; si no, la principal del producto.
        const image = images.find((i) => i.variantId === row.id) ?? images[0] ?? null;
        const attributes =
          row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)
            ? Object.fromEntries(
                Object.entries(row.attributes).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
              )
            : {};
        return [
          row.id,
          {
            variantId: row.id,
            productId: row.productId,
            productName: row.product.name,
            productSlug: row.product.slug,
            variantName: row.name,
            sku: row.sku,
            attributes,
            priceCents: Math.round(row.price.mul(100).toNumber()),
            currency: row.currency,
            taxRateBasisPoints: Math.round(row.product.taxRate.mul(10_000).toNumber()),
            image: image ? { url: image.url, altText: image.altText } : null,
            purchasable: row.isActive && row.product.status === 'ACTIVE',
          },
        ];
      }),
    );
  }
}

export class CryptoGuestCartKeys implements GuestCartKeys {
  generate(): { key: string; hash: string } {
    const key = randomBytes(32).toString('base64url');
    return { key, hash: this.hash(key) };
  }

  hash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }
}
