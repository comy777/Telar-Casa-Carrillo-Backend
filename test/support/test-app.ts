import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import type { EmailMessage, EmailSender } from '../../src/shared/application/email-sender';
import { EMAIL_SENDER } from '../../src/shared/application/email-sender';
import {
  IMAGE_STORAGE,
  type ImageStorage,
  type ImageUpload,
  type StoredImage,
} from '../../src/shared/application/image-storage';
import { PAYMENT_GATEWAY } from '../../src/modules/payments/application/ports';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { FakeWompi } from './fake-wompi';

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

/** Almacenamiento de imágenes en memoria: permite comprobar subidas y borrados. */
export class InMemoryImageStorage implements ImageStorage {
  readonly files = new Map<string, ImageUpload>();
  failNextUpload = false;

  upload(image: ImageUpload): Promise<StoredImage> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      return Promise.reject(new Error('Fallo simulado del almacenamiento'));
    }
    const key = `${image.folder}/${crypto.randomUUID()}`;
    this.files.set(key, image);
    return Promise.resolve({ url: `https://cdn.test/${key}`, key });
  }

  delete(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }

  clear(): void {
    this.files.clear();
    this.failNextUpload = false;
  }
}

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaClient;
  emails: InMemoryEmailSender;
  images: InMemoryImageStorage;
  /** API de Wompi en memoria (el adaptador y las firmas son los reales). */
  wompi: FakeWompi;
  /** Borra todos los datos (conserva roles y permisos). */
  reset(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const emails = new InMemoryEmailSender();
  const images = new InMemoryImageStorage();
  const wompi = new FakeWompi();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_SENDER)
    .useValue(emails)
    .overrideProvider(IMAGE_STORAGE)
    .useValue(images)
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(wompi.gateway)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    emails,
    images,
    wompi,
    reset: async () => {
      await prisma.$executeRawUnsafe(
        `TRUNCATE "WebhookEvent", "PaymentTransaction", "Refund", "Payment",
          "AuditLog", "RefreshToken", "UserToken", "UserRole", "User",
          "CouponRedemption", "OrderStatusHistory", "OrderItem", "Order", "Coupon",
          "ShippingMethod", "Address",
          "StockReservation", "CartItem", "Cart", "InventoryMovement", "Inventory",
          "ProductImage", "ProductVariant", "ProductCategory", "ProductMaterial", "Product",
          "ProductTechnique", "Technique", "Material", "Category", "Artisan",
          "Banner", "Page", "Testimonial", "Faq", "NewsletterSubscriber", "ContactMessage",
          "StoreSetting" CASCADE`,
      );
      emails.clear();
      images.clear();
      wompi.clear();
    },
  };
}
