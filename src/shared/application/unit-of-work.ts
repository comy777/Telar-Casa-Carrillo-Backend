/**
 * Puerto para ejecutar varias operaciones de repositorio en una sola transacción.
 * Los casos de uso dependen de esta interfaz, nunca de Prisma.
 *
 * Las llamadas anidadas reutilizan la transacción abierta.
 */
export interface UnitOfWork {
  execute<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Ejecuta `callback` cuando la transacción en curso se confirme (nunca si se
   * revierte). Sin transacción abierta se ejecuta de inmediato. Sus errores se
   * registran y no afectan a la operación ya confirmada.
   */
  afterCommit(callback: () => Promise<void> | void): void;
}

export const UNIT_OF_WORK = Symbol('UnitOfWork');
