import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
import { User, UserDocument } from './schemas/user.schema';
import { AuditEvent, AuditEventDocument, AuditAction } from './schemas/audit-event.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { Role } from '../common/enums/roles.enum';

@Injectable()
export class AuthService {
  private supabase: SupabaseClient;

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AuditEvent.name) private auditModel: Model<AuditEventDocument>,
    private configService: ConfigService,
  ) {
    this.supabase = createClient(
      this.configService.get<string>('SUPABASE_URL')!,
      this.configService.get<string>('SUPABASE_SECRET_KEY')!,
    );
  }

  // ─── REGISTER ────────────────────────────────────────────────────────────────
  async register(dto: RegisterDto, ipAddress?: string) {
    // 1. Create Supabase user
    const { data, error } = await this.supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      if (error.message.includes('already registered')) {
        throw new ConflictException('Email is already registered');
      }
      throw new InternalServerErrorException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException('Failed to create user in Supabase');
    }

    // 2. Check for duplicate in MongoDB
    const existing = await this.userModel.findOne({ email: dto.email });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    // 3. Save user in MongoDB with Supabase ID mapping
    const user = await this.userModel.create({
      supabaseId: data.user.id,
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role ?? Role.TRADE_PARTNER,
      tradeAccountId: dto.tradeAccountId ?? null,
      rooftopId: dto.rooftopId ?? null,
    });

    // 4. Audit event
    await this.writeAudit(AuditAction.LOGIN, data.user.id, null, null, {
      action: 'REGISTER',
      email: dto.email,
    }, ipAddress);

    return {
      message: 'Registration successful. Please check your email to confirm your account.',
      userId: user._id,
    };
  }

  // ─── LOGIN ───────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ipAddress?: string) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      // Audit failed login
      await this.writeAudit(AuditAction.LOGIN_FAILED, 'anonymous', null, null, {
        email: dto.email,
        reason: error.message,
      }, ipAddress);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Look up MongoDB user
    const user = await this.userModel.findOne({ supabaseId: data.user.id });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    // Audit successful login
    await this.writeAudit(
      AuditAction.LOGIN,
      data.user.id,
      user.tradeAccountId,
      user.rooftopId,
      { email: dto.email },
      ipAddress,
    );

    return {
      accessToken: data.session?.access_token,
      refreshToken: data.session?.refresh_token,
      expiresAt: data.session?.expires_at,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tradeAccountId: user.tradeAccountId,
        rooftopId: user.rooftopId,
        creditHold: user.creditHold,
        isOverdue: user.isOverdue,
      },
    };
  }

  // ─── LOGOUT ──────────────────────────────────────────────────────────────────
  async logout(user: UserDocument, ipAddress?: string) {
    await this.supabase.auth.signOut();

    await this.writeAudit(
      AuditAction.LOGOUT,
      user.supabaseId,
      user.tradeAccountId,
      user.rooftopId,
      {},
      ipAddress,
    );

    return { message: 'Logged out successfully' };
  }

  // ─── REFRESH TOKEN ───────────────────────────────────────────────────────────
  async refreshToken(refreshToken: string, ipAddress?: string) {
    const { data, error } = await this.supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.userModel.findOne({ supabaseId: data.user?.id });

    await this.writeAudit(
      AuditAction.TOKEN_REFRESH,
      data.user?.id ?? 'unknown',
      user?.tradeAccountId ?? null,
      user?.rooftopId ?? null,
      {},
      ipAddress,
    );

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    };
  }

  // ─── ENROLL TOTP ─────────────────────────────────────────────────────────────
  async enrollTotp() {
    const { data, error } = await this.supabase.auth.mfa.enroll({
      factorType: 'totp',
    });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,   // Show this QR to the user to scan in their authenticator app
      secret: data.totp.secret,    // Backup secret
    };
  }

  // ─── VERIFY TOTP ─────────────────────────────────────────────────────────────
  async verifyTotp(dto: VerifyTotpDto) {
    // Step 1: create a challenge
    const { data: challengeData, error: challengeError } =
      await this.supabase.auth.mfa.challenge({ factorId: dto.factorId });

    if (challengeError) {
      throw new UnauthorizedException(challengeError.message);
    }

    // Step 2: verify the challenge with the TOTP code
    const { data, error } = await this.supabase.auth.mfa.verify({
      factorId: dto.factorId,
      challengeId: challengeData.id,
      code: dto.code,
    });

    if (error) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      message: 'TOTP verified successfully',
    };
  }

  // ─── GET ME ──────────────────────────────────────────────────────────────────
  async getMe(user: UserDocument) {
    return {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tradeAccountId: user.tradeAccountId,
      rooftopId: user.rooftopId,
      creditHold: user.creditHold,
      isOverdue: user.isOverdue,
      isActive: user.isActive,
    };
  }

  // ─── AUDIT HELPER ────────────────────────────────────────────────────────────
  async writeAudit(
    action: AuditAction,
    userId: string,
    tradeAccountId: string | null,
    rooftopId: string | null,
    metadata: Record<string, any>,
    ipAddress?: string,
  ) {
    await this.auditModel.create({
      action,
      userId,
      tradeAccountId,
      rooftopId,
      metadata,
      ipAddress: ipAddress ?? null,
    });
  }
}
