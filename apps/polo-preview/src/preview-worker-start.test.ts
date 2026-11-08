import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('preview queue worker', () => {
  it('builds the worker image and starts it only after Postgres is ready', () => {
    // The API enqueues MSA extract and crew runs into the container Redis.
    // Those jobs stay pending unless this image both compiles and launches
    // @bidstack/worker against that same Redis and database.
    const dockerfile = readFileSync(join(here, '..', 'Dockerfile'), 'utf8');
    const entry = readFileSync(join(here, 'preview-entrypoint.sh'), 'utf8');
    expect(dockerfile).toContain('pnpm --filter @bidstack/worker build');
    expect(dockerfile).toContain('apps/worker/dist/main.js');
    const readyAt = entry.indexOf('if preview_wait_postgres');
    const apiAt = entry.indexOf('starting api');
    const workerAt = entry.indexOf('starting queue worker');
    const launchAt = entry.indexOf('cd /app/apps/worker && exec node dist/main.js');
    expect(readyAt).toBeGreaterThan(-1);
    expect(apiAt).toBeGreaterThan(readyAt);
    expect(workerAt).toBeGreaterThan(apiAt);
    expect(launchAt).toBeGreaterThan(workerAt);
    expect(entry.indexOf('postgres did not become ready')).toBeGreaterThan(launchAt);
    expect(entry).toContain('Preview-only defaults');
    expect(entry).toContain('not production credentials');
    expect(entry).toContain('wait -n');
    expect(entry).toContain('preview_require_file "queue worker dist"');
    expect(entry).not.toContain('|| log "migrate failed"');
    expect(entry).not.toContain('|| log "seed failed"');
    expect(entry).not.toContain('will stay queued');
  });
});

