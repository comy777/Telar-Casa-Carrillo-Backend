/**
 * Disponibilidad que ve el cliente. Vive en shared porque la usan inventario
 * (fuente de la verdad), carrito y catálogo (lectura para la tienda).
 */
export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface StockLevel {
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
}

/** Unidades que se pueden vender ahora: existencias menos lo apartado. */
export const availableQuantity = (level: StockLevel | null | undefined): number =>
  level ? Math.max(0, level.quantityOnHand - level.quantityReserved) : 0;

export function availabilityOf(available: number, lowStockThreshold: number): Availability {
  if (available <= 0) return 'OUT_OF_STOCK';
  return available <= lowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK';
}
