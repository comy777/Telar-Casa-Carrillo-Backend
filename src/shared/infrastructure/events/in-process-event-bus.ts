import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DomainEvent,
  DomainEvents,
  DomainEventType,
  EventHandler,
} from '../../application/domain-events';
import { UNIT_OF_WORK, type UnitOfWork } from '../../application/unit-of-work';

/**
 * Bus de eventos en memoria. Suficiente para una sola aplicación: si el
 * proceso se cae entre el commit y el envío, la notificación se pierde (el
 * dato de negocio no). Si eso llegara a importar, reemplazar por una tabla
 * outbox procesada por un proceso programado.
 */
@Injectable()
export class InProcessEventBus implements DomainEvents {
  private readonly logger = new Logger(InProcessEventBus.name);
  private readonly handlers = new Map<DomainEventType, EventHandler<DomainEventType>[]>();

  constructor(@Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork) {}

  publish(event: DomainEvent): void {
    this.unitOfWork.afterCommit(() => this.dispatch(event));
  }

  subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as unknown as EventHandler<DomainEventType>);
    this.handlers.set(type, list);
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error(
          `Falló el manejo de ${event.type}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
  }
}
