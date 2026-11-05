/**
 * Fuente única de permisos y roles. El script `npm run db:seed` sincroniza estas
 * definiciones con la base de datos; las fases siguientes agregan sus permisos aquí.
 */
export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  ROLES_READ: 'roles:read',
  AUDIT_READ: 'audit:read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'users:read': 'Ver usuarios',
  'users:manage': 'Suspender, reactivar y asignar roles a usuarios',
  'roles:read': 'Ver roles y permisos',
  'audit:read': 'Ver el registro de auditoría',
};

export const ROLES = {
  ADMIN: 'admin',
  CUSTOMER: 'customer',
} as const;

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    name: ROLES.ADMIN,
    description: 'Administración completa de la tienda',
    permissions: Object.values(PERMISSIONS),
  },
  {
    name: ROLES.CUSTOMER,
    description: 'Cliente de la tienda',
    permissions: [],
  },
];
