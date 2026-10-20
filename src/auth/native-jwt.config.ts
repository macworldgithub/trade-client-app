import { ConfigService } from '@nestjs/config';

export function nativeJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('AUTH_JWT_SECRET');
  if (!secret || Buffer.byteLength(secret) < 32 || secret.includes('replace-with')) {
    throw new Error('AUTH_JWT_SECRET must be a private random secret of at least 32 bytes');
  }
  return secret;
}

export const AUTH_ISSUER = 'trade-client-api';
export const AUTH_AUDIENCE = 'trade-client';
