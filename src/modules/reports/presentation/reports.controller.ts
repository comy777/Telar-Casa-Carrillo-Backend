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

export class MetricsResponse {
  @ApiProperty({ type: Object }) range!: { from: Date; to: Date };
  @ApiProperty({ type: Object, description: 'Pesos' }) sales!: Record<string, number>;
  @ApiProperty({ type: Object }) ordersByStatus!: Record<string, number>;
  @ApiProperty({ type: [Object] }) salesByDay!: { day: string; orders: number; revenue: number }[];
  @ApiProperty({ type: [Object] }) topProducts!: {
    productName: string;
    sku: string;
    quantity: number;
    revenue: number;
  }[];
  @ApiProperty({ type: Object }) operations!: Record<string, number>;
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
  async status() {
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
