import { CanActivate, ExecutionContext, HttpException, Injectable, ServiceUnavailableException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request, Response } from 'express';
import { createHmac } from 'crypto';
import { isIP } from 'net';
import { AuthRateLimit, AuthRateLimitDocument } from './schemas/auth-rate-limit.schema';
import { nativeJwtSecret } from './native-jwt.config';

const RATE_POLICY_KEY = 'auth-rate-policy';
const MINUTE = 60000;

export const AUTH_RATE_POLICIES = {
  login: { windowMs: 15 * MINUTE, ip: 300, email: 10 },
  register: { windowMs: 60 * MINUTE, ip: 100, email: 3 },
  'forgot-password': { windowMs: 60 * MINUTE, ip: 100, email: 5 },
  'resend-verification': { windowMs: 60 * MINUTE, ip: 100, email: 5 },
  'verify-email': { windowMs: 15 * MINUTE, ip: 100 },
  'reset-password': { windowMs: 15 * MINUTE, ip: 100 },
  refresh: { windowMs: 15 * MINUTE, ip: 1000 },
  'totp-verify': { windowMs: 15 * MINUTE, ip: 100 },
  'totp-enroll': { windowMs: 60 * MINUTE, ip: 100 },
  'totp-confirm': { windowMs: 15 * MINUTE, ip: 100 },
  'totp-disable': { windowMs: 15 * MINUTE, ip: 30 },
  'admin-create': { windowMs: 60 * MINUTE, ip: 100 },
} as const;

export type AuthRatePolicy = keyof typeof AUTH_RATE_POLICIES;
export const LimitAuth = (policy: AuthRatePolicy) => SetMetadata(RATE_POLICY_KEY, policy);

export function rateLimitNetwork(raw: string | undefined): string {
  const ip = (raw || '').split('%')[0];
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return 'unknown';
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const start = left ? left.split(':') : [];
  const end = right ? right.split(':') : [];
  const parts = right === undefined ? start : [...start, ...Array(8 - start.length - end.length).fill('0'), ...end];
  const words = parts.map(part => parseInt(part, 16));
  // IPv4-mapped addresses must share a bucket with their IPv4 representation.
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
  }
  // Group IPv6 privacy addresses within the same /64 network.
  return `${words.slice(0, 4).map(word => word.toString(16)).join(':')}::/64`;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private config: ConfigService,
    @InjectModel(AuthRateLimit.name) private counters: Model<AuthRateLimitDocument>,
  ) {}

  private async consume(policy: string, identity: string, limit: number, windowMs: number, res: Response) {
    const now = Date.now();
    const start = Math.floor(now / windowMs) * windowMs;
    const expiresAt = new Date(start + windowMs);
    const id = createHmac('sha256', nativeJwtSecret(this.config))
      .update(JSON.stringify(['auth-rate-limit', policy, identity, start])).digest('hex');
    let counter: AuthRateLimitDocument | null;
    try {
      try {
        counter = await this.counters.findOneAndUpdate(
          { _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, new: true },
        );
      } catch (error) {
        if (error?.code !== 11000) throw error;
        // Another worker inserted this window concurrently.
        counter = await this.counters.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true });
      }
      if (!counter) throw new Error('Rate counter unavailable');
    } catch {
      throw new ServiceUnavailableException('Sign-in protection is temporarily unavailable. Please try again later.');
    }
    if (counter.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('Cache-Control', 'no-store');
      throw new HttpException({
        statusCode: 429, code: 'AUTH_RATE_LIMITED', retryAfterSeconds,
        message: `Too many attempts. Please try again in ${retryAfterSeconds} seconds.`,
      }, 429);
    }
  }

  async canActivate(context: ExecutionContext) {
    const name = this.reflector.get<AuthRatePolicy>(RATE_POLICY_KEY, context.getHandler());
    if (!name) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const policy = AUTH_RATE_POLICIES[name];
    // Express resolves req.ip using only explicitly trusted proxy addresses.
    await this.consume(`${name}:ip`, rateLimitNetwork(req.ip || req.socket?.remoteAddress), policy.ip, policy.windowMs, res);
    if ('email' in policy && typeof req.body?.email === 'string') {
      const email = req.body.email.trim().toLowerCase();
      if (email.length > 0 && email.length <= 320) {
        await this.consume(`${name}:email`, email, policy.email, policy.windowMs, res);
      }
    }
    return true;
  }
}
