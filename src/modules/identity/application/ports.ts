import type { AuthenticatedUser } from '../../../shared/application/authenticated-user';
import type { Page, PageRequest } from '../../../shared/application/audit-trail';
import type { Email } from '../domain/email';
import type { User, UserStatus } from '../domain/user';

// ---------- Usuarios y roles ----------

/** Usuario con sus permisos efectivos, tal como lo necesita la autorización. */
export type UserAccess = AuthenticatedUser;

export interface UserListQuery extends PageRequest {
  search?: string | undefined;
  status?: UserStatus | undefined;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  findAccess(id: string): Promise<UserAccess | null>;
  /** Crea o actualiza, incluidos los roles. Lanza ConflictError si el correo ya existe. */
  save(user: User): Promise<void>;
  list(query: UserListQuery): Promise<Page<User>>;
}
export const USER_REPOSITORY = Symbol('UserRepository');

export interface RoleView {
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
}

export interface RoleRepository {
  list(): Promise<RoleView[]>;
  /** Devuelve solo los nombres que existen. */
  findExistingNames(names: string[]): Promise<string[]>;
}
export const ROLE_REPOSITORY = Symbol('RoleRepository');

// ---------- Sesiones ----------

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
}

export interface RefreshTokenRepository {
  create(token: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Marca el token como rotado solo si seguía activo; false si otro proceso lo usó antes. */
  markRotated(id: string, replacedByTokenId: string, now: Date): Promise<boolean>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeAllForUser(userId: string, now: Date): Promise<void>;
}
export const REFRESH_TOKEN_REPOSITORY = Symbol('RefreshTokenRepository');

// ---------- Tokens de un solo uso (verificación y recuperación) ----------

export type UserTokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface UserTokenRepository {
  create(token: {
    userId: string;
    purpose: UserTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Token sin usar y sin vencer. */
  findValid(
    tokenHash: string,
    purpose: UserTokenPurpose,
    now: Date,
  ): Promise<{ id: string; userId: string } | null>;
  /** Marca como usado solo si no lo estaba; false si ya se usó. */
  markUsed(id: string, now: Date): Promise<boolean>;
  invalidateAll(userId: string, purpose: UserTokenPurpose, now: Date): Promise<void>;
}
export const USER_TOKEN_REPOSITORY = Symbol('UserTokenRepository');

// ---------- Criptografía ----------

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * Con `hash = null` compara contra un hash ficticio y devuelve false: así
   * "el usuario no existe" tarda lo mismo que "contraseña incorrecta".
   */
  verify(hash: string | null, password: string): Promise<boolean>;
}
export const PASSWORD_HASHER = Symbol('PasswordHasher');

/** Tokens aleatorios opacos; en la base solo se guarda su hash. */
export interface SecureTokens {
  generate(): { token: string; hash: string };
  hash(token: string): string;
}
export const SECURE_TOKENS = Symbol('SecureTokens');

export interface AccessTokens {
  issue(userId: string): Promise<string>;
  /** Devuelve el id del usuario o null si el token es inválido o venció. */
  verify(token: string): Promise<string | null>;
}
export const ACCESS_TOKENS = Symbol('AccessTokens');
