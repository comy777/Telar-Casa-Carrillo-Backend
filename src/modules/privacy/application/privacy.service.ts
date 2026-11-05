import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_TRAIL, type AuditTrail } from '../../../shared/application/audit-trail';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { UNIT_OF_WORK, type UnitOfWork } from '../../../shared/application/unit-of-work';
import {
  AuthenticationError,
  BusinessRuleViolation,
  NotFoundError,
} from '../../../shared/domain/errors';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
  USER_REPOSITORY,
  type UserRepository,
} from '../../identity/application/ports';
import { ROLES } from '../../identity/domain/permissions';
import { StockReservations } from '../../inventory/application/stock-reservations.service';

/** Todo lo que la tienda guarda de una persona (derecho de acceso, Ley 1581). */
export interface PersonalData {
  generatedAt: Date;
  account: Record<string, unknown>;
  addresses: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  cart: { variantId: string; quantity: number }[];
}

export interface PersonalDataStore {
  collect(userId: string): Promise<Omit<PersonalData, 'generatedAt'> | null>;
  activeOrderNumbers(userId: string): Promise<string[]>;
  cartIds(userId: string): Promise<string[]>;
  /**
   * Borra lo que no se necesita conservar (direcciones, sesiones, tokens,
   * carrito) y anonimiza la cuenta. Los pedidos se desligan de la cuenta pero
   * se conservan: son soporte contable y de facturación (obligación legal).
   */
  anonymize(userId: string, now: Date): Promise<void>;
}
export const PERSONAL_DATA_STORE = Symbol('PersonalDataStore');

/** Pedidos en curso: impiden borrar la cuenta hasta que terminen. */
export const ACTIVE_ORDER_STATUSES = ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED'] as const;

/**
 * Derechos del titular de los datos (Ley 1581 de 2012): conocer sus datos y
 * pedir su supresión. La supresión no alcanza los datos que la ley obliga a
 * conservar (facturas y pedidos), que quedan desligados de la cuenta.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PERSONAL_DATA_STORE) private readonly store: PersonalDataStore,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly stock: StockReservations,
  ) {}

  async export(userId: string): Promise<PersonalData> {
    const data = await this.store.collect(userId);
    if (!data) throw new NotFoundError('Cuenta');
    await this.audit.record({
      actorId: userId,
      action: 'account.data_exported',
      resource: 'User',
      resourceId: userId,
    });
    return { generatedAt: this.clock.now(), ...data };
  }

  async deleteAccount(userId: string, password: string, ipAddress: string | null): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('Cuenta');
    // Se pide la contraseña: un token robado no basta para borrar la cuenta.
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw new AuthenticationError('La contraseña no es correcta', 'INVALID_CREDENTIALS');
    }
    if (user.hasRole(ROLES.ADMIN)) {
      throw new BusinessRuleViolation(
        'Un administrador no puede borrar su cuenta; primero otro administrador debe quitarle el rol',
        'ADMIN_CANNOT_SELF_DELETE',
      );
    }
    const active = await this.store.activeOrderNumbers(userId);
    if (active.length > 0) {
      throw new BusinessRuleViolation(
        'Tienes pedidos en curso; podrás borrar la cuenta cuando terminen',
        'ACCOUNT_HAS_ACTIVE_ORDERS',
        { orders: active },
      );
    }
    await this.unitOfWork.execute(async () => {
      for (const cartId of await this.store.cartIds(userId)) {
        await this.stock.releaseForCart(cartId, 'cart_deleted');
      }
      await this.store.anonymize(userId, this.clock.now());
      await this.audit.record({
        actorId: null,
        action: 'account.deleted',
        resource: 'User',
        resourceId: userId,
        ipAddress,
      });
    });
  }
}
