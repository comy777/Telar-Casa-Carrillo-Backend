import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Env } from './shared/config/env.schema';
import { LOCAL_MEDIA_ROUTE } from './shared/infrastructure/storage/local-image-storage';
import { ProblemDetailsFilter } from './shared/presentation/problem-details.filter';

const BODY_LIMIT = '1mb';

/**
 * Configuración HTTP compartida por main.ts y las pruebas e2e,
 * para que las pruebas usen exactamente los mismos pipes, filtros y prefijos.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  const proxies = config.get('TRUST_PROXY', { infer: true });
  if (proxies > 0) app.set('trust proxy', proxies);
  app.use(helmet());
  // Por defecto ninguna respuesta se guarda en cachés (datos personales, carrito,
  // pedidos). Las rutas públicas del catálogo lo cambian con @Header('Cache-Control').
  app.use((_req: unknown, res: ServerResponse, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cookieParser());
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

  // Imágenes en disco (desarrollo, sin Cloudinary). Helmet marca todo como
  // same-origin; las imágenes se permiten desde otros orígenes (la tienda).
  if (!config.get('CLOUDINARY_CLOUD_NAME', { infer: true })) {
    app.useStaticAssets(resolve(config.get('MEDIA_LOCAL_DIR', { infer: true })), {
      prefix: `${LOCAL_MEDIA_ROUTE}/`,
      index: false,
      dotfiles: 'deny',
      maxAge: '7d',
      setHeaders: (res: ServerResponse) =>
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    });
  }

  // Rutas: /api/v1/... (salud: /api/health)
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Telar Casa Carrillo API')
        .setDescription('API de la tienda en línea')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    // Interfaz en /api/docs y especificación en /api/docs-json
    SwaggerModule.setup('api/docs', app, document);
  }
}
