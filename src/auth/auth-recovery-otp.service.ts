import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { User, UserDocument } from './schemas/user.schema';
import { AuthMailService } from './auth-mail.service';
import { nativeJwtSecret } from './native-jwt.config';

export const RECOVERY_OTP_FIELDS = {
  recoveryOtpChallengeHash: 1, recoveryOtpHash: 1, recoveryOtpExpiresAt: 1,
  recoveryOtpSentAt: 1, recoveryOtpAttempts: 1, recoveryOtpPasswordVersion: 1,
} as const;

@Injectable()
export class AuthRecoveryOtpService {
  constructor(@InjectModel(User.name) private users: Model<UserDocument>,
    private mail: AuthMailService, private config: ConfigService) {}

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private codeHash(challenge: string, code: string) {
    return createHmac('sha256', nativeJwtSecret(this.config)).update(`recovery-otp:${challenge}:${code}`).digest('hex');
  }
  private invalid(): never { throw new BadRequestException('Invalid or expired code. Request a new code and try again.'); }

  async request(email: string) {
    this.mail.assertConfigured();
    const challengeId = randomBytes(48).toString('base64url');
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const user = await this.users.findOne({ email: email.trim().toLowerCase(), isActive: true });
    if (user) {
      const now = new Date();
      const updated = await this.users.findOneAndUpdate({ _id: user._id, isActive: true,
        passwordChangedAt: user.passwordChangedAt ?? null,
        $or: [{ recoveryOtpSentAt: null }, { recoveryOtpSentAt: { $lte: new Date(+now - 60000) } }],
      }, { $set: {
        recoveryOtpChallengeHash: this.hash(challengeId), recoveryOtpHash: this.codeHash(challengeId, code),
        recoveryOtpExpiresAt: new Date(+now + 600000), recoveryOtpSentAt: now, recoveryOtpAttempts: 0,
        recoveryOtpPasswordVersion: user.passwordChangedAt ?? null,
      }, $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1,
        passwordResetOtpVerifiedAt: 1, passwordResetPasswordVersion: 1 } }, { new: true });
      if (updated) {
        try { await this.mail.sendRecoveryOtp(user.email, code); }
        catch {
          // Same public response for missing accounts and delivery failures.
          await this.users.updateOne({ _id: user._id, recoveryOtpChallengeHash: this.hash(challengeId) },
            { $unset: RECOVERY_OTP_FIELDS });
        }
      }
    }
    // Always show the code screen without disclosing whether the email exists.
    return { challengeId, expiresIn: 600, resendAfter: 60,
      message: 'If an eligible account exists, a 6-digit code will arrive shortly.' };
  }

  async verify(challengeId: string, code: string) {
    if (!/^[A-Za-z0-9_-]{64}$/.test(challengeId) || !/^\d{6}$/.test(code)) this.invalid();
    const user = await this.users.findOneAndUpdate({
      recoveryOtpChallengeHash: this.hash(challengeId), isActive: true,
      recoveryOtpExpiresAt: { $gt: new Date() }, recoveryOtpAttempts: { $lt: 5 },
    }, { $inc: { recoveryOtpAttempts: 1 } }, { new: true }).select('+recoveryOtpHash +recoveryOtpPasswordVersion');
    if (!user?.recoveryOtpHash || +(user.recoveryOtpPasswordVersion ?? 0) !== +(user.passwordChangedAt ?? 0)) this.invalid();
    const expected = Buffer.from(this.codeHash(challengeId, code), 'hex');
    const stored = Buffer.from(user.recoveryOtpHash, 'hex');
    if (stored.length !== expected.length || !timingSafeEqual(stored, expected)) this.invalid();
    const resetToken = randomBytes(48).toString('base64url');
    const now = new Date();
    const consumed = await this.users.findOneAndUpdate({ _id: user._id, isActive: true,
      recoveryOtpChallengeHash: this.hash(challengeId), recoveryOtpExpiresAt: { $gt: now },
      passwordChangedAt: user.passwordChangedAt ?? null,
    }, { $set: { passwordResetTokenHash: this.hash(resetToken), passwordResetExpiresAt: new Date(+now + 600000),
      passwordResetOtpVerifiedAt: now, passwordResetPasswordVersion: user.passwordChangedAt ?? null,
    }, $unset: RECOVERY_OTP_FIELDS }, { new: true });
    if (!consumed) this.invalid();
    // This is a short-lived password-reset grant, never a sign-in session.
    return { resetToken, expiresIn: 600, message: 'Code verified. Choose your new password.' };
  }
}
