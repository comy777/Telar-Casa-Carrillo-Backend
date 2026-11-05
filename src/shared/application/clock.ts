/** Fuente de la hora actual; en pruebas se reemplaza por un reloj fijo. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('Clock');
