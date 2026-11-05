import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';

/** Piezas artesanales: límite por línea para evitar acaparamiento y errores de digitación. */
export const MAX_QUANTITY_PER_LINE = 10;
export const MAX_LINES_PER_CART = 30;

export interface CartLine {
  variantId: string;
  quantity: number;
}

export interface CartProps {
  id: string;
  /** Dueño: usuario o invitado (el hash de la clave de su cookie). */
  userId: string | null;
  guestKeyHash: string | null;
  lines: CartLine[];
  /** Solo invitados: se renueva con cada cambio. */
  expiresAt: Date | null;
}

function requireQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
    throw new BusinessRuleViolation(
      `La cantidad debe estar entre 1 y ${MAX_QUANTITY_PER_LINE}`,
      'QUANTITY_LIMIT_EXCEEDED',
      { max: MAX_QUANTITY_PER_LINE },
    );
  }
  return quantity;
}

/**
 * Carrito. Agregar no aparta stock (eso pasa al iniciar el checkout); la
 * disponibilidad y los precios se revalidan en cada lectura.
 */
export class Cart {
  private constructor(private props: CartProps) {}

  static forUser(userId: string): Cart {
    return new Cart({
      id: crypto.randomUUID(),
      userId,
      guestKeyHash: null,
      lines: [],
      expiresAt: null,
    });
  }

  static forGuest(guestKeyHash: string, expiresAt: Date): Cart {
    return new Cart({ id: crypto.randomUUID(), userId: null, guestKeyHash, lines: [], expiresAt });
  }

  static restore(props: CartProps): Cart {
    return new Cart({ ...props, lines: props.lines.map((line) => ({ ...line })) });
  }

  get id(): string {
    return this.props.id;
  }
  get isGuest(): boolean {
    return this.props.userId === null;
  }
  get lines(): readonly CartLine[] {
    return this.props.lines;
  }
  get isEmpty(): boolean {
    return this.props.lines.length === 0;
  }

  quantityOf(variantId: string): number {
    return this.props.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
  }

  /** Suma a la línea existente o crea una nueva. */
  add(variantId: string, quantity: number): void {
    requireQuantity(quantity);
    const line = this.props.lines.find((l) => l.variantId === variantId);
    if (line) {
      line.quantity = requireQuantity(line.quantity + quantity);
      return;
    }
    if (this.props.lines.length >= MAX_LINES_PER_CART) {
      throw new BusinessRuleViolation(
        `El carrito admite hasta ${MAX_LINES_PER_CART} productos distintos`,
        'CART_FULL',
        { max: MAX_LINES_PER_CART },
      );
    }
    this.props.lines.push({ variantId, quantity });
  }

  setQuantity(variantId: string, quantity: number): void {
    const line = this.props.lines.find((l) => l.variantId === variantId);
    if (!line) throw new NotFoundError('Producto en el carrito', variantId);
    line.quantity = requireQuantity(quantity);
  }

  /** Idempotente: quitar algo que no está no es un error. */
  remove(variantId: string): void {
    this.props.lines = this.props.lines.filter((line) => line.variantId !== variantId);
  }

  clear(): void {
    this.props.lines = [];
  }

  /**
   * Incorpora el carrito de invitado al iniciar sesión: suma cantidades sin
   * superar los límites (lo que no cabe se descarta en silencio).
   */
  absorb(other: Cart): void {
    for (const line of other.lines) {
      const existing = this.props.lines.find((l) => l.variantId === line.variantId);
      if (existing) {
        existing.quantity = Math.min(MAX_QUANTITY_PER_LINE, existing.quantity + line.quantity);
      } else if (this.props.lines.length < MAX_LINES_PER_CART) {
        this.props.lines.push({
          variantId: line.variantId,
          quantity: Math.min(MAX_QUANTITY_PER_LINE, line.quantity),
        });
      }
    }
  }

  renewGuestExpiry(expiresAt: Date): void {
    if (this.isGuest) this.props.expiresAt = expiresAt;
  }

  toSnapshot(): Readonly<CartProps> {
    return Cart.restore(this.props).props;
  }
}
