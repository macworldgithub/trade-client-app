const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { AuthCookiesService, requestCookie } = require('../dist/auth/auth-cookies.service');
const { CsrfGuard } = require('../dist/auth/csrf.guard');
const { AuthController } = require('../dist/auth/auth.controller');
const mongoose = require('mongoose');
const { AuthSessionSchema } = require('../dist/auth/schemas/auth-session.schema');
const { MfaChallengeSchema } = require('../dist/auth/schemas/mfa-challenge.schema');

(async () => {
  // Exercise real Mongoose casting: mocked session lookups cannot catch Mixed IDs.
  assert.equal(AuthSessionSchema.path('userId').instance, 'ObjectId');
  assert.equal(AuthSessionSchema.path('replacedBySessionId').instance, 'ObjectId');
  assert.equal(MfaChallengeSchema.path('userId').instance, 'ObjectId');
  const Session = mongoose.model('SessionCastingRegression', AuthSessionSchema);
  const userId = new mongoose.Types.ObjectId();
  const lookup = Session.findOne({ userId: String(userId) });
  lookup.cast(Session);
  assert(lookup.getFilter().userId instanceof mongoose.Types.ObjectId,
    'JWT subject strings must be cast to BSON ObjectIds for stored-session lookup');
  const config = new ConfigService({ NODE_ENV: 'production', AUTH_JWT_SECRET: 'test-only-secret-with-at-least-32-bytes', AUTH_FRONTEND_URL: 'https://trade-client-frontend.vercel.app' });
  const cookies = new AuthCookiesService(config);
  const written = [];
  const cleared = [];
  const res = { cookie: (...args) => written.push(args), clearCookie: (...args) => cleared.push(args), setHeader() {} };
  const req = (method, path, cookie = '', headers = {}) => ({ method, path, headers: { cookie }, get: key => headers[key] });
  const guard = new CsrfGuard(cookies);
  const check = request => guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) });
  const { csrfToken } = cookies.csrf(req('GET', '/api/v1/auth/csrf'), res);
  assert(cookies.validCsrf(csrfToken));
  assert(!cookies.validCsrf(csrfToken.slice(0, -1) + '!'));
  assert(!cookies.validCsrf('0.a.b'));
  const originalNow = Date.now;
  Date.now = () => originalNow() + 3600001;
  assert(!cookies.validCsrf(csrfToken), 'expired CSRF tokens must fail');
  Date.now = originalNow;
  const origin = 'https://trade-client-frontend.vercel.app';
  const csrfCookie = `trade_csrf=${csrfToken}`;
  assert.equal(check(req('GET', '/api/v1/auth/me')), true);
  assert.throws(() => check(req('POST', '/api/v1/auth/login')), /security token/);
  assert.throws(() => check(req('POST', '/api/v1/auth/login', csrfCookie, { origin, 'x-csrf-token': 'forged' })), /security token/);
  assert.throws(() => check(req('POST', '/api/v1/auth/login', csrfCookie, { origin: 'https://attacker.example', 'x-csrf-token': csrfToken })), /security token/);
  assert.equal(check(req('POST', '/api/v1/auth/login', csrfCookie, { origin, 'x-csrf-token': csrfToken })), true);
  assert.throws(() => check(req('PATCH', '/api/v1/orders/123', 'trade_access=jwt')), /security token/);
  assert.equal(check(req('POST', '/api/v1/partscheck/rfq')), true, 'integration webhook is independent of browser sessions');
  assert.equal(requestCookie(req('GET', '/', 'trade_access=one; trade_access=two'), 'trade_access'), null);
  const service = {
    login: async () => ({ accessToken: 'access-value', refreshToken: 'refresh-value', expiresAt: 123, user: { id: 'user' } }),
    refreshToken: async token => { assert.equal(token, 'refresh-value'); return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 456 }; },
    logoutSession: async token => { assert.equal(token, 'refresh-value'); return { message: 'Logged out' }; },
  };
  const controller = new AuthController(service, cookies);
  const login = await controller.login({}, req('POST', '/auth/login'), res);
  assert.equal(login.user.id, 'user');
  assert(!('accessToken' in login));
  assert(!('refreshToken' in login));
  const beforeOtp = written.length;
  const otpChallenge = { requiresEmailOtp: true, challengeId: 'a'.repeat(64), expiresIn: 600, resendAfter: 60 };
  const otpController = new AuthController({
    login: async () => otpChallenge,
    verifyEmailOtp: async () => ({ accessToken: 'verified-access', refreshToken: 'verified-refresh', expiresAt: 789, user: { id: 'verified' } }),
  }, cookies);
  const otpResponse = { ...res, clearCookie() {} };
  assert.deepEqual(await otpController.login({}, req('POST', '/auth/login'), otpResponse), otpChallenge);
  assert.equal(written.length, beforeOtp, 'password-only login cannot issue session cookies before OTP');
  const completed = await otpController.verifyEmailOtp({ challengeId: otpChallenge.challengeId, code: '012345' }, req('POST', '/auth/email-otp/verify'), otpResponse);
  assert.equal(completed.user.id, 'verified');
  assert(!('accessToken' in completed));
  assert(!('refreshToken' in completed));
  assert(written.length > beforeOtp, 'verified OTP sets HttpOnly session cookies');
  for (const [name, , options] of written) {
    assert(options.httpOnly, name);
    assert(options.secure, name);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
    assert.equal(options.domain, undefined);
  }
  const refreshed = await controller.refresh(req('POST', '/auth/refresh', 'trade_refresh=refresh-value'), res);
  assert.deepEqual(refreshed, { expiresAt: 456 });
  await controller.logout(req('POST', '/auth/logout', 'trade_refresh=refresh-value'), res);
  assert.deepEqual(cleared.map(([name]) => name), ['trade_access', 'trade_refresh']);
  assert(cleared.every(([, options]) => options.httpOnly && options.secure));
  const again = cookies.csrf(req('GET', '/auth/csrf', csrfCookie), res);
  assert.equal(again.csrfToken, csrfToken, 'existing valid CSRF cookie is reused across tabs');
  console.log('PASS: cookie security flags, token-free JSON responses, cookie refresh, logout without access cookie, CSRF signing and expiry, forged-token rejection, origin validation, and cookie-protected mutations.');
})().catch(error => { console.error(error); process.exitCode = 1; });
