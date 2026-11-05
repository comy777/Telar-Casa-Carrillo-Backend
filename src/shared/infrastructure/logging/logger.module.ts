import { randomUUID } from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

/** Rutas que nunca deben aparecer en los logs. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
];

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDevelopment = config.get('NODE_ENV', { infer: true }) === 'development';
        return {
          // Sintaxis de rutas de NestJS 11 / path-to-regexp 8 (el valor por defecto "*" genera una advertencia).
          forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            // Reutiliza el x-request-id del cliente/proxy si es válido; si no, genera uno.
            genReqId: (req, res) => {
              const header = req.headers['x-request-id'];
              const id =
                typeof header === 'string' && REQUEST_ID_PATTERN.test(header)
                  ? header
                  : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
            autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
            transport: isDevelopment
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
