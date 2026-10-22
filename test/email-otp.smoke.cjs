const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { AuthEmailOtpService } = require('../dist/auth/auth-email-otp.service');
const { AuthService } = require('../dist/auth/auth.service');
const { UserSchema } = require('../dist/auth/schemas/user.schema');

function matches(user, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(branch => matches(user, branch));
    if (value === null) return user[key] == null;
    if (value instanceof Date) return +user[key] === +value;
    if (value && typeof value === 'object') return Object.entries(value).every(([op, n]) =>
      op === '$gt' ? user[key] > n : op === '$lt' ? user[key] < n : op === '$lte' ? user[key] <= n : false);
    return user[key] === value;
  });
}

(async () => {
  let user, delivered, failDelivery = false, deliveries = 0;
  function reset() { user = { _id: 'id', email: 'user@example.com', isActive: true, emailVerifiedAt: null, passwordChangedAt: null }; }
  function result(value) { const promise = Promise.resolve(value); promise.select = () => promise; return promise; }
  const users = {
    findOne: query => result(matches(user, query) ? { ...user } : null),
    findOneAndUpdate: (query, update) => {
      if (!matches(user, query)) return result(null);
      Object.assign(user, update.$set);
      for (const [key, amount] of Object.entries(update.$inc || {})) user[key] = (user[key] || 0) + amount;
      for (const key of Object.keys(update.$unset || {})) delete user[key];
      return result({ ...user });
    },
    updateOne: async (query, update) => {
      if (matches(user, query)) for (const key of Object.keys(update.$unset || {})) delete user[key];
    },
  };
  const mail = { assertConfigured() {}, sendOtp: async (email, code) => {
    deliveries++; if (failDelivery) throw new Error('mail unavailable'); delivered = { email, code };
  } };
  const otp = new AuthEmailOtpService(users, mail, new ConfigService({ AUTH_JWT_SECRET: 'test-secret-with-more-than-thirty-two-bytes' }));
  reset();
  const challenge = await otp.issue({ ...user });
  const firstCode = delivered.code;
  assert.match(firstCode, /^\d{6}$/);
  assert.equal(challenge.expiresIn, 600);
  assert.equal(user.emailOtpAttempts, 0);
  assert(!JSON.stringify(challenge).includes(firstCode));
  assert.notEqual(user.emailOtpHash, firstCode);
  assert.notEqual(user.emailOtpChallengeHash, challenge.challengeId);
  await assert.rejects(otp.resend(challenge.challengeId), /wait 60 seconds/);
  user.emailOtpSentAt = new Date(Date.now() - 61000);
  const next = await otp.resend(challenge.challengeId);
  const validCode = delivered.code;
  await assert.rejects(otp.verify(challenge.challengeId, firstCode), /Invalid or expired/);
  await assert.rejects(otp.verify(next.challengeId, validCode === '000000' ? '000001' : '000000'), /Invalid or expired/);
  const consumed = await Promise.allSettled([otp.verify(next.challengeId, validCode), otp.verify(next.challengeId, validCode)]);
  assert.equal(consumed.filter(r => r.status === 'fulfilled').length, 1, 'only one concurrent verification succeeds');
  assert(user.emailVerifiedAt);
  assert.equal(user.emailOtpHash, undefined);
  await assert.rejects(otp.verify(next.challengeId, validCode), /Invalid or expired/);

  reset();
  const exhausted = await otp.issue({ ...user });
  const correct = delivered.code;
  const wrong = correct === '111111' ? '222222' : '111111';
  await Promise.all(Array.from({ length: 8 }, () => assert.rejects(otp.verify(exhausted.challengeId, wrong), /Invalid or expired/)));
  assert.equal(user.emailOtpAttempts, 5);
  await assert.rejects(otp.verify(exhausted.challengeId, correct), /Invalid or expired/);
  assert.equal(user.emailVerifiedAt, null);

  for (const scenario of ['expired', 'password-changed', 'inactive']) {
    reset(); const pending = await otp.issue({ ...user }); const code = delivered.code;
    if (scenario === 'expired') user.emailOtpExpiresAt = new Date(Date.now() - 1);
    if (scenario === 'password-changed') user.passwordChangedAt = new Date();
    if (scenario === 'inactive') user.isActive = false;
    await assert.rejects(otp.verify(pending.challengeId, code), /Invalid or expired/);
    assert.equal(user.emailVerifiedAt, null, scenario);
  }
  reset(); failDelivery = true;
  await assert.rejects(otp.issue({ ...user }), /mail unavailable/);
  assert.equal(user.emailOtpChallengeHash, undefined, 'delivery failure releases cooldown for retry');
  failDelivery = false;
  await otp.issue({ ...user });
  for (const name of ['emailOtpHash', 'emailOtpChallengeHash', 'emailOtpPasswordVersion']) assert.equal(UserSchema.path(name).options.select, false);

  // Verification must hand off to existing MFA instead of bypassing it.
  const service = new AuthService({}, {}, {}, {}, {}, { startChallenge: async () => ({ requiresTotp: true, factorId: 'mfa' }) },
    { verify: async () => ({ isActive: true, emailVerifiedAt: new Date(), totpEnabled: true }) });
  assert.equal((await service.verifyEmailOtp('challenge', '123456')).requiresTotp, true);
  console.log('PASS: OTP hashing, expiry, five attempts under concurrency, cooldown, resend invalidation, single use, password changes, inactive accounts, mail failure recovery, hidden fields, and MFA handoff.');
})().catch(error => { console.error(error); process.exitCode = 1; });
