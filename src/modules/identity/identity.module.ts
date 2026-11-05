import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../shared/config/env.schema';
import { AccountEmailsService } from './application/account-emails.service';
import { GetCurrentUser, Login } from './application/authentication.use-cases';
import { IDENTITY_SETTINGS, type IdentitySettings } from './application/identity-settings';
import { RequestPasswordReset, ResetPassword } from './application/password-reset.use-cases';
import {
  ACCESS_TOKENS,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  ROLE_REPOSITORY,
  SECURE_TOKENS,
  USER_REPOSITORY,
  USER_TOKEN_REPOSITORY,
} from './application/ports';
import {
  RegisterUser,
  ResendEmailVerification,
  VerifyEmail,
} from './application/registration.use-cases';
import { SessionService } from './application/session.service';
import {
  AssignUserRoles,
  ChangeUserStatus,
  GetUser,
  ListRoles,
  ListUsers,
} from './application/user-administration.use-cases';
import {
  Argon2PasswordHasher,
  CryptoSecureTokens,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JwtAccessTokens,
} from './infrastructure/crypto.adapters';
import {
  PrismaRefreshTokenRepository,
  PrismaRoleRepository,
  PrismaUserTokenRepository,
} from './infrastructure/prisma-token.repositories';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { AdminRolesController, AdminUsersController } from './presentation/admin-users.controller';
import { AuthController } from './presentation/auth.controller';
import { AuthGuard } from './presentation/auth.guard';
import { SECURE_COOKIES } from './presentation/refresh-cookie';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController, AdminRolesController],
  providers: [
    {
      provide: IDENTITY_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): IdentitySettings => ({
        storefrontUrl: config.get('STOREFRONT_URL', { infer: true }),
        accessTokenTtlSeconds: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        refreshTokenTtlDays: config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }),
        emailVerificationTtlHours: config.get('EMAIL_VERIFICATION_TTL_HOURS', { infer: true }),
        passwordResetTtlMinutes: config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true }),
        privacyPolicyVersion: config.get('PRIVACY_POLICY_VERSION', { infer: true }),
      }),
    },
    {
      provide: SECURE_COOKIES,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('NODE_ENV', { infer: true }) === 'production',
    },

    // Adaptadores
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: ROLE_REPOSITORY, useClass: PrismaRoleRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PrismaRefreshTokenRepository },
    { provide: USER_TOKEN_REPOSITORY, useClass: PrismaUserTokenRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: SECURE_TOKENS, useClass: CryptoSecureTokens },
    { provide: ACCESS_TOKENS, useClass: JwtAccessTokens },

    // Casos de uso y servicios
    AccountEmailsService,
    SessionService,
    RegisterUser,
    VerifyEmail,
    ResendEmailVerification,
    Login,
    GetCurrentUser,
    RequestPasswordReset,
    ResetPassword,
    ListUsers,
    GetUser,
    ChangeUserStatus,
    AssignUserRoles,
    ListRoles,

    // Toda la API exige autenticación salvo las rutas @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  // Para el módulo de privacidad (confirmar la contraseña antes de borrar la cuenta).
  exports: [PASSWORD_HASHER, USER_REPOSITORY, SECURE_COOKIES],
})
export class IdentityModule {}
