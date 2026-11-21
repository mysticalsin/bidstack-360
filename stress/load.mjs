import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { API, CAPS, listeningPid, percentile, rssBytes } from './lib.mjs';

export function loadAutocannon() {
  const prefix = '/tmp/stress-tools';
  mkdirSync(prefix, { recursive: true });
  if (!existsSync(prefix + '/package.json')) {
    writeFileSync(prefix + '/package.json', '{"name":"stress-tools","private":true}\n');
  }
  if (!existsSync(prefix + '/node_modules/autocannon/package.json')) {
    execFileSync('npm', ['install', '--prefix', prefix, '--omit=dev', 'autocannon@7.15.0'], {
      stdio: 'inherit',
    });
  }
  return createRequire(prefix + '/package.json')('autocannon');
}

const READS = [
  ['dashboard', '/api/v1/crm/dashboard'],
  ['accounts', '/api/v1/accounts/key'],
  ['pipeline', '/api/v1/opportunities?limit=50'],
  ['pipeline-stages', '/api/v1/pipeline-stages'],
  ['tasks', '/api/v1/tasks?limit=50'],
];

function summarize(times, codes) {
  const total = times.length;
  let errors = 0;
  let serverErrors = 0;
  for (const [code, count] of Object.entries(codes)) {
    const status = Number(code);
    if (status < 200 || status >= 300) errors += count;
    if (status >= 500) serverErrors += count;
  }
  return {
    n: total,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    errorRate: total ? errors / total : 1,
    serverErrors,
    codes,
  };
}

async function shoot(opts) {
  const autocannon = loadAutocannon();
  const times = [];
  const codes = {};
  await new Promise((resolve, reject) => {
    const instance = autocannon(
      { timeout: 10, ...opts },
      (err) => (err ? reject(err) : resolve()),
    );
    instance.on('response', (_client, statusCode, _bytes, responseTime) => {
      if (typeof responseTime === 'number') times.push(responseTime);
      const code = Number(statusCode);
      codes[code] = (codes[code] ?? 0) + 1;
    });
  });
  if (!times.length) throw new Error('autocannon recorded no samples for ' + opts.url);
  return summarize(times, codes);
}

export async function scenarioLoad() {
  const before = rssBytes(listeningPid(4000));
  const ramp = [];
  for (const connections of [1, 10, 20, 40]) {
    const sample = await shoot({
      url: API + '/api/v1/crm/dashboard',
      connections,
      duration: connections === 20 ? 8 : 4,
    });
    ramp.push({ connections, ...sample });
  }
  const reads = [];
  for (const [name, path] of READS) {
    const sample = await shoot({ url: API + path, connections: 20, duration: 8 });
    const pass =
      sample.p95 < CAPS.readP95Ms && sample.p99 < CAPS.readP99Ms && sample.serverErrors === 0;
    reads.push({ name, path, pass, ...sample });
  }
  const write = await shoot({
    url: API + '/api/v1/tasks',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Stress write',
      oppId: null,
      dueDate: null,
      assignee: null,
      status: 'open',
    }),
    connections: 20,
    duration: 8,
  });
  const after = rssBytes(listeningPid(4000));
  return {
    id: 'load',
    ramp,
    reads,
    write: {
      pass: write.p95 < CAPS.writeP95Ms && write.serverErrors === 0,
      ...write,
    },
    apiRssBefore: before,
    apiRssAfter: after,
    pass: reads.every((row) => row.pass) && write.p95 < CAPS.writeP95Ms && write.serverErrors === 0,
  };
}
