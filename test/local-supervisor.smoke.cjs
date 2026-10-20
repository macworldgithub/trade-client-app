const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { supervise, terminate } = require('../scripts/local-supervisor.cjs');

class Child extends EventEmitter {
  constructor() { super(); this.stdout = new PassThrough(); this.exitCode = null; this.signalCode = null; this.stops = 0; }
  kill(signal) {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.stops++;
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
  crash() { this.exitCode = 1; this.emit('exit', 1); }
}

(async () => {
  const children = [];
  let fatal = 0;
  const runner = supervise({ cwd: '.', env: {}, compilerEntry: 'compiler', appEntry: 'app', retryMs: 10,
    output: { write() {} }, report() {}, onFatal: () => fatal++,
    spawn(executable, args) {
      assert.equal(executable, process.execPath, 'spawn Node directly, without a shell or taskkill');
      const child = new Child(); children.push({ child, args }); return child;
    },
  });
  const compiler = children[0].child;
  compiler.stdout.write('Found 0 errors. Watching for ');
  assert.equal(children.length, 1);
  compiler.stdout.write('file changes.\n');
  await runner.whenIdle();
  assert.equal(children.length, 2, 'successful compilation starts the app');
  const first = children[1].child;
  compiler.stdout.write('Found 1 error. Watching for file changes.\n');
  await runner.whenIdle();
  assert.equal(first.stops, 0, 'compile errors keep the last working app running');
  compiler.stdout.write('Found 0 errors. Watching for file changes.\nFound 0 errors. Watching for file changes.\n');
  await runner.whenIdle();
  assert.equal(first.stops, 1);
  assert.equal(children.length, 3, 'rapid compile events are coalesced into one restart');
  const second = children[2].child;
  second.crash();
  await new Promise(resolve => setTimeout(resolve, 30));
  await runner.whenIdle();
  assert.equal(children.length, 4, 'a crashed app restarts without requiring a code edit');
  await terminate(second); // Already-exited child is safe to stop again.
  await runner.stop();
  await runner.stop();
  assert.equal(compiler.stops, 1);
  assert.equal(children[3].child.stops, 1);
  assert.equal(fatal, 0);
  compiler.stdout.write('Found 0 errors. Watching for file changes.\n');
  await runner.whenIdle();
  assert.equal(children.length, 4, 'shutdown prevents future restarts');
  console.log('PASS: initial compilation, split output, compile-error preservation, rapid rebuilds, already-exited processes, crash recovery, and clean shutdown.');
})().catch(error => { console.error(error); process.exitCode = 1; });
