// Runs against the built backend without Jest's CommonJS/ESM transformer.
const assert = require('node:assert/strict');
const { AuthService } = require('../dist/auth/auth.service');
const { NativeJwtStrategy } = require('../dist/auth/strategies/native-jwt.strategy');
const { JwtService } = require('@nestjs/jwt');
const { ConfigService } = require('@nestjs/config');
const { Types } = require('mongoose');
const bcrypt = require('bcrypt');

(async () => {
  let user;
  let session;
  const users = {
    exists: async () => user ? { _id: user._id } : null,
    create: async input => (user = { ...input, _id: new Types.ObjectId(), isActive: true }),
    findOne: () => ({ select: async () => user }),
    findById: async () => user,
  };
  const sessions = {
    create: async input => (session = { ...input, _id: new Types.ObjectId(), revokedAt: null, usedRefreshTokenHashes: [] }),
    findOneAndUpdate: async (query, update) => {
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.refreshTokenHash !== query.refreshTokenHash) return null;
      Object.assign(session, update.$set);
      session.usedRefreshTokenHashes.push(update.$push.usedRefreshTokenHashes);
      return session;
    },
    updateMany: async (query, update) => {
      if (session && (!query.usedRefreshTokenHashes || session.usedRefreshTokenHashes.includes(query.usedRefreshTokenHashes))) Object.assign(session, update.$set);
    },
    findOne: async () => session && !session.revokedAt && session.expiresAt > new Date() ? session : null,
  };
  const jwt = new JwtService({ secret: 'test-only-secret-with-at-least-32-bytes', signOptions: { algorithm: 'HS256', expiresIn: 900, issuer: 'trade-client-api', audience: 'trade-client' } });
  const service = new AuthService(users, { create: async () => {} }, sessions, jwt, { assertConfigured() {}, async send() {} }, undefined,
    { issue: async () => ({ requiresEmailOtp: true, challengeId: 'a'.repeat(64) }) });
  const dto = { email: 'USER@example.com', fullName: 'Test User', password: 'long-password-for-testing' };
  await assert.rejects(service.register({ ...dto, role: 'admin' }), /trade partners only/);
  await assert.rejects(service.register({ ...dto, tradeAccountId: 'other' }), /trade partners only/);
  await assert.rejects(service.register({ ...dto, password: 'short' }), /12 characters/);
  await assert.rejects(service.register({ ...dto, password: 'é'.repeat(40) }), /72 UTF-8/);
  await service.register(dto);
  assert.equal(user.email, 'user@example.com');
  assert.equal(user.role, 'trade_partner');
  assert.equal(user.tradeAccountId, null);
  assert(await bcrypt.compare(dto.password, user.passwordHash));
  await assert.rejects(service.register(dto), /already registered/);
  await assert.rejects(service.login({ ...dto, password: 'incorrect' }), /Invalid email or password/);
  user.isActive = false;
  await assert.rejects(service.login(dto), /Invalid email or password/);
  user.isActive = true;
  assert.equal((await service.login(dto)).requiresEmailOtp, true);
  assert.equal(session, undefined, 'unverified login must not create a session');
  user.emailVerifiedAt = new Date();
  const login = await service.login(dto);
  assert(!('passwordHash' in login.user));
  assert.notEqual(session.refreshTokenHash, login.refreshToken);
  const payload = await jwt.verifyAsync(login.accessToken, { algorithms: ['HS256'], issuer: 'trade-client-api', audience: 'trade-client' });
  assert.equal(payload.sub, String(user._id));
  const strategy = new NativeJwtStrategy(new ConfigService({ AUTH_JWT_SECRET: 'test-only-secret-with-at-least-32-bytes' }), { findOne: async () => user }, sessions);
  assert.equal(await strategy.validate(payload), user);
  const refreshed = await service.refreshToken(login.refreshToken);
  assert.notEqual(refreshed.refreshToken, login.refreshToken);
  await assert.rejects(service.refreshToken(login.refreshToken), /Invalid or expired/);
  assert(session.revokedAt);
  await assert.rejects(strategy.validate(payload), /Session expired/);
  await service.login(dto);
  await service.logout(user);
  assert(session.revokedAt);
  await assert.rejects(service.refreshToken(undefined), /Invalid or expired/);
  console.log('PASS: registration, password hashing, role restrictions, duplicate protection, login, inactive accounts, JWT validation, refresh rotation, replay revocation, logout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
