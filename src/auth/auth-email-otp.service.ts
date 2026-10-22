import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { User, UserDocument } from './schemas/user.schema';
import { AuthMailService } from './auth-mail.service';
import { nativeJwtSecret } from './native-jwt.config';

const MINUTE = 60000;
export const EMAIL_OTP_FIELDS = {
  emailOtpChallengeHash: 1, emailOtpHash: 1, emailOtpExpiresAt: 1,
  emailOtpSentAt: 1, emailOtpAttempts: 1, emailOtpPasswordVersion: 1,
} as const;

@Injectable()
export class AuthEmailOtpService {
  constructor(@InjectModel(User.name) private users: Model<UserDocument>,
    private mail: AuthMailService, private config: ConfigService) {}

  private challengeHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private codeHash(challenge: string, code: string) {
    return createHmac('sha256', nativeJwtSecret(this.config)).update(`email-otp:${challenge}:${code}`).digest('hex');
  }
  private invalid(): never { throw new BadRequestException('Invalid or expired code. Request a new code and try again.'); }

  async issue(user: UserDocument, previousChallenge?: string) {
    this.mail.assertConfigured();
    const challengeId = randomBytes(48).toString('base64url');
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const now = new Date();
    const updated = await this.users.findOneAndUpdate({
      _id: user._id, isActive: true, emailVerifiedAt: null,
      passwordChangedAt: user.passwordChangedAt ?? null,
      ...(previousChallenge ? { emailOtpChallengeHash: this.challengeHash(previousChallenge) } : {}),
      $or: [{ emailOtpSentAt: null }, { emailOtpSentAt: { $lte: new Date(+now - MINUTE) } }],
    }, { $set: {
      emailOtpChallengeHash: this.challengeHash(challengeId), emailOtpHash: this.codeHash(challengeId, code),
      emailOtpExpiresAt: new Date(+now + 10 * MINUTE), emailOtpSentAt: now, emailOtpAttempts: 0,
      emailOtpPasswordVersion: user.passwordChangedAt ?? null,
    }, $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 } }, { new: true });
    if (!updated) throw new HttpException('Please wait 60 seconds before requesting another code, then start sign-in again if needed.', 429);
    try { await this.mail.sendOtp(user.email, code); }
    catch (error) {
      await this.users.updateOne({ _id: user._id, emailOtpChallengeHash: this.challengeHash(challengeId) }, { $unset: EMAIL_OTP_FIELDS });
      throw error;
    }
    return { requiresEmailOtp: true as const, challengeId, expiresIn: 600, resendAfter: 60 };
  }

  async resend(challengeId: string) {
    const user = await this.users.findOne({ emailOtpChallengeHash: this.challengeHash(challengeId), isActive: true,
      emailVerifiedAt: null }).select('+emailOtpPasswordVersion');
    if (!user || +(user.emailOtpPasswordVersion ?? 0) !== +(user.passwordChangedAt ?? 0)) this.invalid();
    return this.issue(user, challengeId);
  }

  async verify(challengeId: string, code: string) {
    if (!/^[A-Za-z0-9_-]{64}$/.test(challengeId) || !/^\d{6}$/.test(code)) this.invalid();
    // Claim an attempt atomically before checking the code: concurrent guesses share the five-attempt limit.
    const query = { emailOtpChallengeHash: this.challengeHash(challengeId), emailVerifiedAt: null,
      isActive: true, emailOtpExpiresAt: { $gt: new Date() }, emailOtpAttempts: { $lt: 5 } };
    const user = await this.users.findOneAndUpdate(query, { $inc: { emailOtpAttempts: 1 } }, { new: true })
      .select('+emailOtpHash +emailOtpPasswordVersion');
    if (!user?.emailOtpHash || +(user.emailOtpPasswordVersion ?? 0) !== +(user.passwordChangedAt ?? 0)) this.invalid();
    const expected = Buffer.from(this.codeHash(challengeId, code), 'hex');
    const stored = Buffer.from(user.emailOtpHash, 'hex');
    if (stored.length !== expected.length || !timingSafeEqual(stored, expected)) this.invalid();
    // Only one request can consume a valid code; password changes invalidate pending challenges.
    const verified = await this.users.findOneAndUpdate({ _id: user._id,
      emailOtpChallengeHash: query.emailOtpChallengeHash, emailVerifiedAt: null, isActive: true,
      emailOtpExpiresAt: { $gt: new Date() }, passwordChangedAt: user.passwordChangedAt ?? null,
    }, { $set: { emailVerifiedAt: new Date() }, $unset: {
      ...EMAIL_OTP_FIELDS, emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1,
    } }, { new: true });
    if (!verified) this.invalid();
    return verified;
  }
}
