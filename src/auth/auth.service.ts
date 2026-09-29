import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
import { User, UserDocument } from './schemas/user.schema';
import {
  AuditEvent,
  AuditEventDocument,
  AuditAction,
} from './schemas/audit-event.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
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
    console.log('Registering user with Supabase:', {
      email: dto.email,
      role: dto.role,
    });

    const { data, error } = await this.supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      console.error('Supabase signUp error:', {
        message: error.message,
        status: error.status,
        name: error.name,
        fullError: error,
      });

      if (error.message.includes('already registered')) {
        throw new ConflictException('Email is already registered');
      }
      throw new InternalServerErrorException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException(
        'Failed to create user in Supabase',
      );
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
    await this.writeAudit(
      AuditAction.LOGIN,
      data.user.id,
      null,
      null,
      {
        action: 'REGISTER',
        email: dto.email,
      },
      ipAddress,
    );

    return {
      message:
        'Registration successful. Please check your email to confirm your account.',
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
      await this.writeAudit(
        AuditAction.LOGIN_FAILED,
        'anonymous',
        null,
        null,
        {
          email: dto.email,
          reason: error.message,
        },
        ipAddress,
      );
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
      qrCode: data.totp.qr_code, // Show this QR to the user to scan in their authenticator app
      secret: data.totp.secret, // Backup secret
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

  // ─── LIST USERS (ADMIN) ──────────────────────────────────────────────────────
  async listUsers(query: ListUsersQueryDto) {
    const filter: Record<string, any> = {};

    if (query.search) {
      const regex = new RegExp(query.search.trim(), 'i');
      filter.$or = [{ fullName: regex }, { email: regex }, { tradeAccountId: regex }];
    }

    if (query.role) {
      filter.role = query.role;
    }

    if (query.rooftopId) {
      filter.rooftopId = query.rooftopId;
    }

    if (typeof query.isActive === 'boolean') {
      filter.isActive = query.isActive;
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      users: users.map((u) => ({
        id: u._id,
        _id: u._id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        tradeAccountId: u.tradeAccountId,
        rooftopId: u.rooftopId,
        isActive: u.isActive,
        creditHold: u.creditHold,
        isOverdue: u.isOverdue,
        createdAt: (u as any).createdAt,
        updatedAt: (u as any).updatedAt,
      })),
    };
  }

  // ─── GET USER BY ID (ADMIN) ──────────────────────────────────────────────────
  async getUserById(id: string) {
    const user = await this.userModel.findById(id).lean().exec();
    if (!user) {
      throw new NotFoundException(`User not found with id: ${id}`);
    }
    return {
      id: user._id,
      _id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tradeAccountId: user.tradeAccountId,
      rooftopId: user.rooftopId,
      isActive: user.isActive,
      creditHold: user.creditHold,
      isOverdue: user.isOverdue,
      createdAt: (user as any).createdAt,
      updatedAt: (user as any).updatedAt,
    };
  }

  // ─── UPDATE USER (ADMIN) ─────────────────────────────────────────────────────
  async updateUser(
    id: string,
    dto: UpdateUserDto,
    adminUser: UserDocument,
    ipAddress?: string,
  ) {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User not found with id: ${id}`);
    }

    const previousState = {
      role: user.role,
      fullName: user.fullName,
      rooftopId: user.rooftopId,
      tradeAccountId: user.tradeAccountId,
      isActive: user.isActive,
      creditHold: user.creditHold,
      isOverdue: user.isOverdue,
    };

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.rooftopId !== undefined) user.rooftopId = dto.rooftopId || null;
    if (dto.tradeAccountId !== undefined) user.tradeAccountId = dto.tradeAccountId || null;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.creditHold !== undefined) user.creditHold = dto.creditHold;
    if (dto.isOverdue !== undefined) user.isOverdue = dto.isOverdue;

    await user.save();

    await this.writeAudit(
      AuditAction.USER_UPDATE,
      adminUser.supabaseId || (adminUser as any)._id?.toString() || 'admin',
      user.tradeAccountId,
      user.rooftopId,
      {
        targetUserId: user._id,
        targetUserEmail: user.email,
        updatedFields: dto,
        previousState,
      },
      ipAddress,
    );

    return {
      message: 'User updated successfully',
      user: {
        id: user._id,
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tradeAccountId: user.tradeAccountId,
        rooftopId: user.rooftopId,
        isActive: user.isActive,
        creditHold: user.creditHold,
        isOverdue: user.isOverdue,
      },
    };
  }

  // ─── DELETE USER (ADMIN) ─────────────────────────────────────────────────────
  async deleteUser(id: string, adminUser: UserDocument, ipAddress?: string) {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User not found with id: ${id}`);
    }

    if (user.supabaseId === adminUser.supabaseId) {
      throw new BadRequestException('You cannot delete your own admin account');
    }

    if (user.supabaseId) {
      try {
        await this.supabase.auth.admin.deleteUser(user.supabaseId);
      } catch (err) {
        console.warn('Supabase auth user delete warning:', err);
      }
    }

    await this.userModel.findByIdAndDelete(id).exec();

    await this.writeAudit(
      AuditAction.USER_DELETE,
      adminUser.supabaseId || (adminUser as any)._id?.toString() || 'admin',
      user.tradeAccountId,
      user.rooftopId,
      {
        deletedUserId: user._id,
        deletedUserEmail: user.email,
        deletedUserRole: user.role,
      },
      ipAddress,
    );

    return { message: `User ${user.email} successfully deleted` };
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
