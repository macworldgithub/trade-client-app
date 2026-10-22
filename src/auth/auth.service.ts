import { Injectable, UnauthorizedException, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { AuthSession, AuthSessionDocument } from './schemas/auth-session.schema';
import { AuditEvent, AuditEventDocument, AuditAction } from './schemas/audit-event.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { Role } from '../common/enums/roles.enum';
import { AuthMailService } from './auth-mail.service';
import { AuthMfaService } from './auth-mfa.service';
import { AuthEmailOtpService, EMAIL_OTP_FIELDS } from './auth-email-otp.service';
import { AuthRecoveryOtpService, RECOVERY_OTP_FIELDS } from './auth-recovery-otp.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AuditEvent.name) private auditModel: Model<AuditEventDocument>,
    @InjectModel(AuthSession.name) private sessionModel: Model<AuthSessionDocument>,
    private jwtService: JwtService,
    private mail: AuthMailService,
    private mfa: AuthMfaService,
    private emailOtp: AuthEmailOtpService,
    private recoveryOtp: AuthRecoveryOtpService,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string, provisionedBy?: UserDocument) {
    if (!provisionedBy && ((dto.role && dto.role !== Role.TRADE_PARTNER) || dto.tradeAccountId || dto.rooftopId)) {
      throw new BadRequestException('Public registration creates trade partners only; administrators assign roles and accounts');
    }
    if (dto.password.length < 12 || Buffer.byteLength(dto.password, 'utf8') > 72) {
      throw new BadRequestException('Password must have at least 12 characters and at most 72 UTF-8 bytes');
    }
    const email = dto.email.trim().toLowerCase();
    if (await this.userModel.exists({ email })) throw new ConflictException('Email is already registered');
    this.mail.assertConfigured();
    const passwordHash = await bcrypt.hash(dto.password, 12);
    let user: UserDocument;
    try {
      user = await this.userModel.create({
        // Compatibility identity for existing order and audit code; no Supabase call.
        supabaseId: randomUUID(), email, fullName: dto.fullName.trim(), passwordHash,
        role: provisionedBy ? (dto.role ?? Role.TRADE_PARTNER) : Role.TRADE_PARTNER,
        tradeAccountId: provisionedBy ? (dto.tradeAccountId ?? null) : null,
        rooftopId: provisionedBy ? (dto.rooftopId ?? null) : null,
      });
    } catch (error) {
      if (error?.code === 11000) throw new ConflictException('Email is already registered');
      throw error;
    }
    await this.writeAudit(AuditAction.LOGIN, user.supabaseId, null, null, { action: 'REGISTER', email }, ipAddress);
    const challenge = await this.emailOtp.issue(user);
    return { ...challenge, message: 'Enter the 6-digit code sent to your email.', userId: user._id };
  }

  async login(dto: LoginDto, ipAddress?: string) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email }).select('+passwordHash');
    const hash = user?.passwordHash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
    const valid = Buffer.byteLength(dto.password, 'utf8') <= 72 && await bcrypt.compare(dto.password, hash);
    if (!user?.passwordHash || !user.isActive || !valid) {
      await this.writeAudit(AuditAction.LOGIN_FAILED, 'anonymous', null, null, { email }, ipAddress);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.emailVerifiedAt) return this.emailOtp.issue(user);
    return this.completeLogin(user, ipAddress);
  }

  async verifyEmailOtp(challengeId: string, code: string, ipAddress?: string) {
    const user = await this.emailOtp.verify(challengeId, code);
    return this.completeLogin(user, ipAddress);
  }

  resendEmailOtp(challengeId: string) { return this.emailOtp.resend(challengeId); }

  private async completeLogin(user: UserDocument, ipAddress?: string) {
    if (user.totpEnabled) return this.mfa.startChallenge(user);
    const result = await this.createSession(user, ipAddress);
    await this.writeAudit(AuditAction.LOGIN, user.supabaseId, user.tradeAccountId, user.rooftopId, { email: user.email }, ipAddress);
    return { ...result, user: await this.getMe(user) };
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async requestAccountEmail(email: string, purpose: 'reset-password') {
    return this.recoveryOtp.request(email);
  }

  verifyRecoveryOtp(challengeId: string, code: string) { return this.recoveryOtp.verify(challengeId, code); }

  async verifyEmail(token: string) {
    throw new BadRequestException('Verification links have been replaced by email codes. Sign in to receive a code.');
  }

  private validateAccountToken(token: string) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(token)) {
      throw new BadRequestException('Invalid or expired reset authorization. Request a new recovery code.');
    }
  }

  async resetPassword(token: string, password: string) {
    this.validateAccountToken(token);
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('Password must have at least 12 characters and at most 72 UTF-8 bytes');
    }
    const filter = { passwordResetTokenHash: this.tokenHash(token), passwordResetExpiresAt: { $gt: new Date() },
      passwordResetOtpVerifiedAt: { $gt: new Date(Date.now() - 600000) }, isActive: true };
    const pending = await this.userModel.findOne(filter).select('+passwordResetPasswordVersion');
    if (!pending || +(pending.passwordResetPasswordVersion ?? 0) !== +(pending.passwordChangedAt ?? 0)) {
      throw new BadRequestException('Invalid or expired reset authorization. Request a new recovery code.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.userModel.findOneAndUpdate(
      { ...filter, passwordChangedAt: pending.passwordChangedAt ?? null },
      { $set: { passwordHash, passwordChangedAt: new Date(), emailVerifiedAt: new Date() },
        $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1,
          passwordResetOtpVerifiedAt: 1, passwordResetPasswordVersion: 1, ...RECOVERY_OTP_FIELDS,
          ...EMAIL_OTP_FIELDS,
          emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1,
          totpPendingSecretEncrypted: 1, totpPendingFactorId: 1, totpPendingExpiresAt: 1,
          totpPendingPasswordVersion: 1, totpPendingAttempts: 1 } },
      { new: true },
    );
    if (!user) throw new BadRequestException('Invalid or expired reset authorization. Request a new recovery code.');
    await this.sessionModel.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return { message: 'Password saved and email verified. Sign in with your new password. Authenticator two-factor authentication remains required if enabled.' };
  }

  private async tokens(user: UserDocument, session: AuthSessionDocument, refreshToken: string) {
    const accessToken = await this.jwtService.signAsync({ sub: String(user._id), sid: String(session._id) });
    return { accessToken, refreshToken, expiresAt: Math.floor(Date.now() / 1000) + 900 };
  }

  private async createSession(user: UserDocument, ipAddress?: string) {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await this.sessionModel.create({
      userId: user._id, familyId: randomUUID(), refreshTokenHash: this.tokenHash(refreshToken),
      passwordVersion: user.passwordChangedAt?.getTime() ?? 0,
      mfaVersion: user.mfaVersion ?? 0,
      expiresAt: new Date(Date.now() + 30 * 86400000), ipAddress: ipAddress ?? null,
    });
    return this.tokens(user, session, refreshToken);
  }

  async logout(user: UserDocument, ipAddress?: string) {
    await this.sessionModel.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await this.writeAudit(AuditAction.LOGOUT, user.supabaseId, user.tradeAccountId, user.rooftopId, {}, ipAddress);
    return { message: 'Logged out successfully on all devices' };
  }

  async logoutSession(refreshToken: string | null, ipAddress?: string) {
    if (refreshToken && /^[A-Za-z0-9_-]{64}$/.test(refreshToken)) {
      const session = await this.sessionModel.findOne({ refreshTokenHash: this.tokenHash(refreshToken), revokedAt: null });
      const user = session && await this.userModel.findById(session.userId);
      if (user) return this.logout(user, ipAddress);
    }
    return { message: 'Logged out successfully' };
  }

  async refreshToken(refreshToken: string, ipAddress?: string) {
    if (typeof refreshToken !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(refreshToken)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const hash = this.tokenHash(refreshToken);
    const next = randomBytes(48).toString('base64url');
    // Atomic in-place rotation keeps the session ID stable and retains used hashes
    // for replay detection. Revocation and rotation operate on the same document.
    const session = await this.sessionModel.findOneAndUpdate(
      { refreshTokenHash: hash, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { refreshTokenHash: this.tokenHash(next) }, $push: { usedRefreshTokenHashes: hash } },
      { new: true },
    );
    if (!session) {
      await this.sessionModel.updateMany({ usedRefreshTokenHashes: hash, revokedAt: null },
        { $set: { revokedAt: new Date() } });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.userModel.findById(session.userId);
    if (!user?.isActive || !user.emailVerifiedAt || (session.passwordVersion ?? 0) !== (user.passwordChangedAt?.getTime() ?? 0)
      || (session.mfaVersion ?? 0) !== (user.mfaVersion ?? 0)) {
      await this.sessionModel.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
      throw new UnauthorizedException('Account not found or inactive');
    }
    await this.writeAudit(AuditAction.TOKEN_REFRESH, user.supabaseId, user.tradeAccountId, user.rooftopId, {}, ipAddress);
    return this.tokens(user, session, next);
  }

  async enrollTotp(user: UserDocument, password: string) {
    return this.mfa.enroll(String(user._id), password);
  }

  async totpStatus(user: UserDocument) { return this.mfa.status(String(user._id)); }

  async confirmTotp(user: UserDocument, factorId: string, code: string, ipAddress?: string) {
    const confirmed = await this.mfa.confirm(String(user._id), factorId, code);
    const result = await this.replaceMfaSession(confirmed.user, 'MFA_ENABLED', ipAddress);
    return { ...result, recoveryCodes: confirmed.recoveryCodes };
  }

  async disableTotp(user: UserDocument, password: string, code: string, ipAddress?: string) {
    const updated = await this.mfa.disable(String(user._id), password, code);
    return this.replaceMfaSession(updated, 'MFA_DISABLED', ipAddress);
  }

  private async replaceMfaSession(user: UserDocument, action: string, ipAddress?: string) {
    await this.sessionModel.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const result = await this.createSession(user, ipAddress);
    await this.writeAudit(AuditAction.USER_UPDATE, user.supabaseId, user.tradeAccountId, user.rooftopId, { action }, ipAddress);
    return { ...result, user: await this.getMe(user) };
  }

  async verifyTotp(dto: VerifyTotpDto, ipAddress?: string) {
    let user: UserDocument;
    try { user = await this.mfa.verifyLogin(dto.factorId, dto.code); }
    catch (error) {
      await this.writeAudit(AuditAction.LOGIN_FAILED, 'anonymous', null, null, { secondFactor: true }, ipAddress);
      throw error;
    }
    const result = await this.createSession(user, ipAddress);
    await this.writeAudit(AuditAction.LOGIN, user.supabaseId, user.tradeAccountId, user.rooftopId, { secondFactor: true }, ipAddress);
    return { ...result, user: await this.getMe(user) };
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
      totpEnabled: !!user.totpEnabled,
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

    await this.sessionModel.updateMany({ userId: user._id }, { $set: { revokedAt: new Date() } });

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
