import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/application/clock';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/application/email-sender';
import type { User } from '../domain/user';
import { IDENTITY_SETTINGS, type IdentitySettings, STOREFRONT_PATHS } from './identity-settings';
import {
  SECURE_TOKENS,
  type SecureTokens,
  USER_TOKEN_REPOSITORY,
  type UserTokenPurpose,
  type UserTokenRepository,
} from './ports';

/** Emite tokens de un solo uso y envía los correos que los contienen. */
@Injectable()
export class AccountEmailsService {
  constructor(
    @Inject(USER_TOKEN_REPOSITORY) private readonly userTokens: UserTokenRepository,
    @Inject(SECURE_TOKENS) private readonly tokens: SecureTokens,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_SETTINGS) private readonly settings: IdentitySettings,
  ) {}

  async sendEmailVerification(user: User): Promise<void> {
    const link = await this.issueLink(
      user,
      'EMAIL_VERIFICATION',
      this.settings.emailVerificationTtlHours * 60,
      STOREFRONT_PATHS.verifyEmail,
    );
    await this.email.send({
      to: user.email.value,
      subject: 'Confirma tu correo en Telar Casa Carrillo',
      text: [
        `Hola ${user.firstName},`,
        '',
        'Gracias por registrarte. Para activar tu cuenta abre este enlace:',
        link,
        '',
        `El enlace vence en ${this.settings.emailVerificationTtlHours} horas.`,
        'Si no creaste esta cuenta, ignora este correo.',
      ].join('\n'),
    });
  }

  async sendPasswordReset(user: User): Promise<void> {
    const link = await this.issueLink(
      user,
      'PASSWORD_RESET',
      this.settings.passwordResetTtlMinutes,
      STOREFRONT_PATHS.resetPassword,
    );
    await this.email.send({
      to: user.email.value,
      subject: 'Restablece tu contraseña de Telar Casa Carrillo',
      text: [
        `Hola ${user.firstName},`,
        '',
        'Recibimos una solicitud para restablecer tu contraseña. Abre este enlace:',
        link,
        '',
        `El enlace vence en ${this.settings.passwordResetTtlMinutes} minutos y solo se puede usar una vez.`,
        'Si no lo pediste, ignora este correo: tu contraseña no cambia.',
      ].join('\n'),
    });
  }

  /** Invalida los enlaces anteriores del mismo tipo: solo el último sirve. */
  private async issueLink(
    user: User,
    purpose: UserTokenPurpose,
    ttlMinutes: number,
    path: string,
  ): Promise<string> {
    const now = this.clock.now();
    await this.userTokens.invalidateAll(user.id, purpose, now);
    const { token, hash } = this.tokens.generate();
    await this.userTokens.create({
      userId: user.id,
      purpose,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
    });
    const url = new URL(path, this.settings.storefrontUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
