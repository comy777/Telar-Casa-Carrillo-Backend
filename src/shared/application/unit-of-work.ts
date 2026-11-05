/**
 * Puerto para ejecutar varias operaciones de repositorio en una sola transacción.
 * Los casos de uso dependen de esta interfaz, nunca de Prisma.
 *
 * Las llamadas anidadas reutilizan la transacción abierta.
 */
export interface UnitOfWork {
  execute<T>(work: () => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UnitOfWork');
