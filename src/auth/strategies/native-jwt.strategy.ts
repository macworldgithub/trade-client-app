import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ACCESS_COOKIE, requestCookie } from '../auth-cookies.service';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { AuthSession, AuthSessionDocument } from '../schemas/auth-session.schema';
import { AUTH_ISSUER, AUTH_AUDIENCE, nativeJwtSecret } from '../native-jwt.config';

@Injectable()
export class NativeJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private users: Model<UserDocument>,
    @InjectModel(AuthSession.name) private sessions: Model<AuthSessionDocument>,
  ) {
    super({
      jwtFromRequest: req => requestCookie(req, ACCESS_COOKIE),
      secretOrKey: nativeJwtSecret(config), algorithms: ['HS256'],
      issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE, ignoreExpiration: false,
    });
  }

  async validate(payload: { sub: string; sid: string }) {
    if (!isValidObjectId(payload.sub) || !isValidObjectId(payload.sid)) {
      throw new UnauthorizedException('Invalid session');
    }
    const session = await this.sessions.findOne({
      _id: payload.sid, userId: payload.sub, revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    const user = session && await this.users.findOne({ _id: payload.sub, isActive: true });
    if (!user || !user.emailVerifiedAt || (session.passwordVersion ?? 0) !== (user.passwordChangedAt?.getTime() ?? 0)
      || (session.mfaVersion ?? 0) !== (user.mfaVersion ?? 0)) {
      throw new UnauthorizedException('Session expired or account inactive');
    }
    return user;
  }
}
