import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { Env } from './shared/config/env.schema';
import { ProblemDetailsFilter } from './shared/presentation/problem-details.filter';

const BODY_LIMIT = '1mb';

/**
 * Configuración HTTP compartida por main.ts y las pruebas e2e,
 * para que las pruebas usen exactamente los mismos pipes, filtros y prefijos.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

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
