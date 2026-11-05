/**
 * Da un rol a un usuario ya registrado. Sirve para crear el primer administrador:
 *   1. Registrarse normalmente en la tienda y confirmar el correo.
 *   2. npm run admin:grant -- correo@ejemplo.com admin
 * Queda registrado en la auditoría como acción del sistema.
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const [rawEmail, roleName = 'admin'] = process.argv.slice(2);
  if (!rawEmail) {
    throw new Error('Uso: npm run admin:grant -- <correo> [rol]');
  }
  const email = rawEmail.trim().toLowerCase();
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });
    if (!user) throw new Error(`No existe un usuario con el correo ${email}`);
    const role = await prisma.role.findUnique({ where: { name: roleName }, select: { id: true } });
    if (!role) throw new Error(`No existe el rol "${roleName}". ¿Ejecutaste npm run db:seed?`);

    await prisma.$transaction([
      prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        create: { userId: user.id, roleId: role.id },
        update: {},
      }),
      prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'user.role_granted_cli',
          resource: 'User',
          resourceId: user.id,
          metadata: { role: roleName },
        },
      }),
    ]);
    console.log(`Rol "${roleName}" asignado a ${email}.`);
    if (user.status !== 'ACTIVE') {
      console.warn(
        `Atención: la cuenta está en estado ${user.status}; no podrá iniciar sesión hasta estar activa.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
