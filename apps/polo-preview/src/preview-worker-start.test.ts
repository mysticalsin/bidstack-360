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
    expect(reaped).toMatch(new RegExp(`wait ${a} (137|143)`));
    expect(reaped).toMatch(new RegExp(`wait ${b} (137|143)`));
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

  it('leaves a grandchild when the leader stat cannot be read', () => {
    const result = run(`
      preview_install_trap
      nohup sleep 30 >/dev/null 2>&1 &
      unrelated=\$!
      disown || true
      setsid bash -c 'bash -c "trap \\"\\" TERM; sleep 30" >/dev/null 2>&1 & echo GRAND:\$!; exit 0' &
      child=\$!
      echo UNRELATED:\$unrelated
      preview_track_leader "\$child"
      sleep 0.2
      echo CHILD:\$child
      preview_read_start() { return 1; }
      preview_cleanup
    `);
    const unrelated = /UNRELATED:(\d+)/.exec(result.stdout)?.[1];
    const child = /CHILD:(\d+)/.exec(result.stdout)?.[1];
    const grand = /GRAND:(\d+)/.exec(result.stdout)?.[1];
    expect(Number(child)).toBeGreaterThan(0);
    expect(Number(grand)).toBeGreaterThan(0);
    expect(Number(unrelated)).toBeGreaterThan(0);
    expect(spawnSync('kill', ['-0', String(grand)]).status).toBe(0);
    expect(spawnSync('kill', ['-0', String(unrelated)]).status).toBe(0);
    expect(readFileSync(result.reap, 'utf8')).not.toContain(`wait ${grand}`);
    spawnSync('kill', ['-9', String(grand)]);
    spawnSync('kill', ['-9', String(unrelated)]);
  });

  it('reports unresolved ownership and returns while a live child stat cannot be read', () => {
    const started = Date.now();
    const result = run(`
      preview_install_trap
      # The sleeper is not this shell's child. This bash waits for its own
      # children at exit even after cleanup refuses to wait or signal them.
      leader=\$(bash -c 'setsid sleep 30 >/dev/null 2>&1 & echo \$!')
      preview_track_leader "\$leader"
      preview_read_start() { return 1; }
      echo LEADER:\$leader
      preview_cleanup
    `);
    const leader = /LEADER:(\d+)/.exec(result.stdout)?.[1];
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(Number(leader)).toBeGreaterThan(0);
    expect(readFileSync(result.reap, 'utf8')).toContain(`unresolved ${leader} identity`);
    expect(readFileSync(result.reap, 'utf8')).not.toContain(`wait ${leader}`);
    expect(spawnSync('kill', ['-0', String(leader)]).status).toBe(0);
    spawnSync('kill', ['-9', String(leader)]);
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

  it('does not signal when the start token is empty or stat cannot be read', () => {
    const result = run(`
      setsid sleep 30 & empty=\$!
      preview_track_leader "\$empty"
      preview_leader_start["\$empty"]=""
      setsid sleep 30 & missing=\$!
      preview_track_leader "\$missing"
      preview_read_start() { return 1; }
      if preview_identity_ok "\$empty"; then echo EMPTY_OK; else echo EMPTY_REFUSED; fi
      if preview_group_live "\$empty"; then echo EMPTY_POLLED; else echo EMPTY_UNPOLLED; fi
      preview_signal_group "\$empty" KILL
      if preview_identity_ok "\$missing"; then echo MISSING_OK; else echo MISSING_REFUSED; fi
      preview_signal_group "\$missing" KILL
      if /bin/kill -s 0 -- "-\$empty" 2>/dev/null; then echo EMPTY_ALIVE; fi
      if /bin/kill -s 0 -- "-\$missing" 2>/dev/null; then echo MISSING_ALIVE; fi
      echo EMPTY:\$empty
      echo MISSING:\$missing
      /bin/kill -s KILL -- "-\$empty" 2>/dev/null || true
      /bin/kill -s KILL -- "-\$missing" 2>/dev/null || true
      wait "\$empty" 2>/dev/null || true
      wait "\$missing" 2>/dev/null || true
    `);
    expect(result.stdout).toContain('EMPTY_REFUSED');
    expect(result.stdout).toContain('EMPTY_UNPOLLED');
    expect(result.stdout).toContain('EMPTY_ALIVE');
    expect(result.stdout).toContain('MISSING_REFUSED');
    expect(result.stdout).toContain('MISSING_ALIVE');
    expect(result.stdout).not.toContain('EMPTY_OK');
    expect(result.stdout).not.toContain('MISSING_OK');
    expect(result.stdout).not.toContain('EMPTY_POLLED');
  });

  it('does not signal a tracked pid after its start token changes', () => {
    // A reused pid is not the child we recorded. Cleanup must not kill it or its group.
    const result = run(`
      sleep 30 & child=\$!
      preview_track "\$child"
      preview_leader_start["\$child"]=reused-pid
      setsid sleep 30 & leader=\$!
      preview_track_leader "\$leader"
      preview_leader_start["\$leader"]=reused-group
      if preview_identity_ok "\$child"; then echo CHILD_OK; else echo CHILD_REFUSED; fi
      preview_signal_group "\$leader" KILL
      if /bin/kill -s 0 "\$child" 2>/dev/null; then echo CHILD_ALIVE; fi
      if /bin/kill -s 0 -- "-\$leader" 2>/dev/null; then echo GROUP_ALIVE; fi
      echo CHILD:\$child
      echo LEADER:\$leader
      /bin/kill -s KILL "\$child" 2>/dev/null || true
      /bin/kill -s KILL -- "-\$leader" 2>/dev/null || true
      wait "\$child" 2>/dev/null || true
      wait "\$leader" 2>/dev/null || true
    `);
    expect(result.stdout).toContain('CHILD_REFUSED');
    expect(result.stdout).toContain('CHILD_ALIVE');
    expect(result.stdout).toContain('GROUP_ALIVE');
    expect(result.stdout).not.toContain('CHILD_OK');
    const child = /CHILD:(\d+)/.exec(result.stdout)?.[1];
    const leader = /LEADER:(\d+)/.exec(result.stdout)?.[1];
    expect(Number(child)).toBeGreaterThan(0);
    expect(Number(leader)).toBeGreaterThan(0);
  });

  it('kills a child that ignores TERM and leaves an unrelated process', () => {
    const result = run(`
      preview_install_trap
      nohup sleep 30 >/dev/null 2>&1 &
      unrelated=\$!
      disown || true
      ready=\$(mktemp)
      bash -c "trap '' TERM; echo ready > '\$ready'; sleep 30" &
      child=\$!
      preview_track "\$child"
      for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        [[ -s "\$ready" ]] && break
        sleep 0.05
      done
      echo UNRELATED:\$unrelated
      echo CHILD:\$child
      preview_cleanup
    `);
    const unrelated = /UNRELATED:(\d+)/.exec(result.stdout)?.[1];
    const child = /CHILD:(\d+)/.exec(result.stdout)?.[1];
    expect(Number(child)).toBeGreaterThan(0);
    expect(Number(unrelated)).toBeGreaterThan(0);
    expect(spawnSync('kill', ['-0', String(child)]).status).toBe(1);
    expect(readFileSync(result.reap, 'utf8')).toContain(`wait ${child} 137`);
    expect(readFileSync(result.reap, 'utf8')).not.toContain(`wait ${unrelated}`);
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
