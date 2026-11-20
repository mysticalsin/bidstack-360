// WHY: snapshotFile() pg_dumps one database. Cluster roles are not in that
// dump. After restore, _prisma_migrations already lists the app_role
// migrations, so migrate deploy never creates the role and ALTER ROLE fails
// the boot. A fully migrated snapshot must come back on a fresh initdb
// cluster with the same rows, a login for app_role, its grants, and no
// DELETE on audit_log.
//
// TEST COMMAND (Postgres 16 tools and redis-server on PATH):
// POLO_RESTORE_DRILL=1 pnpm --filter @bidstack/polo-preview exec vitest run src/restore-migrated-snapshot.integration.test.ts

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(join(here, '../../..'));
const pgBin = '/usr/lib/postgresql/16/bin';
const FIXTURE_PASSWORD = 'fixture-app-role-password';
const INTERNAL_KEY = 'fixture-internal-key';
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CLERK_ORG = 'org_fixture_restore';
const AUDIT_ACTION = 'fixture.restore';
const SOURCE_PORT = '5433';

const API_STUB = `import http from 'node:http';
const port = Number(process.env.PORT || 4020);
http.createServer((req, res) => {
  res.writeHead(req.url && req.url.startsWith('/livez') ? 200 : 404);
  res.end('ok');
}).listen(port, '127.0.0.1');
`;
const WORKER_STUB = 'setInterval(() => {}, 1 << 30);\n';

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

function psqlOwner(port: string, sql: string): string {
  return must('psql', ['-h', '127.0.0.1', '-p', port, '-U', 'bidstack', '-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-tAc', sql]).trim();
}

function ensureHostLayout(): void {
  if (!existsSync('/data')) {
    if (run('sudo', ['mkdir', '-p', '/data']).status !== 0) throw new Error('could not create /data');
    const uid = String(process.getuid?.() ?? '');
    const gid = String(process.getgid?.() ?? '');
    if (run('sudo', ['chown', `${uid}:${gid}`, '/data']).status !== 0) throw new Error('could not chown /data');
  }
  if (!existsSync('/app')) {
    if (run('sudo', ['ln', '-s', repo, '/app']).status !== 0) throw new Error('could not link /app to the repo');
  } else if (realpathSync('/app') !== repo) {
    throw new Error(`/app points at ${realpathSync('/app')}, not this repo`);
  }
}

function wipeData(): void {
  run('pg_ctl', ['-D', '/data/pg', '-m', 'immediate', 'stop']);
  run('pkill', ['-f', '[r]edis-server --bind']);
  rmSync('/data/pg', { recursive: true, force: true });
  rmSync('/data/storage', { recursive: true, force: true });
}

type Boot = { child: ChildProcess; logs: () => string; stubs: string[] };

function writeStub(file: string, source: string, created: string[]): void {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  created.push(file);
}

