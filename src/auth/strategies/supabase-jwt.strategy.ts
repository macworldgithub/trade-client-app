import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { passportJwtSecret } from 'jwks-rsa';
import { User, UserDocument } from '../schemas/user.schema';

export interface SupabaseJwtPayload {
  sub: string;        // Supabase user UUID
  email: string;
  role: string;       // Supabase role (authenticated, anon, etc.)
  aud: string;
  exp: number;
  iat: number;
}

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    const supabaseUrl = configService.get<string>('SUPABASE_URL')!;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Use JWKS to fetch the public key from Supabase — works with ECC P-256 keys
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      }),
      audience: 'authenticated',
      issuer: `${supabaseUrl}/auth/v1`,
      algorithms: ['ES256', 'RS256', 'HS256'],
    });
  }

  async validate(payload: SupabaseJwtPayload): Promise<UserDocument> {
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
