import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { User, UserDocument } from './schemas/user.schema';
import { MfaChallenge, MfaChallengeDocument } from './schemas/mfa-challenge.schema';
import { base32, matchingTotpStep } from './totp.crypto';

const PRIVATE_FIELDS = '+passwordHash +totpSecretEncrypted +totpPendingSecretEncrypted +totpPendingFactorId +totpPendingExpiresAt +totpPendingPasswordVersion +totpPendingAttempts +totpLastUsedStep +totpRecoveryCodeHashes';
const PENDING_FIELDS = { totpPendingSecretEncrypted: 1, totpPendingFactorId: 1, totpPendingExpiresAt: 1, totpPendingPasswordVersion: 1, totpPendingAttempts: 1 };

@Injectable()
export class AuthMfaService {
  constructor(
    private config: ConfigService,
    @InjectModel(User.name) private users: Model<UserDocument>,
    @InjectModel(MfaChallenge.name) private challenges: Model<MfaChallengeDocument>,
  ) {}

  private key() {
    const value = this.config.get<string>('AUTH_TOTP_ENCRYPTION_KEY');
    if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
      throw new ServiceUnavailableException('Authenticator encryption is not configured');
    }
    return Buffer.from(value, 'hex');
  }

  encrypt(secret: string, userId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(userId));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }

  private decrypt(value: string, userId: string): string {
    const key = this.key();
    try {
      const data = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(userId));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    } catch { throw new ServiceUnavailableException('Unable to read authenticator configuration'); }
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private recoveryHash(userId: string, code: string) { return this.hash(`recovery:${userId}:${code.replace(/-/g, '').toLowerCase()}`); }

  private recoveryCodes(userId: string) {
    const codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex').match(/.{5}/g)!.join('-'));
    return { codes, hashes: codes.map(code => this.recoveryHash(userId, code)) };
  }

  private async currentUser(userId: string) {
    const user = await this.users.findById(userId).select(PRIVATE_FIELDS);
    if (!user?.isActive || !user.emailVerifiedAt) throw new UnauthorizedException('Account not found or inactive');
    return user;
  }

  private async reauthenticate(userId: string, password: string) {
    const user = await this.currentUser(userId);
    if (typeof password !== 'string' || Buffer.byteLength(password) > 72 || !user.passwordHash || !await bcrypt.compare(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid password');
    }
    return user;
  }

  async status(userId: string) {
    const user = await this.currentUser(userId);
    return { enabled: !!user.totpEnabled, recoveryCodesRemaining: user.totpRecoveryCodeHashes?.length ?? 0 };
  }

  async enroll(userId: string, password: string) {
    const user = await this.reauthenticate(userId, password);
    if (user.totpEnabled) throw new BadRequestException('Two-factor authentication is already enabled');
    const secret = base32(randomBytes(20));
    const encrypted = this.encrypt(secret, userId);
    const factorId = randomUUID();
    const updated = await this.users.findOneAndUpdate(
      { _id: user._id, isActive: true, totpEnabled: { $ne: true }, passwordChangedAt: user.passwordChangedAt ?? null },
      { $set: { totpPendingSecretEncrypted: encrypted, totpPendingFactorId: factorId,
        totpPendingExpiresAt: new Date(Date.now() + 10 * 60000), totpPendingAttempts: 0,
        totpPendingPasswordVersion: user.passwordChangedAt?.getTime() ?? 0 } },
      { new: true },
    );
    if (!updated) throw new BadRequestException('Account changed. Please sign in again.');
    const uri = `otpauth://totp/${encodeURIComponent(`Trade Client:${user.email}`)}?${new URLSearchParams({ secret, issuer: 'Trade Client', algorithm: 'SHA1', digits: '6', period: '30' })}`;
    return { factorId, secret, qrCode: await QRCode.toDataURL(uri, { width: 240, margin: 2 }) };
  }

  async confirm(userId: string, factorId: string, code: string) {
    const user = await this.users.findOneAndUpdate(
      { _id: userId, isActive: true, totpEnabled: { $ne: true }, totpPendingFactorId: factorId,
        totpPendingExpiresAt: { $gt: new Date() }, totpPendingAttempts: { $lt: 5 } },
      { $inc: { totpPendingAttempts: 1 } }, { new: true },
    ).select(PRIVATE_FIELDS);
    if (!user?.totpPendingSecretEncrypted || !user.emailVerifiedAt || user.totpPendingPasswordVersion !== (user.passwordChangedAt?.getTime() ?? 0)) {
      throw new UnauthorizedException('Setup expired or too many attempts. Start setup again.');
    }
    const step = matchingTotpStep(this.decrypt(user.totpPendingSecretEncrypted, userId), code);
    if (step === null) throw new UnauthorizedException('Invalid authenticator code');
    const recovery = this.recoveryCodes(userId);
    const enabled = await this.users.findOneAndUpdate(
      { _id: userId, isActive: true, totpEnabled: { $ne: true }, totpPendingFactorId: factorId,
        totpPendingExpiresAt: { $gt: new Date() }, passwordChangedAt: user.passwordChangedAt ?? null },
      { $set: { totpEnabled: true, totpSecretEncrypted: user.totpPendingSecretEncrypted,
        totpLastUsedStep: step, totpRecoveryCodeHashes: recovery.hashes },
        $inc: { mfaVersion: 1 }, $unset: PENDING_FIELDS }, { new: true },
    );
    if (!enabled) throw new UnauthorizedException('Account changed. Start setup again.');
    return { user: enabled, recoveryCodes: recovery.codes };
  }

  private async verifyProof(user: UserDocument, code: string) {
    const filter = { _id: user._id, isActive: true, totpEnabled: true,
      mfaVersion: user.mfaVersion, passwordChangedAt: user.passwordChangedAt ?? null };
    let updated: UserDocument | null = null;
    if (/^\d{6}$/.test(code) && user.totpSecretEncrypted) {
      const step = matchingTotpStep(this.decrypt(user.totpSecretEncrypted, String(user._id)), code);
      if (step !== null) {
        updated = await this.users.findOneAndUpdate(
          { ...filter, totpLastUsedStep: { $lt: step } }, { $set: { totpLastUsedStep: step } }, { new: true },
        );
      }
    } else if (/^[a-fA-F0-9]{5}(?:-?[a-fA-F0-9]{5}){3}$/.test(code)) {
      const hash = this.recoveryHash(String(user._id), code);
      updated = await this.users.findOneAndUpdate(
        { ...filter, totpRecoveryCodeHashes: hash }, { $pull: { totpRecoveryCodeHashes: hash } }, { new: true },
      );
    }
    if (!updated) throw new UnauthorizedException('Invalid, expired, or already-used code');
  }

  async startChallenge(user: UserDocument) {
    const factorId = randomBytes(48).toString('base64url');
    await this.challenges.create({ _id: this.hash(factorId), userId: user._id,
      passwordVersion: user.passwordChangedAt?.getTime() ?? 0, mfaVersion: user.mfaVersion,
      expiresAt: new Date(Date.now() + 5 * 60000) });
    return { requiresTotp: true as const, factorId };
  }

  async verifyLogin(factorId: string, code: string) {
    if (!/^[A-Za-z0-9_-]{64}$/.test(factorId)) throw new UnauthorizedException('Invalid login challenge');
    const challenge = await this.challenges.findOneAndUpdate(
      { _id: this.hash(factorId), consumedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
      { $inc: { attempts: 1 } }, { new: true },
    );
    if (!challenge) throw new UnauthorizedException('Login expired or too many attempts. Sign in again.');
    const user = await this.currentUser(String(challenge.userId));
    if (!user.totpEnabled || user.mfaVersion !== challenge.mfaVersion || (user.passwordChangedAt?.getTime() ?? 0) !== challenge.passwordVersion) {
      throw new UnauthorizedException('Account changed. Sign in again.');
    }
    await this.verifyProof(user, code);
    const consumed = await this.challenges.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } }, { new: true },
    );
    if (!consumed) throw new UnauthorizedException('Login challenge already used or expired');
    return user;
  }

  async disable(userId: string, password: string, code: string) {
    const user = await this.reauthenticate(userId, password);
    if (!user.totpEnabled) throw new BadRequestException('Two-factor authentication is not enabled');
    await this.verifyProof(user, code);
    const updated = await this.users.findOneAndUpdate(
      { _id: userId, isActive: true, totpEnabled: true, mfaVersion: user.mfaVersion, passwordChangedAt: user.passwordChangedAt ?? null },
      { $set: { totpEnabled: false, totpRecoveryCodeHashes: [] }, $inc: { mfaVersion: 1 },
        $unset: { ...PENDING_FIELDS, totpSecretEncrypted: 1, totpLastUsedStep: 1 } }, { new: true },
    );
    if (!updated) throw new UnauthorizedException('Account changed. Sign in again.');
    return updated;
  }
}
