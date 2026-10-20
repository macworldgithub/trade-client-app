import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthCookiesService, ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE, requestCookie } from './auth-cookies.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private cookies: AuthCookiesService) {}

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    // Unauthenticated integration webhooks do not use browser sessions.
    const authRoute = /^\/(?:api\/v1\/)?auth(?:\/|$)/.test(req.path);
    if (!authRoute && !requestCookie(req, ACCESS_COOKIE) && !requestCookie(req, REFRESH_COOKIE)) return true;
    const origin = req.get('origin');
    const header = req.get('x-csrf-token');
    const cookie = requestCookie(req, CSRF_COOKIE);
    if ((origin && !this.cookies.allowedOrigin(origin)) || !header || header !== cookie || !this.cookies.validCsrf(cookie)) {
      throw new ForbiddenException({ message: 'Your security token expired. Please retry.', code: 'CSRF_INVALID' });
    }
    return true;
  }
}
