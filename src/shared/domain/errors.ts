/**
 * Errores del dominio. No conocen HTTP: la capa de presentación los traduce
 * a respuestas (ver ProblemDetailsFilter).
 */
export type DomainErrorKind =
  'NOT_FOUND' | 'CONFLICT' | 'BUSINESS_RULE' | 'UNAUTHENTICATED' | 'FORBIDDEN';

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  protected constructor(
    message: string,
    /** Código estable para el cliente, p. ej. "INSUFFICIENT_STOCK". */
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  override readonly kind = 'NOT_FOUND' as const;

  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} con id ${id} no existe` : `${resource} no existe`,
      'NOT_FOUND',
      id ? { resource, id } : { resource },
    );
  }
}

export class ConflictError extends DomainError {
  override readonly kind = 'CONFLICT' as const;

  constructor(message: string, code = 'CONFLICT', details?: Record<string, unknown>) {
    super(message, code, details);
  }
}

/** No se pudo establecer quién hace la petición (credenciales o sesión inválidas). */
export class AuthenticationError extends DomainError {
  override readonly kind = 'UNAUTHENTICATED' as const;

  constructor(message: string, code: string) {
    super(message, code);
  }
}

/** Se sabe quién hace la petición, pero no puede realizar la acción. */
export class ForbiddenError extends DomainError {
  override readonly kind = 'FORBIDDEN' as const;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
  }
}

/** Una regla de negocio impide la operación (stock insuficiente, transición inválida...). */
export class BusinessRuleViolation extends DomainError {
  override readonly kind = 'BUSINESS_RULE' as const;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
  }
}
