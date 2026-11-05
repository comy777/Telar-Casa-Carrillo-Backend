import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, type DomainErrorKind } from '../domain/errors';

/** Formato de error RFC 9457 (application/problem+json). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Código estable para que el cliente decida qué hacer. */
  code?: string;
  /** Errores de validación campo por campo. */
  errors?: string[];
  details?: Record<string, unknown>;
  requestId?: string;
}

const DOMAIN_STATUS: Record<DomainErrorKind, number> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  BUSINESS_RULE: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
};

const TITLES: Partial<Record<number, string>> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Acceso denegado',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Solicitud demasiado grande',
  422: 'Regla de negocio incumplida',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
  503: 'Servicio no disponible',
};

const titleFor = (status: number): string => TITLES[status] ?? 'Error';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();

    const problem = this.toProblem(exception);
    problem.instance = request.originalUrl;
    if (typeof request.id === 'string') {
      problem.requestId = request.id;
    }

    if (problem.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`Error no controlado en ${request.method} ${request.originalUrl}`, stack);
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof DomainError) {
      const status = DOMAIN_STATUS[exception.kind];
      return {
        type: 'about:blank',
        title: titleFor(status),
        status,
        detail: exception.message,
        code: exception.code,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body ? body.message : body;

      // ValidationPipe devuelve un arreglo con un mensaje por campo.
      if (Array.isArray(message)) {
        return {
          type: 'about:blank',
          title: titleFor(status),
          status,
          detail: 'La solicitud tiene datos inválidos',
          code: 'VALIDATION_FAILED',
          errors: message.map(String),
        };
      }

      return {
        type: 'about:blank',
        title: titleFor(status),
        status,
        detail: typeof message === 'string' ? message : exception.message,
      };
    }

    // Nunca exponer detalles internos al cliente.
    return {
      type: 'about:blank',
      title: titleFor(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Ocurrió un error inesperado',
    };
  }
}
