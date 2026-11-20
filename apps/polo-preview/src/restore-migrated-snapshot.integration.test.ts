// WHY: snapshotFile() pg_dumps one database. Cluster roles are not in that
// dump. After restore, _prisma_migrations already lists the app_role
// migrations, so migrate deploy never creates the role and ALTER ROLE fails
// the boot. A fully migrated snapshot must come back on a fresh initdb
// cluster with the same rows, a login for app_role, its grants, and no
// DELETE on audit_log.
//
// The drill is off unless POLO_RESTORE_DRILL=1. It uses a temp directory and
// free ports. It does not use sudo, /data, /app, or /etc/hosts, and it only
// signals processes it started.
//
// Needs Postgres 16 tools (initdb, pg_dump, pg_restore) and the pgvector
// package for that server. Without pgvector, migrate fails with P3018 on
// 20260527000000_rfp_vector_indexes. redis-server must be on PATH.
//
// TEST COMMAND:
// POLO_RESTORE_DRILL=1 pnpm --filter @bidstack/polo-preview exec vitest run src/restore-migrated-snapshot.integration.test.ts

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(join(here, '../../..'));
const pgBin = '/usr/lib/postgresql/16/bin';
const FIXTURE_PASSWORD = "fix'ture\\pass";
const INTERNAL_KEY = 'fixture-internal-key';
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CLERK_ORG = 'org_fixture_restore';
const AUDIT_ACTION = 'fixture.restore';
const SKIP = 'set POLO_RESTORE_DRILL=1 to run the restore drill (Postgres 16 with pgvector, initdb, pg_dump, pg_restore, and redis-server)';

const API_STUB = `import http from 'node:http';
const port = Number(process.env.PORT || 4020);
http.createServer((req, res) => {
  res.writeHead(req.url && req.url.startsWith('/livez') ? 200 : 404);
  res.end('ok');
}).listen(port, '127.0.0.1');
`;
const WORKER_STUB = 'setInterval(() => {}, 1 << 30);\n';

const DROP_APP_ROLE = `
REVOKE ALL PRIVILEGES ON DATABASE bidstack FROM app_role;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM app_role;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_role;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_role;
DROP ROLE app_role;
`;

function baseEnv(): NodeJS.ProcessEnv {
  const path = [pgBin, process.env.PATH].filter(Boolean).join(':');
  return {
    PATH: path,
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.env.LC_ALL,
  };
}

function toolExists(name: string): boolean {
  return spawnSync(name, ['--version'], { encoding: 'utf8', env: baseEnv() }).status === 0;
}

function toolsReady(): boolean {
  return ['initdb', 'pg_dump', 'pg_restore', 'psql', 'createdb', 'pg_ctl', 'redis-server'].every(toolExists);
}

