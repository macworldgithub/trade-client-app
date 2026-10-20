import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { authAllowedOrigins } from './auth/auth-origins';

// Shared by the listening development server and the Vercel function.
export function configureHttp(app: INestApplication, env: NodeJS.ProcessEnv = process.env) {
  const proxies = (env.TRUSTED_PROXY_CIDRS || 'loopback').split(',')
    .map(value => value.trim()).filter(Boolean);
  app.getHttpAdapter().getInstance().set('trust proxy', proxies);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.setGlobalPrefix('api/v1', { exclude: ['/', 'health'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({
    origin: authAllowedOrigins(env), credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-CSRF-Token', 'X-Requested-With'],
  });
}
