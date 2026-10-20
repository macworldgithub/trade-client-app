const { spawn: spawnProcess } = require('node:child_process');

function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode != null) return Promise.resolve();
  return new Promise(resolve => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      child.removeListener('exit', done);
      child.removeListener('error', done);
      resolve();
    };
    child.once('exit', done);
    child.once('error', done);
    // The process may already have exited during a previous restart. That is OK.
    if (!child.kill('SIGTERM')) return done();
    timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000);
    timer.unref?.();
  });
}

function supervise({ cwd, env, compilerEntry, appEntry, spawn = spawnProcess,
  output = process.stdout, report = console.error, onFatal = () => {}, retryMs = 1500 }) {
  let app = null;
  let stopping = false;
  let retry;
  let pending = Promise.resolve();
  let revision = 0;
  let stopPromise;
  const options = { cwd, env, windowsHide: true };

  function restart() {
    const requested = ++revision;
    clearTimeout(retry);
    pending = pending.then(async () => {
      if (stopping || requested !== revision) return;
      const previous = app;
      app = null;
      await terminate(previous);
      if (stopping || requested !== revision) return;
      const child = spawn(process.execPath, [appEntry], { ...options, stdio: 'inherit' });
      app = child;
      function exited(code) {
        if (stopping || app !== child) return;
        app = null;
        report(`Local backend stopped (${code ?? 'process error'}). Restarting shortly…`);
        retry = setTimeout(restart, retryMs);
      }
      child.once('error', error => { report(`Unable to start local backend: ${error.message}`); exited(1); });
      child.once('exit', exited);
    }).catch(error => { report(error.message); onFatal(); stop(); });
  }

  // Compile and run independently. Nest's Windows watcher can crash when its
  // taskkill command races with another compile/restart and the PID is gone.
  const compiler = spawn(process.execPath, [compilerEntry, '--project', 'tsconfig.build.json',
    '--watch', '--preserveWatchOutput', '--pretty', 'false', '--incremental', 'false'],
  { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
  let text = '';
  compiler.stdout.on('data', chunk => {
    output.write(chunk);
    text += chunk.toString();
    const lines = text.split(/\r?\n/);
    text = lines.pop();
    for (const line of lines) {
      if (/Found 0 errors\. Watching for file changes\./.test(line)) restart();
    }
  });
  compiler.once('error', error => { if (!stopping) { report(error.message); onFatal(); stop(); } });
  compiler.once('exit', code => {
    if (!stopping) { report(`Local compiler stopped (${code}).`); onFatal(); stop(); }
  });

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    clearTimeout(retry);
    stopPromise = (async () => {
      await pending;
      const previous = app;
      app = null;
      await Promise.all([terminate(compiler), terminate(previous)]);
    })();
    return stopPromise;
  }

  return { stop, whenIdle: () => pending };
}

module.exports = { supervise, terminate };
