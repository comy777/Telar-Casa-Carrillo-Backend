import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AuthenticationError,
  BusinessRuleViolation,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../domain/errors';
import { ProblemDetailsFilter } from './problem-details.filter';

describe('ProblemDetailsFilter.toProblem', () => {
  const filter = new ProblemDetailsFilter();

  it('traduce NotFoundError a 404', () => {
    const problem = filter.toProblem(new NotFoundError('Producto', 'abc'));
    expect(problem).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Producto con id abc no existe',
      details: { resource: 'Producto', id: 'abc' },
    });
  });

  it('traduce ConflictError a 409', () => {
    expect(filter.toProblem(new ConflictError('El SKU ya existe', 'SKU_TAKEN'))).toMatchObject({
      status: 409,
      code: 'SKU_TAKEN',
    });
  });

  it('traduce BusinessRuleViolation a 422', () => {
    const error = new BusinessRuleViolation('No hay stock', 'INSUFFICIENT_STOCK', { available: 0 });
    expect(filter.toProblem(error)).toMatchObject({
      status: 422,
      code: 'INSUFFICIENT_STOCK',
      details: { available: 0 },
    });
  });

  it('traduce AuthenticationError a 401 y ForbiddenError a 403', () => {
    expect(filter.toProblem(new AuthenticationError('x', 'INVALID_CREDENTIALS'))).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(filter.toProblem(new ForbiddenError('x', 'MISSING_PERMISSION'))).toMatchObject({
      status: 403,
      code: 'MISSING_PERMISSION',
    });
  });

  it('expone los mensajes de validación como lista', () => {
    const error = new BadRequestException(['email must be an email', 'name should not be empty']);
    expect(filter.toProblem(error)).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: ['email must be an email', 'name should not be empty'],
    });
  });

  it('conserva el mensaje de una HttpException', () => {
    expect(filter.toProblem(new NotFoundException('Ruta no encontrada'))).toMatchObject({
      status: 404,
      title: 'No encontrado',
      detail: 'Ruta no encontrada',
    });
  });

  it('oculta los detalles de errores inesperados', () => {
    const problem = filter.toProblem(new Error('password=secreto en la consulta'));
    expect(problem.status).toBe(500);
    expect(JSON.stringify(problem)).not.toContain('secreto');
  });
});
