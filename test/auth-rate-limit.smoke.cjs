const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { Reflector } = require('@nestjs/core');
const express = require('express');
const { AuthRateLimitGuard, AUTH_RATE_POLICIES, rateLimitNetwork } = require('../dist/auth/auth-rate-limit.guard');
const { AuthController } = require('../dist/auth/auth.controller');

(async () => {
  const rows = new Map();
  let failStore = false;
  let duplicate = false;
  const counters = {
    async findOneAndUpdate(query, update, options) {
      if (failStore) throw new Error('database unavailable');
      if (duplicate && options.upsert) {
        duplicate = false;
        rows.set(query._id, { count: 0, expiresAt: update.$setOnInsert.expiresAt });
        throw Object.assign(new Error('duplicate insert race'), { code: 11000 });
      }
      const row = rows.get(query._id) || { count: 0, expiresAt: update.$setOnInsert?.expiresAt };
      row.count += update.$inc.count;
      rows.set(query._id, row);
      return { ...row };
    },
  };
  const config = new ConfigService({ AUTH_JWT_SECRET: 'test-only-secret-with-at-least-32-bytes' });
  const reflector = new Reflector();
  const guard = new AuthRateLimitGuard(reflector, config, counters);
  let headers = {};
  const attempt = (method, email, ip = '192.0.2.1', target = guard) => target.canActivate({
    getHandler: () => AuthController.prototype[method],
    switchToHttp: () => ({
      getRequest: () => ({ body: { email }, ip, headers: { 'x-forwarded-for': '203.0.113.99' } }),
      getResponse: () => ({ setHeader: (key, value) => { headers[key] = value; } }),
    }),
  });
  const limited = error => error.getStatus() === 429 && error.getResponse().code === 'AUTH_RATE_LIMITED';
  for (let i = 0; i < AUTH_RATE_POLICIES.login.email; i++) await attempt('login', 'USER@example.com');
  await assert.rejects(attempt('login', ' user@EXAMPLE.com '), limited);
  assert(Number(headers['Retry-After']) > 0);
  assert.equal(headers['Cache-Control'], 'no-store');
  await attempt('login', 'different@example.com');
  await assert.rejects(attempt('login', 'user@example.com', '198.51.100.1'), limited, 'email limits apply across network changes');
  assert([...rows.keys()].every(id => /^[a-f0-9]{64}$/.test(id)), 'identities must be HMAC protected');

  rows.clear();
  const otherWorker = new AuthRateLimitGuard(reflector, config, counters);
  const concurrent = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => attempt('login', 'concurrent@example.com', '192.0.2.1', i % 2 ? guard : otherWorker)));
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, AUTH_RATE_POLICIES.login.email);
  assert.equal(concurrent.filter(result => result.status === 'rejected' && limited(result.reason)).length, 5);

  rows.clear();
  for (let i = 0; i < AUTH_RATE_POLICIES.register.ip; i++) await attempt('register', `user${i}@example.com`);
  await assert.rejects(attempt('register', 'another@example.com'), limited, 'changing email must not bypass the network limit');
  await attempt('register', 'another@example.com', '198.51.100.1');

  rows.clear();
  const realNow = Date.now;
  const windowMs = AUTH_RATE_POLICIES['forgot-password'].windowMs;
  const start = Math.floor(realNow() / windowMs) * windowMs;
  try {
    Date.now = () => start + 1000;
    for (let i = 0; i < 5; i++) await attempt('forgotPassword', 'unknown@example.com');
    await assert.rejects(attempt('forgotPassword', 'unknown@example.com'), limited);
    Date.now = () => start + windowMs + 1;
    await attempt('forgotPassword', 'unknown@example.com');
  } finally { Date.now = realNow; }

  rows.clear();
  duplicate = true;
  await attempt('login', 'race@example.com');
  failStore = true;
  await assert.rejects(attempt('login', 'offline@example.com'), error => error.getStatus() === 503);
  failStore = false;
  await attempt('csrf', undefined);
  await attempt('logout', undefined);
  assert.equal(reflector.get('auth-rate-policy', AuthController.prototype.resendVerification),
    reflector.get('auth-rate-policy', AuthController.prototype.forgotPassword),
    'legacy recovery URLs must share the same rate-limit bucket');
  for (const method of ['register', 'login', 'forgotPassword', 'resendVerification', 'verifyEmail', 'resetPassword', 'refresh', 'enrollTotp', 'confirmTotp', 'disableTotp', 'verifyTotp', 'createUser']) {
    assert(reflector.get('auth-rate-policy', AuthController.prototype[method]), `${method} must be protected`);
  }

  assert.equal(rateLimitNetwork('::ffff:192.0.2.1'), rateLimitNetwork('192.0.2.1'));
  assert.equal(rateLimitNetwork('2001:db8:abcd:1::1'), rateLimitNetwork('2001:0db8:abcd:0001::ffff'));
  assert.notEqual(rateLimitNetwork('2001:db8:abcd:1::1'), rateLimitNetwork('2001:db8:abcd:2::1'));
  assert.equal(rateLimitNetwork(undefined), 'unknown');

  const app = express();
  app.set('trust proxy', ['loopback']);
  const req = Object.create(app.request);
  Object.defineProperty(req, 'app', { value: app });
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '198.51.100.10' } });
  req.headers = { 'x-forwarded-for': '203.0.113.77' };
  assert.equal(req.ip, '198.51.100.10', 'untrusted clients cannot override their network identity');
  console.log('PASS: login and recovery limits, email normalization, independent network/account limits, shared-worker concurrency, Retry-After, window reset, insertion races, storage outage handling, route coverage, IPv6 normalization, and forwarded-IP spoof protection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
