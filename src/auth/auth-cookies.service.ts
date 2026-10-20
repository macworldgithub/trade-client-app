import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, CookieOptions } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { nativeJwtSecret } from './native-jwt.config';
import { authAllowedOrigins, productionAuth } from './auth-origins';

export const ACCESS_COOKIE = 'trade_access';
export const REFRESH_COOKIE = 'trade_refresh';
export const CSRF_COOKIE = 'trade_csrf';

export function requestCookie(req: Request, name: string): string | null {
  const matches = (req.headers.cookie || '').split(';').map(s => s.trim())
    .filter(s => s.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  return matches[0].slice(name.length + 1);
}

@Injectable()
export class AuthCookiesService {
  constructor(private config: ConfigService) {}

  private options(maxAge?: number): CookieOptions {
    return { httpOnly: true, secure: productionAuth({ NODE_ENV: this.config.get('NODE_ENV'), VERCEL: this.config.get('VERCEL') }),
      sameSite: 'lax', path: '/', ...(maxAge === undefined ? {} : { maxAge }) };
  }

  setSession(res: Response, session: { accessToken: string; refreshToken: string }) {
    res.cookie(ACCESS_COOKIE, session.accessToken, this.options(900000));
    res.cookie(REFRESH_COOKIE, session.refreshToken, this.options(30 * 86400000));
    res.setHeader('Cache-Control', 'no-store');
  }

  clearSession(res: Response) {
    res.clearCookie(ACCESS_COOKIE, this.options());
    res.clearCookie(REFRESH_COOKIE, this.options());
    res.setHeader('Cache-Control', 'no-store');
  }

  private signature(value: string) {
    return createHmac('sha256', nativeJwtSecret(this.config)).update(`csrf:${value}`).digest('base64url');
  }

  validCsrf(token: string | null): boolean {
    if (!token || !/^\d{13}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const [time, nonce, signature] = token.split('.');
    const age = Date.now() - Number(time);
    if (age < 0 || age > 3600000) return false;
    const expected = this.signature(`${time}.${nonce}`);
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  csrf(req: Request, res: Response) {
    let token = requestCookie(req, CSRF_COOKIE);
    if (!this.validCsrf(token)) {
      const value = `${Date.now()}.${randomBytes(32).toString('base64url')}`;
      token = `${value}.${this.signature(value)}`;
      res.cookie(CSRF_COOKIE, token, this.options(3600000));
    }
    res.setHeader('Cache-Control', 'no-store');
    return { csrfToken: token };
  }

  allowedOrigin(origin: string): boolean {
    return authAllowedOrigins({ NODE_ENV: this.config.get('NODE_ENV'), VERCEL: this.config.get('VERCEL'),
      AUTH_FRONTEND_URL: this.config.get('AUTH_FRONTEND_URL'), CORS_ORIGIN: this.config.get('CORS_ORIGIN'),
    }).includes(origin);
  }
}
