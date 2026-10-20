const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { ConfigService } = require('@nestjs/config');
const { AuthMfaService } = require('../dist/auth/auth-mfa.service');
const { AuthService } = require('../dist/auth/auth.service');
const { AuthController } = require('../dist/auth/auth.controller');
const { NativeJwtStrategy } = require('../dist/auth/strategies/native-jwt.strategy');
const { base32, totpCode, matchingTotpStep } = require('../dist/auth/totp.crypto');
const { UserSchema } = require('../dist/auth/schemas/user.schema');

const copy = value => structuredClone(value);
const query = value => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(copy(value)).then(resolve, reject); } });
function matches(row, filter) {
  if (!row) return false;
  return Object.entries(filter).every(([key, value]) => {
    const actual = row[key];
    if (value === null) return actual == null;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([op, operand]) => {
        if (op === '$gt') return actual > operand;
        if (op === '$lt') return actual < operand;
        if (op === '$ne') return actual !== operand;
        throw new Error(`Unsupported test operator: ${op}`);
      });
    }
    if (Array.isArray(actual)) return actual.includes(value);
    return actual instanceof Date && value instanceof Date ? +actual === +value : actual === value;
  });
}
function update(row, mutation) {
  Object.assign(row, mutation.$set);
  for (const key of Object.keys(mutation.$unset || {})) delete row[key];
  for (const [key, value] of Object.entries(mutation.$inc || {})) row[key] = (row[key] || 0) + value;
  for (const [key, value] of Object.entries(mutation.$pull || {})) row[key] = row[key].filter(item => item !== value);
}

