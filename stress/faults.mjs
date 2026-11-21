import { spawn } from 'node:child_process';

import {
  CAPS,
  http,
  listeningPid,
  messageOf,
  psql,
  redis,
  rssBytes,
  sleep,
  waitFor,
} from './lib.mjs';

function companyBody(name) {
  return {
    name,
    legalName: null,
    domain: null,
    industry: null,
    employeeCount: null,
    countryCode: null,
    address: null,
    billingEmail: null,
    taxId: null,
    logoUrl: null,
    website: null,
  };
}

async function remeasure(port) {
  const pid = listeningPid(port);
  await sleep(200);
  return { pid: listeningPid(port), rss: rssBytes(listeningPid(port)) };
}

function startRedis() {
  spawn(
    'redis-server',
    [
      '--bind',
      '127.0.0.1',
      '--port',
      '6380',
      '--daemonize',
      'yes',
      '--maxmemory',
      '256mb',
      '--maxmemory-policy',
      'noeviction',
      '--save',
      '',
      '--appendonly',
      'no',
      '--logfile',
      '/tmp/redis-6380.log',
      '--pidfile',
      '/tmp/redis-6380.pid',
      '--dir',
      '/tmp',
    ],
    { stdio: 'ignore' },
  );
}

export async function scenarioFaults() {
  const readyBefore = await http('GET', '/readyz', { timeoutMs: 5_000 });
  const redisBefore = await remeasure(6380);
  const redisDownAt = Date.now();
  try {
    redis(['SHUTDOWN', 'NOSAVE']);
  } catch {
    // the cli connection drops when the server exits
  }
  await sleep(500);
  const redisGone = await remeasure(6380);
  const create = await http('POST', '/api/v1/companies', {
    body: companyBody('Synthetic Redis Down ' + Date.now()),
    timeoutMs: 8_000,
  });
  const readyDown = await http('GET', '/readyz', { timeoutMs: 5_000 });
  const authed = await http('GET', '/api/v1/tasks?limit=1', { timeoutMs: 8_000 });
  const limited = [];
  for (let i = 0; i < 3; i++) {
    limited.push(
      (
        await http('POST', '/api/v1/migrations/start-csv', {
          body: {
            source: 'CSV',
            entityType: 'companies',
            rows: [{ Name: 'RedisDown ' + Date.now() + ' ' + i }],
            mappings: { Name: 'company.name' },
            dedupStrategy: 'skip',
          },
          timeoutMs: 8_000,
        })
      ).status,
    );
  }
  await sleep(Math.max(0, CAPS.faultDownMs - (Date.now() - redisDownAt)));
  startRedis();
  const recoveredAt = Date.now();
  const readyUp = await waitFor(async () => {
    const res = await http('GET', '/readyz', { timeoutMs: 3_000 });
    return res.status === 200 && res.json?.redis === true ? res : null;
  }, CAPS.recoveryMs);
  const tasksUp = await http('GET', '/api/v1/tasks?limit=1', { timeoutMs: 5_000 });
  const redisRecoverMs = readyUp ? Date.now() - recoveredAt : null;

  const pgBefore = await remeasure(5432);
  const pgDownAt = Date.now();
  spawn('sudo', ['pg_ctlcluster', '16', 'main', 'stop', '-m', 'fast'], { stdio: 'ignore' });
  await waitFor(async () => {
    const res = await http('GET', '/readyz', { timeoutMs: 4_000 });
    return res.json && res.json.db === false ? res : null;
  }, 15_000);
  const readyPg = await http('GET', '/readyz', { timeoutMs: 5_000 });
  const authPg = await http('GET', '/api/v1/tasks?limit=1', { timeoutMs: 8_000 });
  const pgGone = await remeasure(5432);
  await sleep(Math.max(0, CAPS.faultDownMs - (Date.now() - pgDownAt)));
  spawn('sudo', ['pg_ctlcluster', '16', 'main', 'start'], { stdio: 'ignore' });
  const pgBackAt = Date.now();
  const readyPgUp = await waitFor(async () => {
    const res = await http('GET', '/readyz', { timeoutMs: 3_000 });
    return res.status === 200 && res.json?.db === true ? res : null;
  }, CAPS.recoveryMs);
  const tasksPg = await http('GET', '/api/v1/tasks?limit=1', { timeoutMs: 5_000 });
  const pgRecoverMs = readyPgUp ? Date.now() - pgBackAt : null;
  if (!listeningPid(4002)) {
    const cmd =
      'export PATH="$HOME/.nvm/versions/node/v24.22.3/bin:$PATH"; set -a; source /tmp/stress.env; set +a; cd /agent/repos/bidstack-360; pnpm --filter @bidstack/worker exec tsx src/main.ts';
    spawn('tmux', ['-f', '/exec-daemon/tmux.portal.conf', 'send-keys', '-t', 'bidstack-worker:0.0', cmd, 'C-m'], {
      stdio: 'ignore',
    });
    await waitFor(async () => listeningPid(4002), 30_000);
  }
  const running = psql(
    `SELECT count(*) FROM migration_jobs WHERE status = 'RUNNING' AND processed_rows = 0 AND error_rows = 0 AND COALESCE(meta->>'progressAt', created_at::text)::timestamptz < now() - interval '15 minutes'`,
  );

  const createHung = create.aborted || create.status === 0;
  return {
    id: 'faults',
    readyBefore: { status: readyBefore.status, body: readyBefore.json },
    redis: {
      before: redisBefore,
      afterStop: redisGone,
      create: { status: create.status, ms: create.ms, aborted: !!create.aborted, body: create.text.slice(0, 240) },
      createHung,
      coveredBy: createHung ? 376 : null,
      readyz: { status: readyDown.status, body: readyDown.json, ms: readyDown.ms },
      auth: { status: authed.status, ms: authed.ms, message: messageOf(authed) },
      startCsvWhileDown: limited,
      recoverMs: redisRecoverMs,
      tasksAfter: tasksUp.status,
    },
    postgres: {
      before: pgBefore,
      afterStop: pgGone,
      readyz: { status: readyPg.status, body: readyPg.json, ms: readyPg.ms },
      auth: { status: authPg.status, ms: authPg.ms, message: messageOf(authPg) },
      authFailClosed: authPg.status !== 200,
      recoverMs: pgRecoverMs,
      tasksAfter: tasksPg.status,
    },
    staleRunning: Number(running),
    pass:
      !createHung &&
      readyDown.json?.db === true &&
      readyDown.json?.redis === false &&
      authPg.status !== 200 &&
      redisRecoverMs != null &&
      redisRecoverMs <= CAPS.recoveryMs &&
      pgRecoverMs != null &&
      pgRecoverMs <= CAPS.recoveryMs,
  };
}