function guard(ctx: { skip: (note: string) => void }): boolean {
  if (process.env.POLO_RESTORE_DRILL !== '1') {
    ctx.skip(SKIP);
    return false;
  }
  if (!toolsReady()) throw new Error(`POLO_RESTORE_DRILL=1 but ${SKIP}`);
  return true;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = baseEnv()): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  return { status: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function must(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const res = run(cmd, args, env);
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}\n${res.stderr.slice(-2000)}`);
  }
  return res.stdout;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

type Layout = {
  root: string;
  dataDir: string;
  httpPort: number;
  apiPort: number;
  pgPort: number;
  redisPort: number;
  apiEntry: string;
  workerEntry: string;
};

async function makeLayout(): Promise<Layout> {
  const root = mkdtempSync(join(tmpdir(), 'polo-drill-'));
  const [httpPort, apiPort, pgPort, redisPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  const apiEntry = join(root, 'api-stub.mjs');
  const workerEntry = join(root, 'worker-stub.mjs');
  writeFileSync(apiEntry, API_STUB);
  writeFileSync(workerEntry, WORKER_STUB);
  return { root, dataDir: join(root, 'data'), httpPort, apiPort, pgPort, redisPort, apiEntry, workerEntry };
}

function psqlOwner(port: number, sql: string): string {
  return must('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'bidstack', '-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-tAc', sql]).trim();
}

function childPids(pid: number): number[] {
  const file = `/proc/${pid}/task/${pid}/children`;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

type Boot = { child: ChildProcess; layout: Layout; rawLogs: () => string; logs: () => string };

function trackedPids(boot: Boot): number[] {
  const pids = new Set<number>();
  const walk = (pid: number) => {
    if (pids.has(pid)) return;
    pids.add(pid);
    for (const child of childPids(pid)) walk(child);
  };
  if (boot.child.pid) walk(boot.child.pid);
  const pidFile = join(boot.layout.dataDir, 'pg', 'postmaster.pid');
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // That process already exited.
    }
  }
}

function startEntrypoint(layout: Layout, extra: Record<string, string> = {}): Boot {
  mkdirSync(layout.dataDir, { recursive: true });
  let logs = '';
  const child = spawn(process.execPath, [join(repo, 'apps/polo-preview/container/entrypoint.mjs')], {
    cwd: repo,
    env: {
      ...baseEnv(),
      POLO_INTERNAL_KEY: INTERNAL_KEY,
      POLO_APP_DB_PASSWORD: FIXTURE_PASSWORD,
      POLO_APP_ROOT: repo,
      POLO_DATA_DIR: layout.dataDir,
      POLO_HTTP_PORT: String(layout.httpPort),
      POLO_API_PORT: String(layout.apiPort),
      POLO_PG_PORT: String(layout.pgPort),
      POLO_REDIS_PORT: String(layout.redisPort),
      POLO_REDIS_HOST: '127.0.0.1',
      POLO_PG_SOCKET: layout.root,
      POLO_API_ENTRY: layout.apiEntry,
      POLO_WORKER_ENTRY: layout.workerEntry,
      POLO_MIGRATE_STAGING: join(layout.root, 'polo-migrate'),
      POLO_SNAPSHOT_DIR: join(layout.root, 'snapshot'),
      POLO_SNAPSHOT_TGZ: join(layout.root, 'snapshot.tgz'),
      POLO_RESTORE_DIR: join(layout.root, 'restore'),
      POLO_RESTORE_DRILL: '1',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (chunk: Buffer) => {
    logs += chunk.toString();
    if (logs.length > 80_000) logs = logs.slice(-60_000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  return {
    child,
    layout,
    rawLogs: () => logs,
    logs: () => logs.split(FIXTURE_PASSWORD).join('[redacted]').split(INTERNAL_KEY).join('[redacted]'),
  };
}

function stopBoot(boot: Boot | null): void {
  if (!boot) return;
  const pids = trackedPids(boot);
  signalPids(pids, 'SIGTERM');
  run('pg_ctl', ['-D', join(boot.layout.dataDir, 'pg'), '-m', 'fast', '-w', 'stop']);
  signalPids(pids, 'SIGKILL');
}

type State = { phase?: string; detail?: string };

function getState(port: number): Promise<State> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/__internal/state',
        headers: { 'x-polo-internal-key': INTERNAL_KEY },
        timeout: 2000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as State);
          } catch {
            resolve({});
          }
        });
      },
    );
    req.on('error', () => resolve({}));
    req.on('timeout', () => {
      req.destroy();
      resolve({});
    });
  });
}

async function waitForPhase(port: number, accept: (state: State) => boolean, timeoutMs: number): Promise<State> {
  const start = Date.now();
  let last: State = {};
  while (Date.now() - start < timeoutMs) {
    last = await getState(port);
    if (accept(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}

function putSnapshot(port: number, file: string): Promise<{ status: number; body: string }> {
  const size = statSync(file).size;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'PUT',
        path: '/__internal/restore',
        headers: {
          'x-polo-internal-key': INTERNAL_KEY,
          'content-type': 'application/gzip',
          'content-length': String(size),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    createReadStream(file).pipe(req);
  });
}

function postSeed(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/__internal/seed',
        headers: { 'x-polo-internal-key': INTERNAL_KEY, 'content-length': '0' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

type Source = { dir: string; port: number };

async function startSource(): Promise<Source> {
  const dir = mkdtempSync(join(tmpdir(), 'polo-source-'));
  const port = await freePort();
  const pgdata = join(dir, 'pg');
  must('initdb', ['-D', pgdata, '-U', 'bidstack', '--auth=trust', '-E', 'UTF8']);
  must('pg_ctl', ['-D', pgdata, '-l', join(dir, 'postgres.log'), '-w', '-o', `-h 127.0.0.1 -p ${port} -k ${dir}`, 'start']);
  must('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'bidstack', 'bidstack']);
  const prisma = join(repo, 'packages/db/node_modules/.bin/prisma');
  must(
    prisma,
    ['migrate', 'deploy', '--schema', join(repo, 'packages/db/prisma/schema.prisma')],
    { ...baseEnv(), DATABASE_URL: `postgres://bidstack:bidstack@127.0.0.1:${port}/bidstack` },
  );
  must('psql', [
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'bidstack',
    '-d',
    'bidstack',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO orgs (id, clerk_org, name) VALUES ('${ORG_ID}', '${CLERK_ORG}', 'Fixture Restore Org');
     INSERT INTO audit_log (org_id, action, target_type) VALUES ('${ORG_ID}', '${AUDIT_ACTION}', 'test');
     GRANT UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log TO app_role;`,
  ]);
  return { dir, port };
}

function stopSource(source: Source | null, remove = false): void {
  if (!source) return;
  run('pg_ctl', ['-D', join(source.dir, 'pg'), '-m', 'immediate', '-w', 'stop']);
  if (remove) rmSync(source.dir, { recursive: true, force: true });
}

function packSnapshot(source: Source): { tgz: string; orgs: string; audits: string; tables: string } {
  const snap = join(source.dir, 'snap');
  mkdirSync(snap);
  // Same pg_dump flags as snapshotFile() in container/entrypoint.mjs.
  // The port is this source cluster; production uses 5432.
  must('pg_dump', ['-h', '127.0.0.1', '-p', String(source.port), '-U', 'bidstack', '-Fc', '-f', join(snap, 'db.dump'), 'bidstack']);
  writeFileSync(join(snap, 'meta.json'), JSON.stringify({ at: '2026-01-01T00:00:00.000Z', bootId: 'fixture-boot' }));
  const tgz = join(source.dir, 'snapshot.tgz');
  must('tar', ['-czf', tgz, '-C', snap, 'db.dump', 'meta.json']);
  return {
    tgz,
    orgs: psqlOwner(source.port, 'SELECT count(*) FROM orgs'),
    audits: psqlOwner(source.port, `SELECT count(*) FROM audit_log WHERE action = '${AUDIT_ACTION}'`),
    tables: psqlOwner(source.port, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"),
  };
}

function flag(expr: string): string {
  return `CASE WHEN ${expr} THEN 't' ELSE 'f' END`;
}

function roleFacts(port: number): string {
  return psqlOwner(
    port,
    `SELECT ${flag('rolcanlogin')} || '|' || ${flag('rolsuper')} || '|' || ${flag('rolcreatedb')} || '|' || ${flag('rolcreaterole')} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.audit_log', 'SELECT')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.audit_log', 'INSERT')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.audit_log', 'UPDATE')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.audit_log', 'DELETE')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.audit_log', 'TRUNCATE')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.orgs', 'SELECT')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.orgs', 'INSERT')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.orgs', 'UPDATE')")} || '|' ||
            ${flag("has_table_privilege('app_role', 'public.orgs', 'DELETE')")} || '|' ||
            ${flag("has_schema_privilege('app_role', 'public', 'USAGE')")} || '|' ||
            ${flag("has_database_privilege('app_role', current_database(), 'CONNECT')")} || '|' ||
            ${flag("has_sequence_privilege('app_role', 'public.audit_log_id_seq', 'USAGE')")}
     FROM pg_roles WHERE rolname = 'app_role'`,
  );
}

function expectPasswordUnlogged(boot: Boot | null): void {
  // WHY: redacted logs hide a mutant that prints the secret. The raw stream
  // is what the container wrote.
  if (!boot) return;
  expect(boot.rawLogs()).not.toContain(FIXTURE_PASSWORD);
}

function login(port: number): { status: number; stdout: string; stderr: string } {
  return run(
    'psql',
    ['-h', '127.0.0.1', '-p', String(port), '-U', 'app_role', '-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-tAc', 'SELECT current_user'],
    { ...baseEnv(), PGPASSWORD: FIXTURE_PASSWORD },
  );
}

describe('restored polo snapshot', () => {
  it('restores a fully migrated snapshot into a fresh cluster and boots ready', async (ctx) => {
    if (!guard(ctx)) return;
    let source: Source | null = null;
    let boot: Boot | null = null;
    try {
      source = await startSource();
      const snap = packSnapshot(source);
      expect(Number(snap.orgs)).toBeGreaterThan(0);
      expect(snap.audits).toBe('1');
      stopSource(source);

      const layout = await makeLayout();
      boot = startEntrypoint(layout);
      const awaiting = await waitForPhase(layout.httpPort, (state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(awaiting.phase, boot.logs().slice(-2000)).toBe('awaiting-data');
      const put = await putSnapshot(layout.httpPort, snap.tgz);
      expect(put.status, put.body).toBe(202);
      const state = await waitForPhase(layout.httpPort, (next) => next.phase === 'ready' || next.phase === 'failed', 120_000);
      expect({ phase: state.phase, detail: state.detail }).toEqual({ phase: 'ready', detail: 'restore' });

      expect(psqlOwner(layout.pgPort, 'SELECT count(*) FROM orgs')).toBe(snap.orgs);
      expect(psqlOwner(layout.pgPort, `SELECT id FROM orgs WHERE clerk_org = '${CLERK_ORG}'`)).toBe(ORG_ID);
      expect(psqlOwner(layout.pgPort, `SELECT count(*) FROM audit_log WHERE action = '${AUDIT_ACTION}'`)).toBe('1');
      expect(psqlOwner(layout.pgPort, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")).toBe(snap.tables);

      const session = login(layout.pgPort);
      expect(session.status, session.stderr).toBe(0);
      expect(session.stdout.trim()).toBe('app_role');

      // login, not superuser, no createdb, no createrole,
      // audit_log select/insert only, orgs select/insert/update/delete,
      // schema usage, connect, sequence usage.
      expect(roleFacts(layout.pgPort)).toBe('t|f|f|f|t|t|f|f|f|t|t|t|t|t|t|t');

      const deleted = run(
        'psql',
        ['-h', '127.0.0.1', '-p', String(layout.pgPort), '-U', 'app_role', '-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-c', `DELETE FROM audit_log WHERE action = '${AUDIT_ACTION}'`],
        { ...baseEnv(), PGPASSWORD: FIXTURE_PASSWORD },
      );
      expect(deleted.status).not.toBe(0);
      expect(deleted.stderr).toMatch(/permission denied/);
      expect(psqlOwner(layout.pgPort, `SELECT count(*) FROM audit_log WHERE action = '${AUDIT_ACTION}'`)).toBe('1');
    } finally {
      expectPasswordUnlogged(boot);
      stopBoot(boot);
      if (boot) rmSync(boot.layout.root, { recursive: true, force: true });
      stopSource(source, true);
    }
  }, 180_000);

  it('surfaces a pg_restore failure instead of ignoring it', async (ctx) => {
    if (!guard(ctx)) return;
    let boot: Boot | null = null;
    const dir = mkdtempSync(join(tmpdir(), 'polo-bad-dump-'));
    try {
      const snap = join(dir, 'snap');
      mkdirSync(snap);
      writeFileSync(join(snap, 'db.dump'), 'this is not a postgres archive');
      writeFileSync(join(snap, 'meta.json'), '{}');
      const tgz = join(dir, 'snapshot.tgz');
      must('tar', ['-czf', tgz, '-C', snap, 'db.dump', 'meta.json']);

      const layout = await makeLayout();
      boot = startEntrypoint(layout);
      const awaiting = await waitForPhase(layout.httpPort, (state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(awaiting.phase, boot.logs().slice(-2000)).toBe('awaiting-data');
      const put = await putSnapshot(layout.httpPort, tgz);
      // A restore that throws answers 500. A restore that returns and then
      // fails during migrate answers 202. Either way the boot must record
      // the pg_restore failure instead of a later, unrelated error.
      const state = put.status === 202
        ? await waitForPhase(layout.httpPort, (next) => next.phase === 'ready' || next.phase === 'failed', 60_000)
        : await getState(layout.httpPort);
      expect(state.phase).toBe('failed');
      expect(state.detail).toMatch(/pg_restore failed/);
    } finally {
      expectPasswordUnlogged(boot);
      stopBoot(boot);
      if (boot) rmSync(boot.layout.root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('a fresh install and a second boot can log in as app_role', async (ctx) => {
    if (!guard(ctx)) return;
    const layout = await makeLayout();
    let boot: Boot | null = null;
    try {
      boot = startEntrypoint(layout);
      const awaiting = await waitForPhase(layout.httpPort, (state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(awaiting.phase, boot.logs().slice(-2000)).toBe('awaiting-data');
      const seeded = await postSeed(layout.httpPort);
      expect(seeded.status, seeded.body).toBe(202);
      const first = await waitForPhase(layout.httpPort, (state) => state.phase === 'ready' || state.phase === 'failed', 180_000);
      expect({ phase: first.phase, detail: first.detail }).toEqual({ phase: 'ready', detail: 'seed' });
      const firstLogin = login(layout.pgPort);
      expect(firstLogin.status, firstLogin.stderr).toBe(0);
      expect(firstLogin.stdout.trim()).toBe('app_role');

      // WHY: once _prisma_migrations lists the role migrations, a later boot
      // will not run them. Dropping the role is that case: the data directory
      // still has the history, and migrate() has to create the login again.
      must('psql', ['-h', '127.0.0.1', '-p', String(layout.pgPort), '-U', 'bidstack', '-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-c', DROP_APP_ROLE]);
      stopBoot(boot);
      boot = null;

      boot = startEntrypoint(layout);
      const again = await waitForPhase(layout.httpPort, (state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(again.phase, boot.logs().slice(-2000)).toBe('awaiting-data');
      const reseeded = await postSeed(layout.httpPort);
      expect(reseeded.status, reseeded.body).toBe(202);
      const second = await waitForPhase(layout.httpPort, (state) => state.phase === 'ready' || state.phase === 'failed', 180_000);
      expect({ phase: second.phase, detail: second.detail }).toEqual({ phase: 'ready', detail: 'seed' });
      const secondLogin = login(layout.pgPort);
      expect(secondLogin.status, secondLogin.stderr).toBe(0);
      expect(secondLogin.stdout.trim()).toBe('app_role');
    } finally {
      expectPasswordUnlogged(boot);
      stopBoot(boot);
      rmSync(layout.root, { recursive: true, force: true });
    }
  }, 240_000);

  it('stops the boot when an audit trigger is disabled', async (ctx) => {
    if (!guard(ctx)) return;
    const layout = await makeLayout();
    let boot: Boot | null = null;
    try {
      boot = startEntrypoint(layout, { POLO_GATE_BREAK: 'audit-trigger' });
      const awaiting = await waitForPhase(layout.httpPort, (state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(awaiting.phase).toBe('awaiting-data');
      const seeded = await postSeed(layout.httpPort);
      expect(seeded.status, seeded.body).toBe(202);
      const state = await waitForPhase(layout.httpPort, (next) => next.phase === 'ready' || next.phase === 'failed', 180_000);
      expect(state.phase).toBe('failed');
      expect(state.detail).toMatch(/audit_log_append_only/);
    } finally {
      expectPasswordUnlogged(boot);
      stopBoot(boot);
      rmSync(layout.root, { recursive: true, force: true });
    }
  }, 180_000);

  it('a failed password change does not write the secret to the logs', async (ctx) => {
    if (!guard(ctx)) return;
    const layout = await makeLayout();
    let boot: Boot | null = null;
    try {
      boot = startEntrypoint(layout, { POLO_PASSWORD_TARGET_ROLE: 'no_such_role' });
      const awaiting = await waitForPhase(layout.httpPort, (state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(awaiting.phase).toBe('awaiting-data');
      const seeded = await postSeed(layout.httpPort);
      expect(seeded.status, seeded.body).toBe(202);
      const state = await waitForPhase(layout.httpPort, (next) => next.phase === 'ready' || next.phase === 'failed', 180_000);
      expect(state.phase).toBe('failed');
      expect(boot.rawLogs()).not.toContain(FIXTURE_PASSWORD);
      const serverLog = join(layout.dataDir, 'pg', 'log');
      if (existsSync(serverLog)) {
        for (const name of readdirSync(serverLog)) {
          expect(readFileSync(join(serverLog, name), 'utf8')).not.toContain(FIXTURE_PASSWORD);
        }
      }
    } finally {
      expectPasswordUnlogged(boot);
      stopBoot(boot);
      rmSync(layout.root, { recursive: true, force: true });
    }
  }, 180_000);
});
