import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import type { Availability, StockLevel } from '../../../shared/domain/stock-availability';
import type { MovementType } from '../domain/stock';

export interface StockRecord extends StockLevel {
  variantId: string;
}

export interface NewMovement {
  variantId: string;
  type: MovementType;
  quantity: number;
  /** Saldo después del movimiento. */
  after: StockLevel;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}

export interface MovementView {
  id: string;
  type: MovementType;
  quantity: number;
  onHandAfter: number;
  reservedAfter: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
}

export type StockFilter = 'available' | 'low' | 'out';

export interface InventoryListQuery extends PageRequest {
  search?: string | undefined;
  productId?: string | undefined;
  stock?: StockFilter | undefined;
}

export interface InventoryItemView extends StockLevel {
  variantId: string;
  sku: string;
  variantName: string;
  variantActive: boolean;
  productId: string;
  productName: string;
  productStatus: string;
  available: number;
  availability: Availability;
  updatedAt: Date | null;
}

/**
 * Existencias por variante. Las variantes sin fila de inventario cuentan con 0
 * unidades; la fila se crea con el primer ingreso o conteo.
 *
 * Las operaciones que cambian cantidades son atómicas en la base: nunca se
 * lee-y-luego-escribe, así dos compras simultáneas no pueden vender la misma unidad.
 */
export interface InventoryRepository {
  levels(variantIds: string[]): Promise<Map<string, StockRecord>>;
  variantExists(variantId: string): Promise<boolean>;
  /** Suma existencias (crea la fila si no existe). */
  receive(variantId: string, quantity: number): Promise<StockRecord>;
  /** Fija las existencias; null si quedarían por debajo de lo reservado. */
  setOnHand(variantId: string, quantityOnHand: number): Promise<StockRecord | null>;
  setThreshold(variantId: string, threshold: number): Promise<StockRecord>;
  /** Aparta unidades solo si hay suficientes disponibles; null si no. */
  tryReserve(variantId: string, quantity: number): Promise<StockRecord | null>;
  releaseReserved(variantId: string, quantity: number): Promise<StockRecord>;
  recordMovement(movement: NewMovement): Promise<void>;
  movements(variantId: string, page: PageRequest): Promise<Page<MovementView>>;
  list(query: InventoryListQuery): Promise<Page<InventoryItemView>>;
  findItem(variantId: string): Promise<InventoryItemView | null>;
}
export const INVENTORY_REPOSITORY = Symbol('InventoryRepository');

export interface ReservationRecord {
  id: string;
  variantId: string;
  cartId: string | null;
  quantity: number;
  expiresAt: Date;
}

export interface ReservationRepository {
  create(reservation: ReservationRecord & { cartId: string }): Promise<void>;
  activeForCart(cartId: string): Promise<ReservationRecord[]>;
  /**
   * Marca la reserva como liberada solo si seguía activa. Devuelve false si
   * otro proceso ya la liberó (así nunca se devuelve stock dos veces).
   */
  markReleased(id: string, now: Date): Promise<boolean>;
  findExpired(now: Date, limit: number): Promise<ReservationRecord[]>;
}
export const RESERVATION_REPOSITORY = Symbol('ReservationRepository');

export interface InventorySettings {
  reservationMinutes: number;
}
export const INVENTORY_SETTINGS = Symbol('InventorySettings');
