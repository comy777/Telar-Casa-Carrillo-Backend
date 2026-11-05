import { BusinessRuleViolation } from '../../../shared/domain/errors';
import { Email } from './email';
import { assertPasswordAllowed } from './password-policy';
import { User } from './user';

const NOW = new Date('2026-11-05T12:00:00Z');

const newUser = () =>
  User.register({
    email: Email.create('Ana@Example.com'),
    passwordHash: 'hash',
    firstName: '  Ana ',
    lastName: 'Pérez',
    privacyPolicyVersion: '2026-11',
    roles: ['customer', 'customer'],
    now: NOW,
  });

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof BusinessRuleViolation ? error.code : 'OTRO_ERROR';
  }
  return undefined;
};

describe('Email', () => {
  it('normaliza espacios y mayúsculas', () => {
    expect(Email.create('  Ana@Example.COM ').value).toBe('ana@example.com');
  });

  it.each(['', 'ana', 'ana@', '@example.com', 'ana @example.com', `${'a'.repeat(250)}@x.co`])(
    'rechaza "%s"',
    (raw) => {
      expect(codeOf(() => Email.create(raw))).toBe('INVALID_EMAIL');
    },
  );
});

describe('política de contraseñas', () => {
  it('acepta una frase larga sin símbolos', () => {
    expect(() => assertPasswordAllowed('telar de la abuela')).not.toThrow();
  });

  it.each([
    ['corta1234', 'PASSWORD_TOO_SHORT'],
    ['a'.repeat(129), 'PASSWORD_TOO_LONG'],
    ['aaaaaaaaaaaa', 'PASSWORD_TOO_WEAK'],
  ])('rechaza %s', (password, code) => {
    expect(codeOf(() => assertPasswordAllowed(password))).toBe(code);
  });
});

describe('User', () => {
  it('al registrarse queda pendiente de verificación y guarda el consentimiento', () => {
    const s = newUser().toSnapshot();
    expect(s).toMatchObject({
      status: 'PENDING_VERIFICATION',
      firstName: 'Ana',
      emailVerifiedAt: null,
      termsAcceptedAt: NOW,
      privacyPolicyAcceptedAt: NOW,
      privacyPolicyVersion: '2026-11',
      roles: ['customer'],
    });
  });

  it('exige nombre', () => {
    expect(
      codeOf(() =>
        User.register({
          email: Email.create('a@b.co'),
          passwordHash: 'h',
          firstName: '   ',
          lastName: 'X',
          privacyPolicyVersion: 'v',
          roles: ['customer'],
          now: NOW,
        }),
      ),
    ).toBe('NAME_REQUIRED');
  });

  it('verificar el correo la activa y es idempotente', () => {
    const user = newUser();
    user.verifyEmail(NOW);
    user.verifyEmail(new Date('2030-01-01'));
    expect(user.status).toBe('ACTIVE');
    expect(user.toSnapshot().emailVerifiedAt).toEqual(NOW);
  });

  it('una cuenta suspendida no se puede verificar', () => {
    const user = newUser();
    user.suspend();
    expect(codeOf(() => user.verifyEmail(NOW))).toBe('ACCOUNT_SUSPENDED');
  });

  it('al reactivar vuelve al estado que corresponde según la verificación', () => {
    const pending = newUser();
    pending.suspend();
    pending.reactivate();
    expect(pending.status).toBe('PENDING_VERIFICATION');

    const verified = newUser();
    verified.verifyEmail(NOW);
    verified.suspend();
    verified.reactivate();
    expect(verified.status).toBe('ACTIVE');
  });

  it('no permite suspender dos veces ni reactivar una cuenta activa', () => {
    const user = newUser();
    expect(codeOf(() => user.reactivate())).toBe('NOT_SUSPENDED');
    user.suspend();
    expect(codeOf(() => user.suspend())).toBe('ALREADY_SUSPENDED');
  });

  it('siempre tiene al menos un rol', () => {
    expect(codeOf(() => newUser().assignRoles([]))).toBe('ROLE_REQUIRED');
  });
});
