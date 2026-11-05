import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
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

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AdminAuditController {
  constructor(@Inject(AUDIT_LOG_READER) private readonly reader: AuditLogReader) {}

  @Get()
  @ApiOperation({ summary: 'Registro de auditoría, más reciente primero' })
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  list(@Query() query: AuditLogQueryDto): Promise<Page<AuditLogView>> {
    return this.reader.list(query);
  }
}