export async function scenarioBoot() {
  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.nvm/versions/node/v24.22.3/bin:${process.env.PATH}`,
    NODE_ENV: 'development',
    POLO_DATA_MODE: 'demo',
    DATABASE_URL: 'postgres://bidstack:bidstack@127.0.0.1:1/bidstack',
    REDIS_URL: 'redis://127.0.0.1:6380',
    PORT_API: '4010',
    HOST: '127.0.0.1',
    API_RATE_LIMIT_MAX: '100000',
    LOG_LEVEL: 'warn',
  };
  const child = spawn('pnpm', ['--filter', '@bidstack/api', 'exec', 'tsx', 'src/main.ts'], {
    cwd: '/agent/repos/bidstack-360',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout.on('data', (chunk) => {
    text += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    text += chunk.toString();
  });
  const started = Date.now();
  let exitCode = null;
  const finished = new Promise((resolve) => child.once('exit', (code) => {
    exitCode = code;
    resolve();
  }));
  const probe = await Promise.race([
    finished.then(() => 'exited'),
    (async () => {
      await sleep(12_000);
      return 'still-running';
    })(),
  ]);
  let readyz = null;
  if (probe === 'still-running') {
    readyz = await http('GET', '/readyz', { base: 'http://127.0.0.1:4010', timeoutMs: 4_000 });
    child.kill('SIGTERM');
    await Promise.race([finished, sleep(3_000)]);
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  const migrate = spawn('node', ['scripts/run-safe-migrate-deploy.mjs'], {
    cwd: '/agent/repos/bidstack-360',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let migrateText = '';
  migrate.stdout.on('data', (chunk) => {
    migrateText += chunk.toString();
  });
  migrate.stderr.on('data', (chunk) => {
    migrateText += chunk.toString();
  });
  const migrateExit = await Promise.race([
    new Promise((resolve) => migrate.once('exit', resolve)),
    sleep(15_000).then(() => 'timeout'),
  ]);
  if (migrateExit === 'timeout') migrate.kill('SIGKILL');
  const after = rssBytes(child.pid);
  return {
    id: 'boot-db-down',
    pass: probe === 'exited' || (readyz && readyz.json && readyz.json.db === false && readyz.ms < 5_000),
    probe,
    ms: Date.now() - started,
    exitCode,
    readyz,
    log: text.slice(-400),
    migrate: { exit: migrateExit, log: migrateText.slice(-300) },
    rssAfterStop: after,
  };
}