describe('preview process lifecycle', () => {
  const entry = join(here, 'preview-entrypoint.sh');

  function run(body: string) {
    const reap = join(mkdtempSync(join(tmpdir(), 'polo-preview-')), 'reap');
    const result = spawnSync(
      'bash',
      ['-c', `export PREVIEW_REAP_LOG='${reap}'\nexport LOG='${reap}.log'\nsource '${entry}'\n${body}`],
      { encoding: 'utf8' },
    );
    return { ...result, reap, log: readFileSync(`${reap}.log`, 'utf8') };
  }

  it('stops the other children when one preview process exits', () => {
    // A crashed API, worker, or Postgres must not leave the rest running.
    const result = run(`
      preview_install_trap
      sleep 30 & a=$!; preview_track "$a"
      sleep 30 & b=$!; preview_track "$b"
      ( exit 9 ) & preview_track "$!"
      set +e
      preview_watch_children
      status=$?
      echo A:$a
      echo B:$b
      echo STATUS:$status
      exit $status
    `);
    expect(result.status).toBe(9);
    expect(result.stdout).toContain('STATUS:9');
    const reaped = readFileSync(result.reap, 'utf8');
    const a = /A:(\d+)/.exec(result.stdout)?.[1];
    const b = /B:(\d+)/.exec(result.stdout)?.[1];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(reaped).toContain(`reaped ${a}`);
    expect(reaped).toContain(`reaped ${b}`);
    expect(result.log).toContain('a preview process exited (9)');
    expect(Number(a)).toBeGreaterThan(0);
    expect(Number(b)).toBeGreaterThan(0);
    expect(spawnSync('kill', ['-0', String(a)]).status).toBe(1);
    expect(spawnSync('kill', ['-0', String(b)]).status).toBe(1);
  });

  it('stops after a failed command and does not run the next one', () => {
    const result = run(`
      preview_run_or_die step false
      echo CONTINUED
    `);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('CONTINUED');
    expect(result.log).toContain('step failed');
  });

  it('does not replace an explicit database url when the password is still the default', () => {
    const result = run(`
      export DATABASE_URL='postgres://bidstack:explicit-secret@127.0.0.1:5432/bidstack'
      export POSTGRES_PASSWORD=bidstack
      preview_prepare_database
      echo CONTINUED
    `);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('CONTINUED');
    expect(result.stdout).not.toContain('explicit-secret');
    expect(result.log).toContain('DATABASE_URL is explicit');
    expect(result.log).not.toContain('explicit-secret');
  });

  it('stops when password generation fails and does not print a value', () => {
    const result = run(`
      od() { return 1; }
      export DATABASE_URL='postgres://bidstack:bidstack@127.0.0.1:5432/bidstack'
      export POSTGRES_PASSWORD=bidstack
      preview_prepare_database
      echo CONTINUED
    `);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('CONTINUED');
    expect(result.log).toContain('password generation failed');
  });

  it('kills a grandchild of a tracked leader and leaves an unrelated process', () => {
    const result = run(`
      preview_install_trap
      nohup sleep 30 >/dev/null 2>&1 &
      unrelated=\$!
      disown || true
      setsid bash -c 'sleep 30 & echo GRAND:\$!; exit 0' &
      child=\$!
      echo UNRELATED:\$unrelated
      preview_track_leader "\$child"
      sleep 0.2
      echo CHILD:\$child
      preview_cleanup
    `);
    const unrelated = /UNRELATED:(\d+)/.exec(result.stdout)?.[1];
    const child = /CHILD:(\d+)/.exec(result.stdout)?.[1];
    const grand = /GRAND:(\d+)/.exec(result.stdout)?.[1];
    expect(Number(child)).toBeGreaterThan(0);
    expect(Number(grand)).toBeGreaterThan(0);
    expect(Number(unrelated)).toBeGreaterThan(0);
    expect(spawnSync('kill', ['-0', String(child)]).status).toBe(1);
    expect(spawnSync('kill', ['-0', String(grand)]).status).toBe(1);
    expect(spawnSync('kill', ['-0', String(unrelated)]).status).toBe(0);
    spawnSync('kill', ['-9', String(unrelated)]);
  });

  it('rejects a remote host hidden after an at-sign in the path', () => {
    const result = run(`
      export DATABASE_URL='postgres://evil.example/db@127.0.0.1:5432'
      preview_require_local_database
      echo CONTINUED
    `);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('CONTINUED');
  });

  it('kills a child that ignores TERM and leaves an unrelated process', () => {
    const result = run(`
      preview_install_trap
      nohup sleep 30 >/dev/null 2>&1 &
      unrelated=\$!
      disown || true
      bash -c 'trap "" TERM; sleep 30' &
      child=\$!
      preview_track "\$child"
      echo UNRELATED:\$unrelated
      echo CHILD:\$child
      preview_cleanup
    `);
    const unrelated = /UNRELATED:(\d+)/.exec(result.stdout)?.[1];
    const child = /CHILD:(\d+)/.exec(result.stdout)?.[1];
    expect(Number(child)).toBeGreaterThan(0);
    expect(Number(unrelated)).toBeGreaterThan(0);
    expect(spawnSync('kill', ['-0', String(child)]).status).toBe(1);
    expect(readFileSync(result.reap, 'utf8')).toContain(`reaped ${child}`);
    expect(readFileSync(result.reap, 'utf8')).not.toContain(`reaped ${unrelated}`);
    expect(spawnSync('kill', ['-0', String(unrelated)]).status).toBe(0);
    spawnSync('kill', ['-9', String(unrelated)]);
  });

  it('refuses a remote DATABASE_URL before any migrate', () => {
    const result = run(`
      export DATABASE_URL='postgres://bidstack:bidstack@db.example:5432/bidstack'
      preview_require_local_database
      echo CONTINUED
    `);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('CONTINUED');
    expect(result.log).toContain('DATABASE_URL must point at the preview Postgres');
  });

  it('stops when redis does not start', () => {
    const bin = mkdtempSync(join(tmpdir(), 'polo-redis-'));
    const fake = join(bin, 'redis-server');
    writeFileSync(fake, '#!/bin/bash\nexit 1\n');
    chmodSync(fake, 0o755);
    const result = run(`
      export PATH='${bin}':"$PATH"
      preview_start_redis
      echo CONTINUED
    `);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('CONTINUED');
    expect(result.log).toContain('redis failed');
  });

  it('gives up on Postgres after the attempt bound', () => {
    const bin = mkdtempSync(join(tmpdir(), 'polo-pg-'));
    const fake = join(bin, 'pg_isready');
    writeFileSync(fake, '#!/bin/bash\nexit 1\n');
    chmodSync(fake, 0o755);
    const started = Date.now();
    const result = run(`
      preview_install_trap
      export PATH='${bin}':"$PATH"
      export PREVIEW_POSTGRES_ATTEMPTS=2
      export PREVIEW_READY_SLEEP=0
      sleep 30 & pg=$!
      preview_track "$pg"
      if preview_wait_postgres "$pg"; then echo READY; else echo NOTREADY; fi
    `);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.stdout).toContain('NOTREADY');
    expect(result.stdout).not.toContain('\nREADY');
    expect(result.log).toContain('postgres was not ready after 2 attempts');
  });

  it('does not start the API when the worker binary or a migration is missing', () => {
    const missingWorker = run(`preview_require_file "queue worker dist" /no/such/worker.js`);
    expect(missingWorker.status).toBe(1);
    expect(missingWorker.log).toContain('queue worker dist missing; API will not start');

    const migrate = run(`preview_run_or_die migrate false`);
    expect(migrate.status).toBe(1);
    expect(migrate.log).toContain('migrate failed');

    const seed = run(`preview_run_or_die seed false`);
    expect(seed.status).toBe(1);
    expect(seed.log).toContain('seed failed');
  });
});
