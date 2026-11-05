export interface IdentitySettings {
  storefrontUrl: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  emailVerificationTtlHours: number;
  passwordResetTtlMinutes: number;
  privacyPolicyVersion: string;
}

export const IDENTITY_SETTINGS = Symbol('IdentitySettings');

/**
 * Rutas del storefront que reciben los enlaces de los correos. El frontend
 * lee `token` de la URL y lo envía a la API.
 */
export const STOREFRONT_PATHS = {
  verifyEmail: '/cuenta/verificar-correo',
  resetPassword: '/cuenta/restablecer-contrasena',
} as const;
