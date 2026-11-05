import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/application/email-sender';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import {
  type IdentityDocumentType,
  normalizeDocumentNumber,
} from '../../../shared/domain/colombia';
import { BusinessRuleViolation } from '../../../shared/domain/errors';
import {
  type CartIdentity,
  CartService,
  type CartView,
  type GuestCookie,
} from '../../cart/application/cart.service';
import { centsToPesos } from '../../catalog/domain/money';
import { StockReservations } from '../../inventory/application/stock-reservations.service';
import {
  type AppliedCoupon,
  type CouponCustomer,
  CouponRedemptions,
} from '../../promotions/application/coupons.services';
import { AddressBook, ShippingMethods } from '../../shipping/application/shipping.services';
import {
  type AddressInput,
  normalizePhone,
  type PostalAddress,
  toPostalAddress,
} from '../../shipping/domain/address';
import { shippingCostFor } from '../../shipping/domain/shipping-method';
import { formatOrderNumber } from '../domain/order-status';
import { computeTotals, type OrderTotals, type PricingLine } from '../domain/pricing';
import {
  ORDER_ACCESS_TOKENS,
  ORDER_REPOSITORY,
  ORDERING_SETTINGS,
  type OrderAccessTokens,
  type OrderingSettings,
  type OrderRecord,
  type OrderRepository,
} from './ports';

/** Cliente con sesión (si la hay). */
export interface CheckoutUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface QuoteInput {
  shippingMethodId?: string | undefined;
  couponCode?: string | null | undefined;
  /** Para contar los usos por cliente del cupón (invitados). */
  email?: string | undefined;
}

export interface PlaceOrderInput {
  /** Obligatorio para invitados; con sesión se usa el de la cuenta. */
  email?: string | undefined;
  customerName: string;
  phone: string;
  document?: { type: IdentityDocumentType; number: string } | null | undefined;
  /** Con sesión se puede usar una dirección guardada. */
  addressId?: string | undefined;
  shippingAddress?: AddressInput | undefined;
  billingAddress?: AddressInput | null | undefined;
  shippingMethodId: string;
  couponCode?: string | null | undefined;
  notes?: string | null | undefined;
  acceptTerms: boolean;
}

export interface Quote {
  totals: OrderTotals;
  coupon: AppliedCoupon | null;
  shippingMethod: { id: string; name: string } | null;
  cart: CartView;
}

export interface PlacedOrder {
  order: OrderRecord;
  /** Solo invitados: para consultar el pedido (va en el enlace del correo). */
  accessToken: string | null;
  cookie: GuestCookie;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string | undefined): string {
  const value = email?.trim().toLowerCase() ?? '';
  if (!EMAIL_PATTERN.test(value) || value.length > 254) {
    throw new BusinessRuleViolation('Indica un correo válido', 'INVALID_EMAIL');
  }
  return value;
}

