import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { authFrontendOrigin } from './auth-origins';

@Injectable()
export class AuthMailService {
  constructor(private config: ConfigService) {}

  private settings() {
    const host = this.config.get<string>('SMTP_HOST');
    const from = this.config.get<string>('AUTH_EMAIL_FROM');
    if (!host || !from) {
      throw new ServiceUnavailableException('Account email delivery is not configured');
    }
    const url = new URL(authFrontendOrigin({ NODE_ENV: this.config.get('NODE_ENV'), VERCEL: this.config.get('VERCEL'),
      AUTH_FRONTEND_URL: this.config.get('AUTH_FRONTEND_URL') }));
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      throw new ServiceUnavailableException('Account email URL must use HTTPS');
    }
    const port = Number(this.config.get<string>('SMTP_PORT') || 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD') || this.config.get<string>('SMTP_PASS');
    return { host, from, url, port, user, pass };
  }

  assertConfigured() { this.settings(); }

  async send(to: string, token: string, purpose: 'verify-email' | 'reset-password') {
    const { host, from, url, port, user, pass } = this.settings();
    url.pathname = `/auth/${purpose}`;
    url.search = '';
    // Fragments stay out of HTTP requests, server logs, and referrer headers.
    url.hash = new URLSearchParams({ token }).toString();
    const verification = purpose === 'verify-email';
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: port !== 465,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    try {
      await transport.sendMail({
        from, to,
        subject: verification ? 'Verify your Trade Client account' : 'Set up or recover your Trade Client account',
        text: `${verification ? 'Verify your email address' : 'Choose a password and verify your email address'} using this link:\n\n${url.toString()}\n\n${verification ? '' : 'Completing this link saves your password, verifies your email, and signs out existing sessions. It does not disable two-factor authentication.\n\n'}This link expires in ${verification ? '24 hours' : '30 minutes'} and can be used once. If you did not request this, ignore this email.`,
      });
    } catch {
      throw new ServiceUnavailableException('Unable to send account email. Please try again later.');
    } finally { transport.close(); }
  }
}
