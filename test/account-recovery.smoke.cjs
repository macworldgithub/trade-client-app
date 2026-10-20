const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createHash } = require('crypto');
const { AuthService } = require('../dist/auth/auth.service');
const { AuthMailService } = require('../dist/auth/auth-mail.service');
const { ConfigService } = require('@nestjs/config');
const nodemailer = require('nodemailer');

(async () => {
  const hash = token => createHash('sha256').update(token).digest('hex');
  let user = { _id: 'user-id', email: 'user@example.com', isActive: true, emailVerifiedAt: null };
  let delivered;
  let revoked = false;
  const matches = query => {
    if (!user) return false;
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or') {
        if (!value.some(branch => Object.entries(branch).every(([k, v]) => v === null ? user[k] == null : user[k] <= v.$lte))) return false;
      } else if (value && typeof value === 'object' && '$gt' in value) {
        if (!(user[key] > value.$gt)) return false;
      } else if (value === null ? user[key] != null : user[key] !== value) return false;
    }
    return true;
  };
  const users = {
    findOneAndUpdate: async (query, update) => {
      if (!matches(query)) return null;
      Object.assign(user, update.$set);
      for (const key of Object.keys(update.$unset || {})) delete user[key];
      return user;
    },
    updateOne: async () => {},
  };
  const service = new AuthService(users, {}, { updateMany: async () => { revoked = true; } }, {}, {
    assertConfigured() {}, send: async (email, token, purpose) => { delivered = { email, token, purpose }; },
  });
  const response = await service.requestAccountEmail(user.email, 'verify-email');
  assert.equal(delivered.purpose, 'verify-email');
  assert.equal(user.emailVerificationTokenHash, hash(delivered.token));
  assert(!JSON.stringify(response).includes(delivered.token));
  const verification = delivered.token;
  delivered = null;
  await service.requestAccountEmail(user.email, 'verify-email');
  assert.equal(delivered, null, 'resend cooldown prevents repeated emails');
  await service.verifyEmail(verification);
  assert(user.emailVerifiedAt);
  await assert.rejects(service.verifyEmail(verification), /Invalid or expired/);

  const knownResponse = await service.requestAccountEmail(user.email, 'reset-password');
  const reset = delivered.token;
  delivered = null;
  const unknownResponse = await service.requestAccountEmail('unknown@example.com', 'reset-password');
  assert.deepEqual(knownResponse, unknownResponse);
  assert.equal(delivered, null);
  user.emailVerifiedAt = null;
  user.role = 'group_admin';
  user.totpEnabled = true;
  user.mfaVersion = 3;
  user.emailVerificationTokenHash = 'obsolete-verification-token';
  user.emailVerificationExpiresAt = new Date(Date.now() + 10000);
  await assert.rejects(service.resetPassword('x'.repeat(64), 'long-new-password-123'), /Invalid or expired/);
  assert.equal(user.emailVerifiedAt, null, 'invalid link must not verify an email');
  user.passwordResetExpiresAt = new Date(Date.now() - 1000);
  await assert.rejects(service.resetPassword(reset, 'long-new-password-123'), /Invalid or expired/);
  assert.equal(user.emailVerifiedAt, null, 'expired link must not verify an email');
  user.passwordResetExpiresAt = new Date(Date.now() + 10000);
  await service.resetPassword(reset, 'long-new-password-123');
  assert(await bcrypt.compare('long-new-password-123', user.passwordHash));
  assert(user.passwordChangedAt);
  assert(user.emailVerifiedAt, 'the emailed setup link also verifies the inbox');
  assert.equal(user.emailVerificationTokenHash, undefined);
  assert.equal(user.role, 'group_admin');
  assert.equal(user.totpEnabled, true, 'account recovery must preserve MFA');
  assert.equal(user.mfaVersion, 3);
  assert(revoked);
  await assert.rejects(service.resetPassword(reset, 'another-new-password-123'), /Invalid or expired/);
  await assert.rejects(service.resetPassword('bad', 'long-new-password-123'), /Invalid or expired/);

  const original = nodemailer.createTransport;
  let sent;
  nodemailer.createTransport = options => {
    assert.equal(options.auth.pass, 'test-password');
    assert.equal(options.requireTLS, true);
    return { sendMail: async message => { sent = message; }, close() {} };
  };
  try {
    const mail = new AuthMailService(new ConfigService({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'sender@example.com', SMTP_PASS: 'test-password', AUTH_EMAIL_FROM: 'sender@example.com', AUTH_FRONTEND_URL: 'https://trade-client-frontend.vercel.app/' }));
    await mail.send('user@example.com', 'a'.repeat(64), 'verify-email');
    assert(sent.text.includes('https://trade-client-frontend.vercel.app/auth/verify-email#token='));
    assert(!sent.text.includes('?token='));
    await mail.send('user@example.com', 'b'.repeat(64), 'reset-password');
    assert(sent.text.includes('/auth/reset-password#token='));
    assert(sent.subject.includes('Set up or recover'));
    assert(sent.text.includes('verify your email address'));
    assert.throws(() => new AuthMailService(new ConfigService({})).assertConfigured(), /not configured/);
  } finally { nodemailer.createTransport = original; }
  console.log('PASS: verification and reset link hashing, expiry, single use, resend cooldown, generic responses, password hashing, session revocation, SMTP_PASS alias, and frontend links.');
})().catch(error => { console.error(error); process.exitCode = 1; });
