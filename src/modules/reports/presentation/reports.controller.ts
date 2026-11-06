import { Controller, Get, Header, Inject, Param, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import type { Env } from '../../../shared/config/env.schema';
import { RequirePermissions } from '../../../shared/presentation/auth.decorators';
import { jobStatuses } from '../../../shared/presentation/scheduled-job';
import { centsToPesos } from '../../catalog/domain/money';
import { PERMISSIONS } from '../../identity/domain/permissions';
import {
  REPORTS_READER,
  type ReportsReader,
  ReportsService,
  toRange,
} from '../application/reports.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RangeQuery {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'Día de Colombia, incluido' })
  @IsOptional()
  @Matches(DATE, { message: 'from debe tener la forma AAAA-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'Día de Colombia, incluido' })
  @IsOptional()
  @Matches(DATE, { message: 'to debe tener la forma AAAA-MM-DD' })
  to?: string;
}

export class ExportQuery extends RangeQuery {
  @ApiPropertyOptional({ enum: [',', ';'], default: ',', description: '; para Excel en español' })
  @IsOptional()
  @IsIn([',', ';'])
  delimiter?: ',' | ';';
}

class MetricsRange {
  @ApiProperty({ type: String, format: 'date-time' }) from!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to!: Date;
}

/** Valores en pesos, IVA incluido. */
class SalesSummary {
  @ApiProperty() paidOrders!: number;
  @ApiProperty() revenue!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() shipping!: number;
  @ApiProperty() discount!: number;
  @ApiProperty() refunded!: number;
  @ApiProperty() netRevenue!: number;
  @ApiProperty() averageOrder!: number;
}

class SalesDay {
  @ApiProperty({ example: '2026-11-05' }) day!: string;
  @ApiProperty() orders!: number;
  @ApiProperty() revenue!: number;
}

class TopProduct {
  @ApiProperty() productName!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() revenue!: number;
}

class CustomersSummary {
  @ApiProperty() total!: number;
  @ApiProperty() newInRange!: number;
}

class LowStockItem {
  @ApiProperty() variantId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() available!: number;
  @ApiProperty() threshold!: number;
}

class OperationsSummary {
  @ApiProperty() awaitingFulfillment!: number;
  @ApiProperty() pendingInvoices!: number;
  @ApiProperty() paymentsNeedingReview!: number;
  @ApiProperty() unpaidOrders!: number;
  @ApiProperty() lowStockVariants!: number;
  @ApiProperty() outOfStockVariants!: number;
  @ApiProperty() newContactMessages!: number;
}

export class MetricsResponse {
  @ApiProperty({ type: MetricsRange }) range!: MetricsRange;
  @ApiProperty({ type: SalesSummary }) sales!: SalesSummary;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  ordersByStatus!: Record<string, number>;
  @ApiProperty({ type: [SalesDay] }) salesByDay!: SalesDay[];
  @ApiProperty({ type: [TopProduct] }) topProducts!: TopProduct[];
  @ApiProperty({ type: CustomersSummary }) customers!: CustomersSummary;
  @ApiProperty({ type: [LowStockItem] }) lowStock!: LowStockItem[];
  @ApiProperty({ type: OperationsSummary }) operations!: OperationsSummary;
}

class SystemSignalsResponse {
  @ApiProperty() failedWebhooks!: number;
  @ApiProperty() invalidSignatures24h!: number;
  @ApiProperty() stalePendingPayments!: number;
  @ApiProperty() overdueUnpaidOrders!: number;
  @ApiProperty() paymentsNeedingReview!: number;
}

class JobStatusResponse {
  @ApiProperty() name!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() running!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastRunAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastSuccessAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) lastErrorAt!: Date | null;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
  @ApiProperty() consecutiveFailures!: number;
}

class ServicesResponse {
  @ApiProperty({ description: 'Llave privada de Wompi configurada' }) payments!: boolean;
  @ApiProperty({ description: 'SMTP configurado (si no, los correos van al log)' }) email!: boolean;
  @ApiProperty({ enum: ['cloudinary', 'local'] }) imageStorage!: 'cloudinary' | 'local';
  @ApiProperty() alertRecipients!: number;
}

export class SystemStatusResponse {
  @ApiProperty() healthy!: boolean;
  @ApiProperty({ type: SystemSignalsResponse }) signals!: SystemSignalsResponse;
  @ApiProperty({ type: [JobStatusResponse] }) jobs!: JobStatusResponse[];
  @ApiProperty({ type: ServicesResponse }) services!: ServicesResponse;
  @ApiProperty() uptimeSeconds!: number;
}

const EXPORTS = ['orders', 'order-items', 'inventory'] as const;

@ApiTags('admin: reportes')
@ApiBearerAuth()
@Controller('admin')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    @Inject(REPORTS_READER) private readonly reader: ReportsReader,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('metrics')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({
    summary: 'Ventas, pedidos por estado, ventas por día, más vendidos y pendientes',
  })
  @ApiOkResponse({ type: MetricsResponse })
  async metrics(@Query() query: RangeQuery): Promise<MetricsResponse> {
    const metrics = await this.reports.metrics(toRange(query.from, query.to, this.clock.now()));
    const s = metrics.sales;
    return {
      range: metrics.range,
      sales: {
        paidOrders: s.paidOrders,
        revenue: centsToPesos(s.revenueCents),
        tax: centsToPesos(s.taxCents),
        shipping: centsToPesos(s.shippingCents),
        discount: centsToPesos(s.discountCents),
        refunded: centsToPesos(s.refundedCents),
        netRevenue: centsToPesos(s.netRevenueCents),
        averageOrder: centsToPesos(s.averageOrderCents),
      },
      ordersByStatus: metrics.ordersByStatus,
      salesByDay: metrics.salesByDay.map(({ revenueCents, ...day }) => ({
        ...day,
        revenue: centsToPesos(revenueCents),
      })),
      topProducts: metrics.topProducts.map(({ revenueCents, ...product }) => ({
        ...product,
        revenue: centsToPesos(revenueCents),
      })),
      customers: metrics.customers,
      lowStock: metrics.lowStock,
      operations: metrics.operations,
    };
  }

  @Get('reports/:kind.csv')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'kind', enum: EXPORTS })
  @ApiOperation({
    summary: 'Exporta pedidos, líneas (para contabilidad e IVA) o inventario en CSV',
    description: 'Fechas en hora de Colombia. Las celdas que parecen fórmulas se neutralizan.',
  })
  async export(
    @Param('kind') kind: string,
    @Query() query: ExportQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    if (!(EXPORTS as readonly string[]).includes(kind)) {
      response.status(404);
      return '';
    }
    const range = toRange(query.from, query.to, this.clock.now());
    const csv = await this.reports.export(
      kind as (typeof EXPORTS)[number],
      range,
      query.delimiter ?? ',',
    );
    const stamp = new Date(range.to.getTime() - 86_400_000).toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${kind}-${stamp}.csv"`);
    return csv;
  }

  @Get('system/status')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Estado operativo: procesos programados, notificaciones fallidas y servicios',
    description: '`healthy` es false si algo requiere atención (útil para un monitor externo).',
  })
  @ApiOkResponse({ type: SystemStatusResponse })
  async status(): Promise<SystemStatusResponse> {
    const signals = await this.reader.systemSignals(this.clock.now());
    const jobs = jobStatuses();
    const healthy =
      signals.failedWebhooks === 0 &&
      signals.overdueUnpaidOrders === 0 &&
      signals.stalePendingPayments === 0 &&
      jobs.every((job) => job.consecutiveFailures === 0);
    return {
      healthy,
      signals,
      jobs,
      services: {
        payments: Boolean(this.config.get('WOMPI_PRIVATE_KEY', { infer: true })),
        email: Boolean(this.config.get('SMTP_HOST', { infer: true })),
        imageStorage: this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true })
          ? 'cloudinary'
          : 'local',
        alertRecipients: this.config.get('ADMIN_ALERT_EMAILS', { infer: true }).length,
      },
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
