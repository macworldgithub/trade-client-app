const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { ConfigService } = require('@nestjs/config');
const { authAllowedOrigins, authFrontendOrigin } = require('../dist/auth/auth-origins');
const { configureHttp } = require('../dist/configure-http');
const { AuthCookiesService } = require('../dist/auth/auth-cookies.service');

(async () => {
  const deployment = JSON.parse(fs.readFileSync(require.resolve('../vercel.json'), 'utf8'));
  assert.equal(deployment.env.NODE_OPTIONS, '--experimental-require-module');
  const cwd = require('node:path').resolve(__dirname, '..');
  const disabled = spawnSync(process.execPath, ['--no-experimental-require-module', '-e',
    "try { require('@nestjs/core'); process.exitCode = 1; } catch (e) { if (e.code !== 'ERR_REQUIRE_ESM') throw e; }"], { cwd, encoding: 'utf8' });
  assert.equal(disabled.status, 0, disabled.stderr);
  const enabled = spawnSync(process.execPath, [deployment.env.NODE_OPTIONS, '-e',
    "for (const name of ['@nestjs/core', '@nestjs/common', '@nestjs/platform-express', '@nestjs/mongoose', '@nestjs/jwt']) require(name);"], { cwd, encoding: 'utf8' });
  assert.equal(enabled.status, 0, enabled.stderr);
  const frontend = 'https://trade-client-frontend.vercel.app';
  const env = { NODE_ENV: 'production', AUTH_FRONTEND_URL: frontend, CORS_ORIGIN: frontend };
  assert.equal(authFrontendOrigin(env), frontend);
  assert.equal(authFrontendOrigin({ VERCEL: '1' }), frontend);
  assert.deepEqual(authAllowedOrigins(env), [frontend]);
  assert.throws(() => authFrontendOrigin({ NODE_ENV: 'production', AUTH_FRONTEND_URL: 'http://localhost:3000' }), /HTTPS/);
  assert.equal(authFrontendOrigin({ NODE_ENV: 'development' }), 'http://localhost:3000');
  let cors;
  let prefix;
  let cache;
  const app = {
    getHttpAdapter: () => ({ getInstance: () => ({ set() {} }) }),
    use: fn => fn({}, { setHeader(name, value) { if (name === 'Cache-Control') cache = value; } }, () => {}),
    setGlobalPrefix: value => { prefix = value; }, useGlobalPipes() {},
    enableCors: value => { cors = value; },
  };
  configureHttp(app, env);
  assert.equal(prefix, 'api/v1');
  assert.equal(cache, 'no-store');
  assert.deepEqual(cors.origin, [frontend]);
  assert(cors.allowedHeaders.includes('X-CSRF-Token'));
  const cookies = new AuthCookiesService(new ConfigService(env));
  const written = [];
  cookies.setSession({ cookie: (...args) => written.push(args), setHeader() {} }, { accessToken: 'fake', refreshToken: 'fake' });
  assert(written.every(([, , options]) => options.secure && options.httpOnly && options.sameSite === 'lax' && !options.domain));

  const source = fs.readFileSync(require.resolve('../api/index.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  let builds = 0;
  let configured = 0;
  let fail = false;
  const context = { exports: {}, console: { error() {} }, require(name) {
    if (name === 'reflect-metadata') return {};
    if (name === '@nestjs/core') return { NestFactory: { create: async () => {
      builds++;
      if (fail) throw new Error('private-internal-failure');
      await new Promise(resolve => setTimeout(resolve, 5));
      return { init: async () => {} };
    } } };
    if (name === '@nestjs/platform-express') return { ExpressAdapter: class {} };
    if (name === '../src/app.module') return { AppModule: class {} };
    if (name === '../src/configure-http') return { configureHttp() { configured++; } };
    if (name === 'express') return () => (req, res) => { res.headersSent = true; res.emit('finish'); };
    throw new Error(`Unexpected module ${name}`);
  } };
  function response() {
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.body = body; res.headersSent = true; return res; };
    return res;
  }
  vm.runInNewContext(js, context);
  await Promise.all([context.exports.default({}, response()), context.exports.default({}, response())]);
  assert.equal(builds, 1, 'concurrent cold starts share the same application');
  assert.equal(configured, 1);
  const retryContext = { ...context, exports: {} };
  vm.runInNewContext(js, retryContext);
  fail = true;
  const failed = response();
  await retryContext.exports.default({}, failed);
  assert.equal(failed.statusCode, 503);
  assert(!JSON.stringify(failed.body).includes('private-internal-failure'));
  assert(!JSON.stringify(failed.body).includes('SUPABASE'));
  fail = false;
  const retried = response();
  await retryContext.exports.default({}, retried);
  assert(retried.headersSent);
  console.log('PASS: production domains, HTTPS enforcement, cookies, CSRF CORS headers, shared HTTP configuration, concurrent serverless startup, safe errors, and initialization retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
