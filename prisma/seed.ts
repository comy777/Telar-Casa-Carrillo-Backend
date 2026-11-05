/**
 * Sincroniza permisos y roles con src/modules/identity/domain/permissions.ts.
 * Es idempotente: se puede ejecutar en cada despliegue (`npm run db:seed`).
 * No crea usuarios; para el primer administrador usa `npm run admin:grant`.
 */
import { PrismaClient } from '@prisma/client';
import {
  PERMISSION_DESCRIPTIONS,
  type PermissionKey,
  ROLE_DEFINITIONS,
} from '../src/modules/identity/domain/permissions';

export async function seedAccessControl(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSION_DESCRIPTIONS)) {
      await tx.permission.upsert({
        where: { key },
        create: { key, description },
        update: { description },
      });
    }
    // Permisos que ya no están en el código: se quitan de los roles y se borran.
    await tx.permission.deleteMany({
      where: { key: { notIn: Object.keys(PERMISSION_DESCRIPTIONS) } },
    });

    for (const role of ROLE_DEFINITIONS) {
      const saved = await tx.role.upsert({
        where: { name: role.name },
        create: { name: role.name, description: role.description },
        update: { description: role.description },
      });
      const permissions = await tx.permission.findMany({
        where: { key: { in: role.permissions as PermissionKey[] } },
        select: { id: true },
      });
      await tx.rolePermission.deleteMany({ where: { roleId: saved.id } });
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ roleId: saved.id, permissionId: permission.id })),
      });
    }
  });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedAccessControl(prisma)
    .then(() => console.log(`Roles sincronizados: ${ROLE_DEFINITIONS.map((r) => r.name).join(', ')}`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