function startEntrypoint(): Boot {
  ensureHostLayout();
  wipeData();
  const stubs: string[] = [];
  writeStub(join(repo, 'apps/api/dist/main.js'), API_STUB, stubs);
  writeStub(join(repo, 'apps/worker/dist/main.js'), WORKER_STUB, stubs);
  let logs = '';
  const child = spawn(process.execPath, [join(repo, 'apps/polo-preview/container/entrypoint.mjs')], {
    cwd: repo,
    detached: true,
    env: {
      ...baseEnv(),
      POLO_INTERNAL_KEY: INTERNAL_KEY,
      POLO_APP_DB_PASSWORD: FIXTURE_PASSWORD,
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
    stubs,
    logs: () => logs.split(FIXTURE_PASSWORD).join('[redacted]').split(INTERNAL_KEY).join('[redacted]'),
  };
}

function stopEntrypoint(boot: Boot | null): void {
  if (boot?.child.pid) {
    try {
      process.kill(-boot.child.pid, 'SIGTERM');
    } catch {
      // The supervisor already exited.
    }
  }
  run('pg_ctl', ['-D', '/data/pg', '-m', 'immediate', 'stop']);
  if (boot?.child.pid) {
    try {
      process.kill(-boot.child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  run('pkill', ['-f', '[r]edis-server --bind']);
  for (const file of boot?.stubs ?? []) rmSync(file, { force: true });
}

type State = { phase?: string; detail?: string };

function getState(): Promise<State> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: 8080,
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

async function waitForPhase(accept: (state: State) => boolean, timeoutMs: number): Promise<State> {
  const start = Date.now();
  let last: State = {};
  while (Date.now() - start < timeoutMs) {
    last = await getState();
    if (accept(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}

function putSnapshot(file: string): Promise<{ status: number; body: string }> {
  const size = statSync(file).size;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 8080,
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

function startSource(): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'polo-source-'));
  const pgdata = join(dir, 'pg');
  must('initdb', ['-D', pgdata, '-U', 'bidstack', '--auth=trust', '-E', 'UTF8']);
  must('pg_ctl', ['-D', pgdata, '-l', join(dir, 'postgres.log'), '-w', '-o', `-h 127.0.0.1 -p ${SOURCE_PORT} -k ${dir}`, 'start']);
  must('createdb', ['-h', '127.0.0.1', '-p', SOURCE_PORT, '-U', 'bidstack', 'bidstack']);
  const prisma = join(repo, 'packages/db/node_modules/.bin/prisma');
  must(
    prisma,
    ['migrate', 'deploy', '--schema', join(repo, 'packages/db/prisma/schema.prisma')],
    { ...baseEnv(), DATABASE_URL: `postgres://bidstack:bidstack@127.0.0.1:${SOURCE_PORT}/bidstack` },
  );
  must('psql', [
    '-h',
    '127.0.0.1',
    '-p',
    SOURCE_PORT,
    '-U',
    'bidstack',
    '-d',
    'bidstack',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO orgs (id, clerk_org, name) VALUES ('${ORG_ID}', '${CLERK_ORG}', 'Fixture Restore Org');
     INSERT INTO audit_log (org_id, action, target_type) VALUES ('${ORG_ID}', '${AUDIT_ACTION}', 'test');`,
  ]);
  return { dir };
}

function stopSource(dir: string | null, remove = false): void {
  if (!dir) return;
  run('pg_ctl', ['-D', join(dir, 'pg'), '-m', 'immediate', 'stop']);
  if (remove) rmSync(dir, { recursive: true, force: true });
}

function packSnapshot(dir: string): { tgz: string; orgs: string; audits: string; tables: string } {
  const snap = join(dir, 'snap');
  mkdirSync(snap);
  // Same pg_dump flags as snapshotFile() in container/entrypoint.mjs.
  // The port is the source cluster; the entrypoint's own server is 5432.
  must('pg_dump', ['-h', '127.0.0.1', '-p', SOURCE_PORT, '-U', 'bidstack', '-Fc', '-f', join(snap, 'db.dump'), 'bidstack']);
  writeFileSync(join(snap, 'meta.json'), JSON.stringify({ at: '2026-01-01T00:00:00.000Z', bootId: 'fixture-boot' }));
  const tgz = join(dir, 'snapshot.tgz');
  must('tar', ['-czf', tgz, '-C', snap, 'db.dump', 'meta.json']);
  return {
    tgz,
    orgs: psqlOwner(SOURCE_PORT, 'SELECT count(*) FROM orgs'),
    audits: psqlOwner(SOURCE_PORT, `SELECT count(*) FROM audit_log WHERE action = '${AUDIT_ACTION}'`),
    tables: psqlOwner(SOURCE_PORT, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"),
  };
}

function roleFacts(): string {
  return psqlOwner(
    '5432',
    `SELECT rolcanlogin::text || '|' || rolsuper::text || '|' || rolcreatedb::text || '|' || rolcreaterole::text || '|' ||
            has_table_privilege('app_role', 'public.audit_log', 'SELECT')::text || '|' ||
            has_table_privilege('app_role', 'public.audit_log', 'INSERT')::text || '|' ||
            has_table_privilege('app_role', 'public.audit_log', 'UPDATE')::text || '|' ||
            has_table_privilege('app_role', 'public.audit_log', 'DELETE')::text || '|' ||
            has_table_privilege('app_role', 'public.audit_log', 'TRUNCATE')::text || '|' ||
            has_table_privilege('app_role', 'public.orgs', 'SELECT')::text || '|' ||
            has_table_privilege('app_role', 'public.orgs', 'INSERT')::text || '|' ||
            has_table_privilege('app_role', 'public.orgs', 'UPDATE')::text || '|' ||
            has_table_privilege('app_role', 'public.orgs', 'DELETE')::text || '|' ||
            has_schema_privilege('app_role', 'public', 'USAGE')::text || '|' ||
            has_database_privilege('app_role', current_database(), 'CONNECT')::text || '|' ||
            has_sequence_privilege('app_role', 'public.audit_log_id_seq', 'USAGE')::text
     FROM pg_roles WHERE rolname = 'app_role'`,
  );
}

describe('restored polo snapshot', () => {
  if (!toolsReady()) {
    const reason = 'needs initdb, pg_dump, pg_restore, and redis-server on PATH';
    if (process.env.POLO_RESTORE_DRILL === '1') {
      throw new Error(`POLO_RESTORE_DRILL=1 ${reason}`);
    }
    it.skip(`restores a fully migrated snapshot into a fresh cluster (${reason})`, () => {});
    it.skip(`surfaces a pg_restore failure (${reason})`, () => {});
    return;
  }

  it('restores a fully migrated snapshot into a fresh cluster and boots ready', async () => {
    let source: string | null = null;
    let boot: Boot | null = null;
    try {
      const started = startSource();
      source = started.dir;
      const snap = packSnapshot(source);
      expect(Number(snap.orgs)).toBeGreaterThan(0);
      expect(snap.audits).toBe('1');
      // Free the source postmaster. Keep the tarball until the restore is sent.
      stopSource(source);

      boot = startEntrypoint();
      const awaiting = await waitForPhase((state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(awaiting.phase, boot.logs().slice(-2000)).toBe('awaiting-data');
      const put = await putSnapshot(snap.tgz);
      expect(put.status, put.body).toBe(202);
      const state = await waitForPhase((next) => next.phase === 'ready' || next.phase === 'failed', 120_000);
      expect({ phase: state.phase, detail: state.detail }).toEqual({ phase: 'ready', detail: 'restore' });

      expect(psqlOwner('5432', 'SELECT count(*) FROM orgs')).toBe(snap.orgs);
      expect(psqlOwner('5432', `SELECT id FROM orgs WHERE clerk_org = '${CLERK_ORG}'`)).toBe(ORG_ID);
      expect(psqlOwner('5432', `SELECT count(*) FROM audit_log WHERE action = '${AUDIT_ACTION}'`)).toBe('1');
      expect(psqlOwner('5432', "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")).toBe(snap.tables);

      const login = run(
        'psql',
        ['-h', '127.0.0.1', '-p', '5432', '-U', 'app_role', '-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-tAc', 'SELECT current_user'],
        { ...baseEnv(), PGPASSWORD: FIXTURE_PASSWORD },
      );
      expect(login.status, login.stderr).toBe(0);
      expect(login.stdout.trim()).toBe('app_role');

      // login, not superuser, no createdb, no createrole,
      // audit_log select/insert only, orgs select/insert/update/delete,
      // schema usage, connect, sequence usage.
      expect(roleFacts()).toBe('t|f|f|f|t|t|f|f|f|t|t|t|t|t|t|t');

      const deleted = run(
        'psql',
        ['-h', '127.0.0.1', '-p', '5432', '-U', 'app_role', '-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-c', `DELETE FROM audit_log WHERE action = '${AUDIT_ACTION}'`],
        { ...baseEnv(), PGPASSWORD: FIXTURE_PASSWORD },
      );
      expect(deleted.status).not.toBe(0);
      expect(deleted.stderr).toMatch(/permission denied/);
      expect(psqlOwner('5432', `SELECT count(*) FROM audit_log WHERE action = '${AUDIT_ACTION}'`)).toBe('1');
    } finally {
      stopEntrypoint(boot);
      stopSource(source, true);
    }
  }, 180_000);

  it('surfaces a pg_restore failure instead of ignoring it', async () => {
    let boot: Boot | null = null;
    const dir = mkdtempSync(join(tmpdir(), 'polo-bad-dump-'));
    try {
      const snap = join(dir, 'snap');
      mkdirSync(snap);
      writeFileSync(join(snap, 'db.dump'), 'this is not a postgres archive');
      writeFileSync(join(snap, 'meta.json'), '{}');
      const tgz = join(dir, 'snapshot.tgz');
      must('tar', ['-czf', tgz, '-C', snap, 'db.dump', 'meta.json']);

      boot = startEntrypoint();
      const awaiting = await waitForPhase((state) => state.phase === 'awaiting-data' || state.phase === 'failed', 30_000);
      expect(awaiting.phase, boot.logs().slice(-2000)).toBe('awaiting-data');
      const put = await putSnapshot(tgz);
      // A restore that throws answers 500. A restore that returns and then
      // fails during migrate answers 202. Either way the boot must record
      // the pg_restore failure instead of a later, unrelated error.
      const state = put.status === 202
        ? await waitForPhase((next) => next.phase === 'ready' || next.phase === 'failed', 60_000)
        : await getState();
      expect(state.phase).toBe('failed');
      expect(state.detail).toMatch(/pg_restore failed/);
    } finally {
      stopEntrypoint(boot);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