/**
 * Checkout: convierte el carrito en un pedido PENDING_PAYMENT en una sola
 * transacción. Los precios, el IVA, el cupón y el envío se calculan aquí,
 * nunca se aceptan del navegador.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly carts: CartService,
    private readonly stock: StockReservations,
    private readonly coupons: CouponRedemptions,
    private readonly addresses: AddressBook,
    private readonly shipping: ShippingMethods,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(ORDER_ACCESS_TOKENS) private readonly tokens: OrderAccessTokens,
    @Inject(ORDERING_SETTINGS) private readonly settings: OrderingSettings,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Totales sin crear el pedido (para mostrar el resumen antes de pagar). */
  quote(identity: CartIdentity, user: CheckoutUser | null, input: QuoteInput): Promise<Quote> {
    return this.unitOfWork.execute(async () => {
      const { cart } = await this.carts.current(identity);
      const view = await this.carts.view(cart);
      const lines = this.pricingLines(view);
      const subtotal = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
      const coupon =
        input.couponCode && view.canCheckout
          ? await this.coupons.preview(
              input.couponCode,
              subtotal,
              this.couponCustomer(user, input.email),
            )
          : null;
      const method = input.shippingMethodId
        ? await this.shipping.requireActive(input.shippingMethodId)
        : null;
      const discount = coupon?.discountCents ?? 0;
      const shippingCents =
        method && view.canCheckout ? shippingCostFor(method, subtotal - discount) : 0;
      return {
        totals: computeTotals(lines, discount, shippingCents, this.settings.shippingTaxBasisPoints),
        coupon,
        shippingMethod: method ? { id: method.id, name: method.name } : null,
        cart: view,
      };
    });
  }

  async placeOrder(
    identity: CartIdentity,
    user: CheckoutUser | null,
    input: PlaceOrderInput,
  ): Promise<PlacedOrder> {
    if (!input.acceptTerms) {
      throw new BusinessRuleViolation(
        'Debes aceptar los términos y la política de tratamiento de datos',
        'TERMS_NOT_ACCEPTED',
      );
    }
    const customer = this.customerData(user, input);

    const placed = await this.unitOfWork.execute(async () => {
      const { cart, cookie } = await this.carts.current(identity);
      if (!cart || cart.isEmpty)
        throw new BusinessRuleViolation('El carrito está vacío', 'CART_EMPTY');
      const view = await this.carts.view(cart);
      if (!view.canCheckout) {
        throw new BusinessRuleViolation(
          'Revisa el carrito: hay productos no disponibles o sin unidades suficientes',
          'CART_HAS_ISSUES',
        );
      }

      const shippingAddress = await this.shippingAddress(user, input);
      const billingAddress = input.billingAddress ? toPostalAddress(input.billingAddress) : null;
      const method = await this.shipping.requireActive(input.shippingMethodId);

      const lines = this.pricingLines(view);
      const subtotal = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
      const couponCustomer = { email: customer.email, userId: user?.id ?? null };
      // Bloquea el cupón hasta el commit: los límites de uso se respetan en paralelo.
      const coupon = input.couponCode
        ? await this.coupons.lockAndEvaluate(input.couponCode, subtotal, couponCustomer)
        : null;
      const discount = coupon?.discountCents ?? 0;
      const totals = computeTotals(
        lines,
        discount,
        shippingCostFor(method, subtotal - discount),
        this.settings.shippingTaxBasisPoints,
      );

      // Aparta el stock (todo o nada); lanza INSUFFICIENT_STOCK si algo se agotó.
      await this.stock.reserveForCart(cart.id, [...cart.lines]);

      const now = this.clock.now();
      const paymentDueAt = new Date(now.getTime() + this.settings.paymentMinutes * 60_000);
      const orderId = crypto.randomUUID();
      const orderNumber = formatOrderNumber(
        this.settings.orderNumberPrefix,
        await this.orders.nextSequence(),
      );
      const access = user ? null : this.tokens.generate();
      const products = new Map(view.lines.map((line) => [line.variantId, line.product!]));

      await this.orders.create({
        id: orderId,
        orderNumber,
        userId: user?.id ?? null,
        currency: 'COP',
        subtotalCents: totals.subtotalCents,
        discountTotalCents: totals.discountCents,
        shippingTotalCents: totals.shippingCents,
        taxTotalCents: totals.taxCents,
        grandTotalCents: totals.grandTotalCents,
        customer,
        shippingAddress,
        billingAddress,
        shippingMethodId: method.id,
        couponId: coupon?.couponId ?? null,
        notes: input.notes?.trim().slice(0, 500) || null,
        guestAccessTokenHash: access?.hash ?? null,
        paymentDueAt,
        termsAcceptedAt: now,
        privacyPolicyVersion: this.settings.privacyPolicyVersion,
        createdAt: now,
        items: totals.lines.map((line) => {
          const product = products.get(line.variantId)!;
          return {
            id: crypto.randomUUID(),
            productId: product.productId,
            variantId: line.variantId,
            productName: product.productName,
            variantName: product.variantName,
            sku: product.sku,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            discountCents: line.discountCents,
            lineTotalCents: line.totalCents,
            taxRateBasisPoints: line.taxRateBasisPoints,
            taxCents: line.taxCents,
            // Lo que el cliente vio al comprar, aunque el catálogo cambie después.
            snapshot: {
              productSlug: product.productSlug,
              attributes: product.attributes,
              image: product.image,
              unitPrice: centsToPesos(line.unitPriceCents),
              taxRate: line.taxRateBasisPoints / 10_000,
            },
          };
        }),
      });
      if (coupon) await this.coupons.record(coupon, orderId, couponCustomer);
      await this.stock.transferCartToOrder(cart.id, orderId, paymentDueAt);
      await this.carts.emptyAfterOrder(cart);

      const order = (await this.orders.findById(orderId))!;
      return { order, accessToken: access?.token ?? null, cookie };
    });

    await this.sendConfirmation(placed.order, placed.accessToken);
    return placed;
  }

  // ---------- utilidades ----------

  private pricingLines(view: CartView): PricingLine[] {
    return view.lines
      .filter((line) => line.product && line.issues.length === 0)
      .map((line) => ({
        variantId: line.variantId,
        unitPriceCents: line.product!.priceCents,
        quantity: line.quantity,
        taxRateBasisPoints: line.product!.taxRateBasisPoints,
      }));
  }

  private couponCustomer(user: CheckoutUser | null, email: string | undefined): CouponCustomer {
    if (user) return { email: user.email, userId: user.id };
    return { email: email ? normalizeEmail(email) : '', userId: null };
  }

  private customerData(user: CheckoutUser | null, input: PlaceOrderInput) {
    const name = input.customerName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 160) {
      throw new BusinessRuleViolation('Indica el nombre del comprador', 'FIELD_REQUIRED', {
        field: 'customerName',
      });
    }
    const document = input.document
      ? {
          documentType: input.document.type,
          documentNumber: normalizeDocumentNumber(input.document.type, input.document.number),
        }
      : { documentType: null, documentNumber: null };
    return {
      email: user ? user.email : normalizeEmail(input.email),
      name,
      phone: normalizePhone(input.phone),
      ...document,
    };
  }

  private async shippingAddress(
    user: CheckoutUser | null,
    input: PlaceOrderInput,
  ): Promise<PostalAddress> {
    if (input.addressId) {
      if (!user) {
        throw new BusinessRuleViolation(
          'Inicia sesión para usar una dirección guardada',
          'ADDRESS_REQUIRES_LOGIN',
        );
      }
      const {
        id: _id,
        userId: _u,
        label: _l,
        isDefault: _d,
        ...address
      } = await this.addresses.get(user.id, input.addressId);
      return address;
    }
    if (!input.shippingAddress) {
      throw new BusinessRuleViolation('Indica la dirección de envío', 'ADDRESS_REQUIRED');
    }
    return toPostalAddress(input.shippingAddress);
  }

  /** El pedido ya está creado: si el correo falla, solo se registra. */
  private async sendConfirmation(order: OrderRecord, accessToken: string | null): Promise<void> {
    const link = accessToken
      ? `${this.settings.storefrontUrl}/pedido/${order.orderNumber}?token=${accessToken}`
      : `${this.settings.storefrontUrl}/cuenta/pedidos/${order.orderNumber}`;
    const total = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(
      centsToPesos(order.grandTotalCents),
    );
    try {
      await this.email.send({
        to: order.customer.email,
        subject: `Recibimos tu pedido ${order.orderNumber}`,
        text: [
          `Hola ${order.customer.name},`,
          '',
          `Recibimos tu pedido ${order.orderNumber} por ${total}.`,
          'Lo prepararemos en cuanto se confirme el pago.',
          '',
          `Consulta su estado aquí: ${link}`,
          '',
          'Telar Casa Carrillo',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(`No se pudo enviar la confirmación de ${order.orderNumber}`, error);
    }
  }
}
