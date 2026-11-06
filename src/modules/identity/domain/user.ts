import { BusinessRuleViolation } from '../../../shared/domain/errors';
import type { Email } from './email';

export type UserStatus = 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED';

export interface UserProps {
  id: string;
  email: Email;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  termsAcceptedAt: Date | null;
  privacyPolicyAcceptedAt: Date | null;
  privacyPolicyVersion: string | null;
  roles: string[];
  createdAt: Date;
}

export interface RegisterUserProps {
  email: Email;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  privacyPolicyVersion: string;
  roles: string[];
  now: Date;
}

const MAX_NAME_LENGTH = 80;

function requireName(value: string, field: string): string {
  const name = value.trim();
  if (!name) {
    throw new BusinessRuleViolation(`El campo ${field} es obligatorio`, 'NAME_REQUIRED', { field });
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new BusinessRuleViolation(
      `El campo ${field} no puede superar ${MAX_NAME_LENGTH} caracteres`,
      'NAME_TOO_LONG',
      { field },
    );
  }
  return name;
}

/**
 * Cuenta de usuario. Estados:
 *   PENDING_VERIFICATION --verifyEmail--> ACTIVE
 *   ACTIVE | PENDING_VERIFICATION --suspend--> SUSPENDED --reactivate--> (el estado previo según si verificó el correo)
 */
export class User {
  private constructor(private props: UserProps) {}

  /** Alta desde el formulario de registro: queda pendiente de verificar el correo. */
  static register(input: RegisterUserProps): User {
    if (input.roles.length === 0) {
      throw new BusinessRuleViolation('El usuario debe tener al menos un rol', 'ROLE_REQUIRED');
    }
    return new User({
      id: crypto.randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: requireName(input.firstName, 'nombre'),
      lastName: requireName(input.lastName, 'apellido'),
      phone: input.phone?.trim() || null,
      status: 'PENDING_VERIFICATION',
      emailVerifiedAt: null,
      // Ley 1581: evidencia de cuándo aceptó y qué versión de la política.
      termsAcceptedAt: input.now,
      privacyPolicyAcceptedAt: input.now,
      privacyPolicyVersion: input.privacyPolicyVersion,
      roles: [...new Set(input.roles)],
      createdAt: input.now,
    });
  }

  /** Reconstrucción desde persistencia: no valida, los datos ya pasaron por el dominio. */
  static restore(props: UserProps): User {
    return new User({ ...props, roles: [...props.roles] });
  }

  get id(): string {
    return this.props.id;
  }
  get email(): Email {
    return this.props.email;
  }
  get passwordHash(): string {
    return this.props.passwordHash;
  }
  get firstName(): string {
    return this.props.firstName;
  }
  get status(): UserStatus {
    return this.props.status;
  }
  get roles(): readonly string[] {
    return this.props.roles;
  }

  get isActive(): boolean {
    return this.props.status === 'ACTIVE';
  }

  hasRole(role: string): boolean {
    return this.props.roles.includes(role);
  }

  /** Idempotente: verificar dos veces no cambia nada. */
  verifyEmail(now: Date): void {
    if (this.props.status === 'SUSPENDED') {
      throw new BusinessRuleViolation('La cuenta está suspendida', 'ACCOUNT_SUSPENDED');
    }
    if (this.props.emailVerifiedAt) return;
    this.props.emailVerifiedAt = now;
    this.props.status = 'ACTIVE';
  }

  get lastName(): string {
    return this.props.lastName;
  }
  get phone(): string | null {
    return this.props.phone;
  }

  /** El cliente edita su nombre y teléfono; el correo no cambia por aquí. */
  updateProfile(changes: { firstName?: string; lastName?: string; phone?: string | null }): void {
    if (changes.firstName !== undefined)
      this.props.firstName = requireName(changes.firstName, 'nombre');
    if (changes.lastName !== undefined)
      this.props.lastName = requireName(changes.lastName, 'apellido');
    if (changes.phone !== undefined) {
      const phone = changes.phone?.trim() || null;
      if (phone && phone.length > 30) {
        throw new BusinessRuleViolation('El teléfono admite hasta 30 caracteres', 'PHONE_TOO_LONG');
      }
      this.props.phone = phone;
    }
  }

  changePasswordHash(passwordHash: string): void {
    this.props.passwordHash = passwordHash;
  }

  suspend(): void {
    if (this.props.status === 'SUSPENDED') {
      throw new BusinessRuleViolation('La cuenta ya está suspendida', 'ALREADY_SUSPENDED');
    }
    this.props.status = 'SUSPENDED';
  }

  reactivate(): void {
    if (this.props.status !== 'SUSPENDED') {
      throw new BusinessRuleViolation(
        'Solo se puede reactivar una cuenta suspendida',
        'NOT_SUSPENDED',
      );
    }
    this.props.status = this.props.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
  }

  assignRoles(roles: string[]): void {
    const unique = [...new Set(roles)];
    if (unique.length === 0) {
      throw new BusinessRuleViolation('El usuario debe tener al menos un rol', 'ROLE_REQUIRED');
    }
    this.props.roles = unique;
  }

  toSnapshot(): Readonly<UserProps> {
    return { ...this.props, roles: [...this.props.roles] };
  }
}
