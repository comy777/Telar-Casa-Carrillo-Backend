import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Page } from '../../../shared/application/audit-trail';
import { RequirePermissions } from '../../../shared/presentation/auth.decorators';
import { PaginationQuery } from '../../../shared/presentation/pagination.dto';
import { PERMISSIONS } from '../../identity/domain/permissions';
import {
  AUDIT_LOG_READER,
  type AuditLogReader,
  type AuditLogView,
} from '../application/audit-log-reader';

class AuditLogQueryDto extends PaginationQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'User' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  resource?: string;

  @ApiPropertyOptional({ example: 'user.suspended' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;
}

export class AuditLogResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) actorId!: string | null;
  @ApiProperty({ nullable: true, type: String }) actorEmail!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() resource!: string;
  @ApiProperty({ nullable: true, type: String }) resourceId!: string | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true }) metadata!: unknown;
  @ApiProperty({ nullable: true, type: String }) ipAddress!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class AuditLogPage {
  @ApiProperty({ type: [AuditLogResponse] }) items!: AuditLogResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(@Inject(AUDIT_LOG_READER) private readonly reader: AuditLogReader) {}

  @Get()
  @ApiOperation({ summary: 'Registro de auditoría, más reciente primero' })
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOkResponse({ type: AuditLogPage })
  list(@Query() query: AuditLogQueryDto): Promise<Page<AuditLogView>> {
    return this.reader.list(query);
  }
}
