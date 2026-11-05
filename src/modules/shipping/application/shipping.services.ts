import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_TRAIL, type AuditTrail } from '../../../shared/application/audit-trail';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import { BusinessRuleViolation, NotFoundError } from '../../../shared/domain/errors';
import type { Actor } from '../../../shared/application/actor';
import {
  type AddressInput,
  MAX_ADDRESSES_PER_USER,
  normalizeLabel,
  type SavedAddress,
  toPostalAddress,
} from '../domain/address';
import {
  type ShippingMethodInput,
  type ShippingMethodProps,
  validateShippingMethod,
} from '../domain/shipping-method';

export interface AddressRepository {
  listForUser(userId: string): Promise<SavedAddress[]>;
  find(userId: string, id: string): Promise<SavedAddress | null>;
  /** Crea o actualiza; si es la predeterminada, desmarca las demás del usuario. */
  save(address: SavedAddress): Promise<void>;
  delete(userId: string, id: string): Promise<void>;
}
export const ADDRESS_REPOSITORY = Symbol('AddressRepository');

export interface ShippingMethodRepository {
  list(onlyActive: boolean): Promise<ShippingMethodProps[]>;
  find(id: string): Promise<ShippingMethodProps | null>;
  save(method: ShippingMethodProps): Promise<void>;
}
export const SHIPPING_METHOD_REPOSITORY = Symbol('ShippingMethodRepository');

/** Libreta de direcciones del cliente con sesión. */
@Injectable()
export class AddressBook {
  constructor(
    @Inject(ADDRESS_REPOSITORY) private readonly addresses: AddressRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {}

  list(userId: string): Promise<SavedAddress[]> {
    return this.addresses.listForUser(userId);
  }

  async get(userId: string, id: string): Promise<SavedAddress> {
    const address = await this.addresses.find(userId, id);
    if (!address) throw new NotFoundError('Dirección', id);
    return address;
  }

  create(
    userId: string,
    input: AddressInput & { label?: string | null | undefined; isDefault?: boolean | undefined },
  ): Promise<SavedAddress> {
    return this.unitOfWork.execute(async () => {
      const existing = await this.addresses.listForUser(userId);
      if (existing.length >= MAX_ADDRESSES_PER_USER) {
        throw new BusinessRuleViolation(
          `Puedes guardar hasta ${MAX_ADDRESSES_PER_USER} direcciones`,
          'TOO_MANY_ADDRESSES',
        );
      }
      const address: SavedAddress = {
        ...toPostalAddress(input),
        id: crypto.randomUUID(),
        userId,
        label: normalizeLabel(input.label),
        // La primera dirección queda como predeterminada.
        isDefault: existing.length === 0 || input.isDefault === true,
      };
      await this.addresses.save(address);
      return address;
    });
  }

  update(
    userId: string,
    id: string,
    input: AddressInput & { label?: string | null | undefined; isDefault?: boolean | undefined },
  ): Promise<SavedAddress> {
    return this.unitOfWork.execute(async () => {
      const current = await this.get(userId, id);
      const address: SavedAddress = {
        ...toPostalAddress(input),
        id,
        userId,
        label: input.label === undefined ? current.label : normalizeLabel(input.label),
        isDefault: current.isDefault || input.isDefault === true,
      };
      await this.addresses.save(address);
      return address;
    });
  }

  /** Si se borra la predeterminada, la siguiente toma su lugar. */
  remove(userId: string, id: string): Promise<void> {
    return this.unitOfWork.execute(async () => {
      const current = await this.get(userId, id);
      await this.addresses.delete(userId, id);
      if (current.isDefault) {
        const [next] = await this.addresses.listForUser(userId);
        if (next) await this.addresses.save({ ...next, isDefault: true });
      }
    });
  }
}

/** Métodos de envío: lista pública, administración y costo para el checkout. */
@Injectable()
export class ShippingMethods {
  constructor(
    @Inject(SHIPPING_METHOD_REPOSITORY) private readonly methods: ShippingMethodRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  list(onlyActive: boolean): Promise<ShippingMethodProps[]> {
    return this.methods.list(onlyActive);
  }

  /** Para el checkout: el método debe existir y estar activo. */
  async requireActive(id: string): Promise<ShippingMethodProps> {
    const method = await this.methods.find(id);
    if (!method?.isActive) {
      throw new BusinessRuleViolation(
        'El método de envío no está disponible',
        'SHIPPING_METHOD_UNAVAILABLE',
      );
    }
    return method;
  }

  create(actor: Actor, input: ShippingMethodInput): Promise<ShippingMethodProps> {
    return this.unitOfWork.execute(async () => {
      const method = { id: crypto.randomUUID(), ...validateShippingMethod(input) };
      await this.methods.save(method);
      await this.record(actor, 'shipping_method.created', method.id);
      return method;
    });
  }

  update(
    actor: Actor,
    id: string,
    changes: Partial<ShippingMethodInput>,
  ): Promise<ShippingMethodProps> {
    return this.unitOfWork.execute(async () => {
      const current = await this.methods.find(id);
      if (!current) throw new NotFoundError('Método de envío', id);
      const method = { ...current, ...validateShippingMethod({ ...current, ...changes }), id };
      await this.methods.save(method);
      await this.record(actor, 'shipping_method.updated', id, { fields: Object.keys(changes) });
      return method;
    });
  }

  private record(
    actor: Actor,
    action: string,
    id: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    return this.audit.record({
      actorId: actor.id,
      action,
      resource: 'ShippingMethod',
      resourceId: id,
      metadata,
      ipAddress: actor.context.ipAddress,
    });
  }
}
