/**
 * Fuente única de permisos y roles. El script `npm run db:seed` sincroniza estas
 * definiciones con la base de datos; las fases siguientes agregan sus permisos aquí.
 */
export const PERMISSIONS = {
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  ROLES_READ: 'roles:read',
  AUDIT_READ: 'audit:read',
  CATALOG_READ: 'catalog:read',
  CATALOG_MANAGE: 'catalog:manage',
  INVENTORY_READ: 'inventory:read',
  INVENTORY_MANAGE: 'inventory:manage',
  SHIPPING_MANAGE: 'shipping:manage',
  PROMOTIONS_MANAGE: 'promotions:manage',
  ORDERS_READ: 'orders:read',
  ORDERS_MANAGE: 'orders:manage',
  PAYMENTS_READ: 'payments:read',
  PAYMENTS_REFUND: 'payments:refund',
  REPORTS_READ: 'reports:read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'users:read': 'Ver usuarios',
  'users:manage': 'Suspender, reactivar y asignar roles a usuarios',
  'roles:read': 'Ver roles y permisos',
  'audit:read': 'Ver el registro de auditoría',
  'catalog:read': 'Ver el catálogo completo, incluidos borradores y archivados',
  'catalog:manage': 'Crear y editar productos, categorías y artesanos, y publicar productos',
  'inventory:read': 'Ver existencias y movimientos de inventario',
  'inventory:manage': 'Registrar entradas, conteos y umbrales de inventario',
  'shipping:manage': 'Administrar métodos de envío y envíos',
  'promotions:manage': 'Crear y editar cupones',
  'orders:read': 'Ver pedidos y datos de los compradores',
  'orders:manage': 'Cambiar el estado de los pedidos y registrar facturas',
  'payments:read': 'Ver pagos, transacciones y notificaciones de la pasarela',
  'payments:refund': 'Solicitar reembolsos',
  'reports:read': 'Ver métricas y exportar reportes',
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
