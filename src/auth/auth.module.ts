import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthMailService } from './auth-mail.service';
import { AuthMfaService } from './auth-mfa.service';
import { MfaChallenge, MfaChallengeSchema } from './schemas/mfa-challenge.schema';
import { AuthController } from './auth.controller';
import { NativeJwtStrategy } from './strategies/native-jwt.strategy';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthCookiesService } from './auth-cookies.service';
import { CsrfGuard } from './csrf.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRateLimit, AuthRateLimitSchema } from './schemas/auth-rate-limit.schema';
import { AUTH_ISSUER, AUTH_AUDIENCE, nativeJwtSecret } from './native-jwt.config';
import { User, UserSchema } from './schemas/user.schema';
import { AuditEvent, AuditEventSchema } from './schemas/audit-event.schema';
import { AuthSession, AuthSessionSchema } from './schemas/auth-session.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: nativeJwtSecret(config),
        signOptions: { algorithm: 'HS256', expiresIn: 900, issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE },
      }),
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
      { name: AuthSession.name, schema: AuthSessionSchema },
      { name: AuthRateLimit.name, schema: AuthRateLimitSchema },
      { name: MfaChallenge.name, schema: MfaChallengeSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthMailService, AuthMfaService, NativeJwtStrategy, AuthCookiesService, AuthRateLimitGuard,
    { provide: APP_GUARD, useClass: CsrfGuard }],
  exports: [AuthService, MongooseModule], // Export so other modules can use User model and writeAudit
})
export class AuthModule {}
