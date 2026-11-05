import { Body, Controller, Delete, Get, HttpCode, Inject, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { type AuthenticatedUser, CurrentUser } from '../../../shared/presentation/auth.decorators';
import { requestContextOf } from '../../../shared/presentation/request-context';
import { clearRefreshCookie, SECURE_COOKIES } from '../../identity/presentation/refresh-cookie';
import { type PersonalData, PrivacyService } from '../application/privacy.service';

export class DeleteAccountDto {
  @ApiProperty({ description: 'Contraseña actual, para confirmar' })
  @IsString()
  @MaxLength(128)
  password!: string;
}

@ApiTags('cuenta')
@ApiBearerAuth()
@Controller('account')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    @Inject(SECURE_COOKIES) private readonly secureCookies: boolean,
  ) {}

  @Get('data')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Descarga todos los datos personales de la cuenta (Ley 1581)' })
  @ApiOkResponse({ type: Object })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PersonalData> {
    response.setHeader('Content-Disposition', 'attachment; filename="mis-datos.json"');
    return this.privacy.export(user.id);
  }

  @Delete()
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: 'Elimina la cuenta (supresión de datos, Ley 1581)',
    description:
      'Borra direcciones, sesiones y carrito y anonimiza la cuenta. Los pedidos se conservan ' +
      'desligados de la cuenta porque son soporte contable. No se puede con pedidos en curso.',
  })
  @ApiNoContentResponse()
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DeleteAccountDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.privacy.deleteAccount(user.id, body.password, requestContextOf(request).ipAddress);
    clearRefreshCookie(response, this.secureCookies);
  }
}
