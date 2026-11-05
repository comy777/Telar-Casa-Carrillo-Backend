import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import type { EmailMessage, EmailSender } from '../../src/shared/application/email-sender';
import { EMAIL_SENDER } from '../../src/shared/application/email-sender';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';

/** Guarda los correos en memoria para leer los enlaces en las pruebas. */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Token del último enlace enviado a `to` cuyo asunto contiene `subject`. */
  lastToken(to: string, subject: RegExp): string {
    const message = [...this.sent].reverse().find((m) => m.to === to && subject.test(m.subject));
    const token = message?.text.match(/[?&]token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`No hay correo "${subject.source}" para ${to}`);
    return token;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaClient;
  emails: InMemoryEmailSender;
  /** Borra los datos de usuarios (conserva roles y permisos). */
  reset(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const emails = new InMemoryEmailSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_SENDER)
    .useValue(emails)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    emails,
    reset: async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE "AuditLog", "RefreshToken", "UserToken", "UserRole", "User" CASCADE',
      );
      emails.clear();
    },
  };
}
