import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';

/**
 * Etiquetas de caché que usa el storefront (Next.js) en sus lecturas públicas.
 * Deben coincidir con las de apps/storefront/src/lib/{catalog,content}.ts y con
 * las que acepta su ruta POST /api/revalidate.
 */
export type StorefrontCacheTag = 'catalog' | 'content' | 'navigation';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Qué parte de la tienda cambia cuando el panel modifica cada recurso. */
const RULES: Array<[RegExp, StorefrontCacheTag[]]> = [
  [/^\/api\/v\d+\/admin\/(products|categories|artisans|inventory)(\/|$)/, ['catalog']],
  [/^\/api\/v\d+\/admin\/content\/navigation(\/|$)/, ['navigation', 'content']],
  [/^\/api\/v\d+\/admin\/content\/(banners|testimonials|faqs|pages|settings)(\/|$)/, ['content']],
];

/** Etiquetas a revalidar para una petición; vacío si no afecta a la tienda. */
export function storefrontTagsFor(method: string, path: string): StorefrontCacheTag[] {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return [];
  return RULES.find(([pattern]) => pattern.test(path))?.[1] ?? [];
}

export interface StorefrontRevalidationSettings {
  /** URL completa de la ruta de revalidación del storefront. */
  url: string;
  /** Secreto compartido; sin él no se avisa a la tienda (se queda con su ISR). */
  secret: string | undefined;
}

const DEBOUNCE_MS = 500;
const TIMEOUT_MS = 3_000;

/**
 * Avisa al storefront para que descarte su caché cuando el panel publica cambios.
 * Agrupa los cambios seguidos (p. ej. subir varias imágenes) en un solo aviso.
 * Nunca falla la petición del panel: si la tienda no responde, solo se registra y
 * la página se actualiza igual al vencer su ISR.
 * Se crea con una fábrica en PlatformModule (recibe la configuración ya resuelta).
 */
export class StorefrontRevalidator implements OnModuleDestroy {
  private readonly logger = new Logger(StorefrontRevalidator.name);
  private readonly pending = new Set<StorefrontCacheTag>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly settings: StorefrontRevalidationSettings,
    private readonly http: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return Boolean(this.settings.secret);
  }

  schedule(tags: readonly StorefrontCacheTag[]): void {
    if (!this.enabled || tags.length === 0) return;
    for (const tag of tags) this.pending.add(tag);
    this.timer ??= setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Envía ya las etiquetas pendientes. Público para las pruebas. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const tags = [...this.pending];
    this.pending.clear();
    try {
      const res = await this.http(this.settings.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.settings.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status, tags }, 'La tienda rechazó la revalidación');
      }
    } catch (error) {
      this.logger.warn({ err: error, tags }, 'No se pudo avisar a la tienda para revalidar');
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Tras cada cambio exitoso del panel que afecta a la tienda, programa la revalidación. */
@Injectable()
export class StorefrontRevalidationInterceptor implements NestInterceptor {
  constructor(private readonly revalidator: StorefrontRevalidator) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !this.revalidator.enabled) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const tags = storefrontTagsFor(req.method, req.path);
    if (tags.length === 0) return next.handle();
    // `tap` solo corre si el controlador respondió sin error.
    return next.handle().pipe(tap(() => this.revalidator.schedule(tags)));
  }
}
