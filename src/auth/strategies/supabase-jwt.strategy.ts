import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as jwksRsa from 'jwks-rsa';
import * as jwt from 'jsonwebtoken';
import { User, UserDocument } from '../schemas/user.schema';

export interface SupabaseJwtPayload {
  sub: string;        // Supabase user UUID
  iss: string;
  email: string;
  role: string;       // Supabase role (authenticated, anon, etc.)
  aud: string;
  exp: number;
  iat: number;
}

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private jwksClient: jwksRsa.JwksClient;
  private supabaseUrl: string;

  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: async (request: any, rawJwtToken: string, done: Function) => {
        try {
          const decoded = jwt.decode(rawJwtToken, { complete: true }) as any;
          if (!decoded?.header?.kid) {
            return done(new UnauthorizedException('Missing kid in token header'));
          }
          const key = await new Promise<jwksRsa.SigningKey>((resolve, reject) => {
            this.jwksClient.getSigningKey(decoded.header.kid, (err, signingKey) => {
              if (err) reject(err);
              else resolve(signingKey!);
            });
          });
          const publicKey = key.getPublicKey();
          done(null, publicKey);
        } catch (err) {
          done(err);
        }
      },
      algorithms: ['ES256'],
      audience: 'authenticated',
    });

    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL')!;
    this.jwksClient = jwksRsa({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `${this.supabaseUrl}/auth/v1/.well-known/jwks.json`,
    });
  }

  async validate(payload: SupabaseJwtPayload): Promise<UserDocument> {
    // Validate issuer manually since we can't pass it to super() alongside secretOrKeyProvider
    const expectedIssuer = `${this.supabaseUrl}/auth/v1`;
    if (payload.iss !== expectedIssuer) {
      throw new UnauthorizedException('Invalid token issuer');
    }

    // Look up the user in MongoDB by their Supabase ID
    const user = await this.userModel.findOne({
      supabaseId: payload.sub,
      isActive: true,
    });

    if (!user) {
      throw new UnauthorizedException(
        'User not found or inactive. Please contact your administrator.',
      );
    }

    return user;
  }
}
