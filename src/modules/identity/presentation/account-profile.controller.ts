import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { type AuthenticatedUser, CurrentUser } from '../../../shared/presentation/auth.decorators';
import { requestContextOf } from '../../../shared/presentation/request-context';
import { AccountProfile, ChangePassword } from '../application/profile.use-cases';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../domain/password-policy';
import { AccessTokenResponse } from './identity.dto';
import { SECURE_COOKIES, setRefreshCookie } from './refresh-cookie';

export class ProfileResponse {
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
}

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(PASSWORD_MAX_LENGTH) currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

@ApiTags('cuenta')
@ApiBearerAuth()
@Controller()
export class AccountProfileController {
  constructor(
    private readonly profile: AccountProfile,
    private readonly changePassword: ChangePassword,
    @Inject(SECURE_COOKIES) private readonly secureCookies: boolean,
  ) {}

  @Get('account/profile')
  @ApiOkResponse({ type: ProfileResponse })
  get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponse> {
    return this.profile.get(user.id);
  }

  @Patch('account/profile')
  @ApiOperation({ summary: 'Actualiza nombre, apellido y teléfono' })
  @ApiOkResponse({ type: ProfileResponse })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
    @Req() request: Request,
  ): Promise<ProfileResponse> {
    const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    return this.profile.update(user.id, changes, requestContextOf(request));
  }

  /** Bajo /auth para que la cookie de sesión (path /api/v1/auth) se pueda reemplazar. */
  @Post('auth/change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cambia la contraseña, cierra las demás sesiones y abre una nueva' })
  @ApiOkResponse({ type: AccessTokenResponse })
  async change(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const session = await this.changePassword.execute(user.id, body, requestContextOf(request));
    setRefreshCookie(
      response,
      session.refreshToken,
      session.refreshTokenExpiresAt,
      this.secureCookies,
    );
    return { accessToken: session.accessToken, expiresIn: session.accessTokenExpiresIn };
  }
}
