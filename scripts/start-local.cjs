// Explicit local mode keeps the production .env and cookie settings intact.
const path = require('node:path');
const { supervise } = require('./local-supervisor.cjs');
const origin = process.env.LOCAL_FRONTEND_ORIGIN || 'http://localhost:3000';
const frontend = new URL(origin);
if (!['localhost', '127.0.0.1', '[::1]'].includes(frontend.hostname)) {
  throw new Error('LOCAL_FRONTEND_ORIGIN must be a localhost URL');
}
const allowed = new Set([origin, 'http://localhost:3000', 'http://127.0.0.1:3000']);
for (const value of (process.env.CORS_ORIGIN || '').split(',')) if (value.trim() && value !== '*') allowed.add(value.trim());
const runner = supervise({
  cwd: path.resolve(__dirname, '..'),
  compilerEntry: require.resolve('typescript/bin/tsc'),
  appEntry: path.resolve(__dirname, '../dist/main.js'),
  onFatal: () => { process.exitCode = 1; },
  env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '4050',
    AUTH_FRONTEND_URL: origin, CORS_ORIGIN: [...allowed].join(',') },
});
async function shutdown() {
  await runner.stop();
  if (process.connected) process.disconnect();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('message', message => { if (message?.type === 'shutdown') shutdown(); });