(async () => {
  // Independently published RFC 6238 Appendix B SHA-1 vectors (8 digits).
  const referenceSecret = base32(Buffer.from('12345678901234567890'));
  assert.equal(referenceSecret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totpCode(referenceSecret, Math.floor(seconds / 30), 8), expected);
  }
  assert.equal(matchingTotpStep(referenceSecret, '287082', 59000), 1);
  assert.equal(matchingTotpStep(referenceSecret, 'bad', 59000), null);

  const password = 'a-long-test-password';
  let user = { _id: '123456789012345678901234', supabaseId: 'legacy-identity', email: 'user@example.com',
    passwordHash: await bcrypt.hash(password, 4), isActive: true, emailVerifiedAt: new Date(),
    totpEnabled: false, mfaVersion: 0, passwordChangedAt: null };
  const challenges = new Map();
  const users = {
    findById: id => query(id === user._id ? user : null),
    findOne: filter => query(matches(user, filter) ? user : null),
    findOneAndUpdate: (filter, mutation) => {
      if (!matches(user, filter)) return query(null);
      update(user, mutation);
      return query(user);
    },
  };
  const challengeModel = {
    create: async input => { challenges.set(input._id, { attempts: 0, consumedAt: null, ...copy(input) }); },
    findOneAndUpdate: (filter, mutation) => {
      const row = challenges.get(filter._id);
      if (!matches(row, filter)) return query(null);
      update(row, mutation);
      return query(row);
    },
  };
  const config = new ConfigService({ AUTH_TOTP_ENCRYPTION_KEY: 'a'.repeat(64), AUTH_JWT_SECRET: 'test-only-secret-with-at-least-32-bytes' });
  const mfa = new AuthMfaService(config, users, challengeModel);
  await assert.rejects(mfa.enroll(user._id, 'incorrect'), /Invalid password/);
  const initial = await mfa.enroll(user._id, password);
  assert(initial.qrCode.startsWith('data:image/png;base64,'));
  assert(!user.totpPendingSecretEncrypted.includes(initial.secret));
  assert.equal(user.totpEnabled, false, 'pending setup must not enable MFA');
  assert.throws(() => mfa.decrypt(user.totpPendingSecretEncrypted, 'another-user'), /Unable to read/);
  for (const field of ['totpSecretEncrypted', 'totpPendingSecretEncrypted', 'totpRecoveryCodeHashes']) assert.equal(UserSchema.path(field).options.select, false);

  const now = Date.now;
  let time = Math.floor(now() / 30000) * 30000 + 1000;
  Date.now = () => time;
  try {
    const expired = copy(user);
    user.totpPendingExpiresAt = new Date(time - 1);
    await assert.rejects(mfa.confirm(user._id, initial.factorId, totpCode(initial.secret, Math.floor(time / 30000))), /Setup expired/);
    user = expired;
    const enabled = await mfa.confirm(user._id, initial.factorId, totpCode(initial.secret, Math.floor(time / 30000)));
    assert.equal(user.totpEnabled, true);
    assert.equal(user.mfaVersion, 1);
    assert.equal(enabled.recoveryCodes.length, 10);
    assert.equal(new Set(enabled.recoveryCodes).size, 10);
    assert(user.totpRecoveryCodeHashes.every(hash => /^[a-f0-9]{64}$/.test(hash)));
    await assert.rejects(mfa.enroll(user._id, password), /already enabled/);
    await assert.rejects(mfa.confirm(user._id, initial.factorId, '000000'), /Setup expired/);

    let sessionsCreated = 0;
    let allRevoked = false;
    const sessions = { create: async input => { sessionsCreated++; return { ...input, _id: 'abcdefabcdefabcdefabcdef' }; },
      updateMany: async () => { allRevoked = true; } };
    const auth = new AuthService(users, { create: async () => {} }, sessions,
      { signAsync: async () => 'signed-access' }, {}, mfa);
    const login = await auth.login({ email: user.email, password });
    assert.equal(login.requiresTotp, true);
    assert(!('accessToken' in login));
    assert.equal(sessionsCreated, 0, 'password alone must never create a full session');

    let cookiesSet = 0;
    let cookiesCleared = 0;
    const controller = new AuthController(auth, { setSession() { cookiesSet++; }, clearSession() { cookiesCleared++; } });
    const controllerLogin = await controller.login({ email: user.email, password }, {}, {});
    assert.equal(controllerLogin.requiresTotp, true);
    assert.equal(cookiesSet, 0);
    assert.equal(cookiesCleared, 1);
    await assert.rejects(mfa.verifyLogin(login.factorId, totpCode(initial.secret, Math.floor(time / 30000))), /already-used/, 'enrollment code cannot be replayed');
    time += 30000;
    const result = await controller.verifyTotp({ factorId: login.factorId, code: totpCode(initial.secret, Math.floor(time / 30000)) }, {}, {});
    assert.equal(result.user.totpEnabled, true);
    assert(!('accessToken' in result));
    assert(!('totpSecretEncrypted' in result.user));
    assert.equal(sessionsCreated, 1);
    assert.equal(cookiesSet, 1);
    await assert.rejects(mfa.verifyLogin(login.factorId, enabled.recoveryCodes[0]), /Login expired/);

    const recovery = await mfa.startChallenge(user);
    await mfa.verifyLogin(recovery.factorId, enabled.recoveryCodes[0].toUpperCase());
    assert.equal(user.totpRecoveryCodeHashes.length, 9);
    const replay = await mfa.startChallenge(user);
    await assert.rejects(mfa.verifyLogin(replay.factorId, enabled.recoveryCodes[0]), /already-used/);
    const recoveryRace = await Promise.all([mfa.startChallenge(user), mfa.startChallenge(user)]);
    const recoveryResults = await Promise.allSettled(recoveryRace.map(challenge => mfa.verifyLogin(challenge.factorId, enabled.recoveryCodes[2])));
    assert.equal(recoveryResults.filter(value => value.status === 'fulfilled').length, 1, 'concurrent recovery-code use must have exactly one winner');
    const locked = await mfa.startChallenge(user);
    for (let i = 0; i < 5; i++) await assert.rejects(mfa.verifyLogin(locked.factorId, 'f'.repeat(20)), /already-used/);
    await assert.rejects(mfa.verifyLogin(locked.factorId, enabled.recoveryCodes[1]), /too many attempts/);
    const expiring = await mfa.startChallenge(user);
    [...challenges.values()].at(-1).expiresAt = new Date(now() - 1);
    time += 5 * 60000 + 1;
    await assert.rejects(mfa.verifyLogin(expiring.factorId, enabled.recoveryCodes[1]), /Login expired/);

    const reset = await mfa.startChallenge(user);
    user.passwordChangedAt = new Date(time);
    await assert.rejects(mfa.verifyLogin(reset.factorId, enabled.recoveryCodes[1]), /Account changed/);
    assert.equal(user.totpEnabled, true, 'password resets must not disable MFA');
    const strategy = new NativeJwtStrategy(config, { findOne: async () => user }, { findOne: async () => ({ passwordVersion: +user.passwordChangedAt, mfaVersion: 0 }) });
    await assert.rejects(strategy.validate({ sub: user._id, sid: 'abcdefabcdefabcdefabcdef' }), /Session expired/, 'pre-MFA sessions must be invalid');
    await assert.rejects(mfa.disable(user._id, 'incorrect', enabled.recoveryCodes[1]), /Invalid password/);
    await auth.disableTotp(user, password, enabled.recoveryCodes[1]);
    assert.equal(user.totpEnabled, false);
    assert.equal(user.mfaVersion, 2);
    assert.equal(user.totpSecretEncrypted, undefined);
    assert.deepEqual(user.totpRecoveryCodeHashes, []);
    assert(allRevoked);

    const retry = await mfa.enroll(user._id, password);
    const badCode = ['000000', '111111', '222222', '333333'].find(code => matchingTotpStep(retry.secret, code) === null);
    for (let i = 0; i < 5; i++) await assert.rejects(mfa.confirm(user._id, retry.factorId, badCode), /Invalid authenticator/);
    await assert.rejects(mfa.confirm(user._id, retry.factorId, totpCode(retry.secret, Math.floor(time / 30000))), /too many attempts/);
    const concurrentSetup = await mfa.enroll(user._id, password);
    const code = totpCode(concurrentSetup.secret, Math.floor(time / 30000));
    const parallel = await Promise.allSettled([mfa.confirm(user._id, concurrentSetup.factorId, code), mfa.confirm(user._id, concurrentSetup.factorId, code)]);
    assert.equal(parallel.filter(value => value.status === 'fulfilled').length, 1);
  } finally { Date.now = now; }
  console.log('PASS: RFC TOTP vectors, encrypted user-bound secrets, password reauthentication, setup confirmation and attempt limits, no password-only sessions, HttpOnly MFA login, code replay rejection, recovery code single use, challenge expiry and lockout, password-reset protection, old-session invalidation, safe disable, and concurrent confirmation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
