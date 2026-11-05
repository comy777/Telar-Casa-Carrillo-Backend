import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthenticationError } from '../../../shared/domain/errors';
import {
  type AuthenticatedUser,
  CurrentUser,
  Public,
} from '../../../shared/presentation/auth.decorators';
import { requestContextOf } from '../../../shared/presentation/request-context';
import { GetCurrentUser, Login } from '../application/authentication.use-cases';
import { RequestPasswordReset, ResetPassword } from '../application/password-reset.use-cases';
import {
  RegisterUser,
  ResendEmailVerification,
  VerifyEmail,
} from '../application/registration.use-cases';
import { SessionService } from '../application/session.service';
import {
  AccessTokenResponse,
  EmailDto,
  LoginDto,
  LoginResponse,
  MeResponse,
  RegisterDto,
  RegisterResponse,
  ResetPasswordDto,
  TokenDto,
} from './identity.dto';
import {
  clearRefreshCookie,
  readRefreshCookie,
  SECURE_COOKIES,
  setRefreshCookie,
} from './refresh-cookie';

/** Límite estricto para rutas que se pueden usar para adivinar contraseñas o enviar correos. */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUser,
    private readonly verifyEmail: VerifyEmail,
    private readonly resendVerification: ResendEmailVerification,
    private readonly login: Login,
    private readonly sessions: SessionService,
    private readonly requestReset: RequestPasswordReset,
    private readonly resetPassword: ResetPassword,
    private readonly currentUser: GetCurrentUser,
    @Inject(SECURE_COOKIES) private readonly secureCookies: boolean,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  @ApiOperation({ summary: 'Crea una cuenta y envía el correo de verificación' })
  @ApiCreatedResponse({ type: RegisterResponse })
  register(@Body() body: RegisterDto, @Req() request: Request): Promise<RegisterResponse> {
    return this.registerUser.execute(body, requestContextOf(request));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirma el correo con el token del enlace' })
  @ApiNoContentResponse()
  async confirmEmail(@Body() body: TokenDto, @Req() request: Request): Promise<void> {
    await this.verifyEmail.execute(body.token, requestContextOf(request));
  }

  @Public()
  @Throttle(STRICT)
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Reenvía el correo de verificación (no revela si el correo existe)' })
  @ApiAcceptedResponse()
  async resend(@Body() body: EmailDto): Promise<void> {
    await this.resendVerification.execute(body.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia sesión; el refresh token llega en una cookie HttpOnly' })
  @ApiOkResponse({ type: LoginResponse })
  async signIn(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const { session, user } = await this.login.execute(body, requestContextOf(request));
    setRefreshCookie(
      response,
      session.refreshToken,
      session.refreshTokenExpiresAt,
      this.secureCookies,
    );
    return { accessToken: session.accessToken, expiresIn: session.accessTokenExpiresIn, user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Entrega un access token nuevo y rota la cookie de sesión' })
  @ApiOkResponse({ type: AccessTokenResponse })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const token = readRefreshCookie(request);
    if (!token) {
      throw new AuthenticationError('No hay una sesión activa', 'MISSING_REFRESH_TOKEN');
    }
    try {
      const session = await this.sessions.rotate(token, requestContextOf(request));
      setRefreshCookie(
        response,
        session.refreshToken,
        session.refreshTokenExpiresAt,
        this.secureCookies,
      );
      return { accessToken: session.accessToken, expiresIn: session.accessTokenExpiresIn };
    } catch (error) {
      clearRefreshCookie(response, this.secureCookies);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cierra la sesión actual' })
  @ApiNoContentResponse()
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readRefreshCookie(request);
    if (token) await this.sessions.end(token);
    clearRefreshCookie(response, this.secureCookies);
  }

  @Public()
  @Throttle(STRICT)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Envía el enlace de recuperación (no revela si el correo existe)' })
  @ApiAcceptedResponse()
  async forgotPassword(@Body() body: EmailDto): Promise<void> {
    await this.requestReset.execute(body.email);
  }

  @Public()
  @Throttle(STRICT)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cambia la contraseña con el token del enlace y cierra todas las sesiones',
  })
  @ApiNoContentResponse()
  async reset(@Body() body: ResetPasswordDto, @Req() request: Request): Promise<void> {
    await this.resetPassword.execute(body, requestContextOf(request));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Datos, roles y permisos del usuario autenticado' })
  @ApiOkResponse({ type: MeResponse })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.currentUser.execute(user.id);
  }
}
