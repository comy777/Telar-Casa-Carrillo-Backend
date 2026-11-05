import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import type { AccessTokens, PasswordHasher, SecureTokens } from '../application/ports';

/**
 * Argon2id con los parámetros mínimos recomendados por OWASP
 * (19 MiB de memoria, 2 iteraciones, 1 hilo).
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    const target = passwordHash ?? (await this.getDummyHash());
    try {
      const matches = await verify(target, password);
      return passwordHash !== null && matches;
    } catch {
      return false;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hash(randomBytes(16).toString('hex'), ARGON2_OPTIONS);
    return this.dummyHash;
  }
}

/** 32 bytes aleatorios en base64url; en la base se guarda su SHA-256. */
@Injectable()
export class CryptoSecureTokens implements SecureTokens {
  generate(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

export const JWT_ISSUER = 'telar-casa-carrillo-api';
export const JWT_AUDIENCE = 'telar-casa-carrillo';

@Injectable()
export class JwtAccessTokens implements AccessTokens {
  constructor(private readonly jwt: JwtService) {}

  issue(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }

  async verify(token: string): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
