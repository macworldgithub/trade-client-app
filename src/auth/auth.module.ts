import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';
import { User, UserSchema } from './schemas/user.schema';
import { AuditEvent, AuditEventSchema } from './schemas/audit-event.schema';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // JWT verification handled by JWKS in the strategy
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, SupabaseJwtStrategy],
  exports: [AuthService, MongooseModule], // Export so other modules can use User model and writeAudit
})
export class AuthModule {}
