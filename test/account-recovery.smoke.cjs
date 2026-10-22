const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { AuthService } = require('../dist/auth/auth.service');
const { AuthRecoveryOtpService } = require('../dist/auth/auth-recovery-otp.service');
const { AuthEmailOtpService } = require('../dist/auth/auth-email-otp.service');
const { AuthMailService } = require('../dist/auth/auth-mail.service');
const { UserSchema } = require('../dist/auth/schemas/user.schema');
const { ConfigService } = require('@nestjs/config');
const nodemailer = require('nodemailer');

(async () => {
  let user, delivered, deliveryCount = 0, revoked = 0, deliveryFails = false;
  const reset = () => { user = { _id: 'user-id', email: 'user@example.com', isActive: true,
    emailVerifiedAt: null, passwordChangedAt: null, role: 'group_admin', totpEnabled: true, mfaVersion: 3,
    totpSecretEncrypted: 'existing-secret', totpRecoveryCodeHashes: ['existing-hash'] }; };
  const matches = (query) => Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(matches);
    if (value === null) return user[key] == null;
    if (value instanceof Date) return +user[key] === +value;
    if (value && typeof value === 'object') return Object.entries(value).every(([op, n]) =>
      op === '$gt' ? user[key] > n : op === '$lt' ? user[key] < n : op === '$lte' ? user[key] <= n : false);
    return user[key] === value;
  });
  const result = value => { const p = Promise.resolve(value); p.select = () => p; return p; };
  const users = {
    findOne: query => result(matches(query) ? { ...user } : null),
    findOneAndUpdate: (query, update) => {
      if (!matches(query)) return result(null);
      Object.assign(user, update.$set);
      for (const [key, amount] of Object.entries(update.$inc || {})) user[key] = (user[key] || 0) + amount;
      for (const key of Object.keys(update.$unset || {})) delete user[key];
      return result({ ...user });
    },
    updateOne: async (query, update) => {
      if (matches(query)) for (const key of Object.keys(update.$unset || {})) delete user[key];
    },
  };
  const mail = { assertConfigured() {}, sendRecoveryOtp: async (email, code) => {
    deliveryCount++; if (deliveryFails) throw Error('delivery failed'); delivered = { email, code };
  } };
  const config = new ConfigService({ AUTH_JWT_SECRET: 'test-only-secret-with-more-than-thirty-two-bytes' });
  const otp = new AuthRecoveryOtpService(users, mail, config);
  const service = new AuthService(users, {}, { updateMany: async () => { revoked++; } }, {}, mail, {}, {}, otp);
  reset();
  await assert.rejects(service.verifyEmail('a'.repeat(64)), /replaced by email codes/);
  const known = await service.requestAccountEmail(' USER@example.com ', 'reset-password');
  const firstCode = delivered.code;
  assert.match(firstCode, /^\d{6}$/);
  assert.notEqual(user.recoveryOtpHash, firstCode);
  assert.notEqual(user.recoveryOtpChallengeHash, known.challengeId);
  assert(!('resetToken' in known));
  assert(!('accessToken' in known));
  const unknown = await service.requestAccountEmail('unknown@example.com', 'reset-password');
  const shape = ({ challengeId, ...rest }) => rest;
  assert.deepEqual(shape(known), shape(unknown));
  assert.equal(deliveryCount, 1);
  await service.requestAccountEmail(user.email, 'reset-password');
  assert.equal(deliveryCount, 1, 'per-account cooldown suppresses repeated email');
  await assert.rejects(otp.verify(unknown.challengeId, firstCode), /Invalid or expired/);
  await assert.rejects(service.resetPassword('x'.repeat(64), 'long-new-password-123'), /Invalid or expired/);
  await assert.rejects(new AuthEmailOtpService(users, {}, config).verify(known.challengeId, firstCode), /Invalid or expired/);
  user.recoveryOtpSentAt = new Date(Date.now() - 61000);
  const newer = await otp.request(user.email); const code = delivered.code;
  await assert.rejects(otp.verify(known.challengeId, firstCode), /Invalid or expired/);
  const grant = await service.verifyRecoveryOtp(newer.challengeId, code);
  assert(!('accessToken' in grant));
  assert.notEqual(user.passwordResetTokenHash, grant.resetToken);
  assert.equal(user.emailVerifiedAt, null, 'verifying recovery must not create a sign-in session');
  await assert.rejects(otp.verify(newer.challengeId, code), /Invalid or expired/);
  user.passwordResetExpiresAt = new Date(Date.now() - 1);
  await assert.rejects(service.resetPassword(grant.resetToken, 'long-new-password-123'), /Invalid or expired/);
  user.passwordResetExpiresAt = new Date(Date.now() + 600000);
  const marker = user.passwordResetOtpVerifiedAt;
  delete user.passwordResetOtpVerifiedAt;
  await assert.rejects(service.resetPassword(grant.resetToken, 'long-new-password-123'), /Invalid or expired/, 'old reset links cannot skip OTP');
  user.passwordResetOtpVerifiedAt = marker;
  await service.resetPassword(grant.resetToken, 'long-new-password-123');
  assert(await bcrypt.compare('long-new-password-123', user.passwordHash));
  assert(user.emailVerifiedAt);
  assert(user.passwordChangedAt);
  assert.equal(user.role, 'group_admin'); assert.equal(user.totpEnabled, true); assert.equal(user.mfaVersion, 3);
  assert.equal(user.totpSecretEncrypted, 'existing-secret');
  assert.deepEqual(user.totpRecoveryCodeHashes, ['existing-hash']);
  assert.equal(revoked, 1);
  await assert.rejects(service.resetPassword(grant.resetToken, 'another-password-123'), /Invalid or expired/);

  reset(); const locked = await otp.request(user.email); const correct = delivered.code;
  const wrong = correct === '111111' ? '222222' : '111111';
  await Promise.all(Array.from({ length: 8 }, () => assert.rejects(otp.verify(locked.challengeId, wrong), /Invalid or expired/)));
  assert.equal(user.recoveryOtpAttempts, 5);
  await assert.rejects(otp.verify(locked.challengeId, correct), /Invalid or expired/);
  for (const scenario of ['expired', 'inactive', 'password-changed']) {
    reset(); const pending = await otp.request(user.email); const savedCode = delivered.code;
    if (scenario === 'expired') user.recoveryOtpExpiresAt = new Date(Date.now() - 1);
    if (scenario === 'inactive') user.isActive = false;
    if (scenario === 'password-changed') user.passwordChangedAt = new Date();
    await assert.rejects(otp.verify(pending.challengeId, savedCode), /Invalid or expired/);
  }
  reset(); const concurrent = await otp.request(user.email); const concurrentCode = delivered.code;
  const completions = await Promise.allSettled([otp.verify(concurrent.challengeId, concurrentCode), otp.verify(concurrent.challengeId, concurrentCode)]);
  assert.equal(completions.filter(r => r.status === 'fulfilled').length, 1);
  const pendingGrant = completions.find(r => r.status === 'fulfilled').value;
  user.passwordChangedAt = new Date();
  await assert.rejects(service.resetPassword(pendingGrant.resetToken, 'another-password-123'), /Invalid or expired/);
  reset(); deliveryFails = true;
  assert.equal((await otp.request(user.email)).message, unknown.message);
  assert.equal(user.recoveryOtpHash, undefined);
  deliveryFails = false;
  for (const name of ['recoveryOtpHash', 'recoveryOtpChallengeHash', 'passwordResetOtpVerifiedAt', 'passwordResetPasswordVersion']) {
    assert.equal(UserSchema.path(name).options.select, false);
  }
  const original = nodemailer.createTransport; let sent;
  nodemailer.createTransport = options => {
    assert.equal(options.auth.pass, 'test-password'); assert.equal(options.requireTLS, true);
    return { sendMail: async message => { sent = message; }, close() {} };
  };
  try {
    const smtp = new AuthMailService(new ConfigService({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'sender@example.com',
      SMTP_PASS: 'test-password', AUTH_EMAIL_FROM: 'sender@example.com' }));
    await smtp.sendRecoveryOtp(user.email, '012345');
    assert(sent.text.includes('012345')); assert(sent.text.includes('10 minutes')); assert(!sent.text.includes('http'));
    await smtp.sendOtp(user.email, '123456'); assert(sent.text.includes('123456'));
    assert.throws(() => new AuthMailService(new ConfigService({})).assertConfigured(), /not configured/);
  } finally { nodemailer.createTransport = original; }
  console.log('PASS: recovery OTP hashing, generic responses, cooldown, expiry, five attempts, resend invalidation, cross-purpose rejection, concurrent single use, reset grants, password hashing, session revocation, verified email, preserved MFA, and SMTP code content.');
})().catch(error => { console.error(error); process.exitCode = 1; });
