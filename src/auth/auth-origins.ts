export const PRODUCTION_FRONTEND_ORIGIN = 'https://trade-client-frontend.vercel.app';

type AuthEnvironment = {
  NODE_ENV?: string;
  VERCEL?: string;
  AUTH_FRONTEND_URL?: string;
  CORS_ORIGIN?: string;
};

export function productionAuth(env: AuthEnvironment): boolean {
  return env.NODE_ENV === 'production' || (env.VERCEL === '1' && env.NODE_ENV !== 'development');
}

function origin(value: string, production: boolean): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    (production && url.protocol !== 'https:')) {
    throw new Error('Authentication origins must use HTTPS in production');
  }
  return url.origin;
}

export function authFrontendOrigin(env: AuthEnvironment): string {
  return origin(env.AUTH_FRONTEND_URL || (productionAuth(env) ? PRODUCTION_FRONTEND_ORIGIN : 'http://localhost:3000'), productionAuth(env));
}

export function authAllowedOrigins(env: AuthEnvironment): string[] {
  const configured = (env.CORS_ORIGIN || '').split(',').map(value => value.trim())
    .filter(value => value && value !== '*');
  return [...new Set([authFrontendOrigin(env), ...configured.map(value => origin(value, productionAuth(env)))])];
}
