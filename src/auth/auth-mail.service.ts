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

  async sendOtp(to: string, code: string) {
    await this.deliver(to, 'Your Trade Client verification code',
      `Your verification code is: ${code}\n\nEnter this code in Trade Client to finish signing in. It expires in 10 minutes and can be used once. Do not share this code. If you did not request it, ignore this email.`);
  }

  async sendRecoveryOtp(to: string, code: string) {
    await this.deliver(to, 'Your Trade Client password recovery code',
      `Your password recovery code is: ${code}\n\nEnter this code on the account recovery screen, then choose a new password. It expires in 10 minutes and can be used once. Do not share this code. Authenticator two-factor authentication stays enabled. If you did not request this, ignore this email.`);
  }

  private async deliver(to: string, subject: string, text: string) {
    const { host, from, port, user, pass } = this.settings();
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: port !== 465,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    try {
      await transport.sendMail({
        from, to,
        subject, text,
      });
    } catch {
      throw new ServiceUnavailableException('Unable to send account email. Please try again later.');
    } finally { transport.close(); }
  }
}
