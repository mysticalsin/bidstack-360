// Stops the supervisor's children (container/entrypoint.mjs) on shutdown.
// WHY wait: exiting right after the signal ends the container while the API
// is still draining requests and the worker its active job; the runtime then
// kills them mid-write. Only the ChildProcess handles the supervisor stored
// are signalled, never a raw pid, which could belong to a reused process.

export const STOP_GRACE_MS = 30_000;

function stopOne(name, child, graceMs, log) {
  return new Promise((resolve) => {
    let forced = false;
    const timer = setTimeout(() => {
      forced = true;
      log(`${name} still running after ${graceMs}ms; sending SIGKILL`);
      child.kill('SIGKILL');
    }, graceMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ name, code, signal, forced });
    });
    child.kill('SIGTERM');
  });
}

/**
 * SIGTERM each running child, wait for it to exit, SIGKILL any child still
 * running after `graceMs`. Resolves to the supervisor's exit code: 0 when
 * every child stopped by itself with code 0 (or by the SIGTERM), 1 otherwise.
 *
 * @param {Array<[string, import('node:child_process').ChildProcess | null]>} children
 * @param {{ graceMs?: number, log?: (message: string) => void }} [options]
 * @returns {Promise<number>}
 */
export async function stopChildren(children, { graceMs = STOP_GRACE_MS, log = () => {} } = {}) {
  const running = children.filter(
    ([, child]) => child && child.exitCode === null && child.signalCode === null,
  );
  const results = await Promise.all(running.map(([name, child]) => stopOne(name, child, graceMs, log)));
  for (const r of results) {
    log(`${r.name} stopped (code ${r.code}, signal ${r.signal}${r.forced ? ', forced' : ''})`);
  }
  const clean = results.every((r) => !r.forced && (r.code === 0 || r.signal === 'SIGTERM'));
  return clean ? 0 : 1;
}
