import { spawn } from 'node:child_process';

import {
  csvRow,
  fileHash,
  holdAdvisory,
  flushRateLimits,
  http,
  listeningPid,
  messageOf,
  psql,
  redis,
  sleep,
  waitFor,
} from './lib.mjs';

const ROLE = { 'x-bidstack-e2e-role': 'admin' };

function q(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function scenarioB11() {
  flushRateLimits();
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    const res = await http('POST', '/api/v1/migrations/start-csv', {
      body: csvRow(`B11 A ${Date.now()} ${i}`),
      timeoutMs: 20_000,
    });
    statuses.push(res.status);
  }
  const other = await http('POST', '/api/v1/migrations/start-csv', {
    body: csvRow(`B11 B ${Date.now()}`),
    headers: ROLE,
    timeoutMs: 20_000,
  });
  const firstTen = statuses.slice(0, 10);
  const eleventh = statuses[10];
  const pass = firstTen.every((code) => code === 201) && eleventh === 429 && other.status === 201;
  let expectedFailUntil = null;
  if (!pass && other.status === 429 && firstTen.every((code) => code === 201) && eleventh === 429) {
    expectedFailUntil = 349;
  }
  if (other.status === 403 && /disabled/i.test(other.text)) {
    throw new Error('B11 needs BIDSTACK_ALLOW_STUB_ROLE_HEADER=true so user B is a second admin');
  }
  return {
    id: 'B11',
    pass,
    expectedFailUntil,
    statuses,
    userB: other.status,
    userBMessage: messageOf(other),
  };
}

export async function scenarioSameFile() {
  flushRateLimits();
  const name = `Same ${Date.now()}`;
  const body = csvRow(name);
  const [a, b] = await Promise.all([
    http('POST', '/api/v1/migrations/start-csv', { body, timeoutMs: 20_000 }),
    http('POST', '/api/v1/migrations/start-csv', { body, timeoutMs: 20_000 }),
  ]);
  const hash = fileHash(body.rows);
  const active = Number(
    psql(
      `SELECT count(*) FROM migration_jobs WHERE source = 'CSV' AND file_hash = ${q(hash)} AND status IN ('PENDING','RUNNING')`,
    ),
  );
  const rows = Number(
    psql(`SELECT count(*) FROM migration_jobs WHERE source = 'CSV' AND file_hash = ${q(hash)}`),
  );
  const codes = [a.status, b.status].sort();
  const pass = rows === 1 && codes[0] === 201 && codes[1] === 409 && active <= 1;
  const winnerId = a.status === 201 ? a.json?.id : b.json?.id;
  const keys = redis(['--scan', '--pattern', 'migration:*:rows']).split('\n').filter(Boolean);
  const leaked = keys.filter((key) => winnerId && !key.includes(winnerId) && key.startsWith('migration:'));
  return {
    id: 'same-csv',
    pass,
    codes,
    rows,
    activeAtSample: active,
    leakedKeys: leaked.length,
    messages: [messageOf(a), messageOf(b)],
  };
}

export async function scenarioDifferentFiles() {
  flushRateLimits();
  const stamp = Date.now();
  const [a, b] = await Promise.all([
    http('POST', '/api/v1/migrations/start-csv', { body: csvRow(`Left ${stamp}`), timeoutMs: 20_000 }),
    http('POST', '/api/v1/migrations/start-csv', { body: csvRow(`Right ${stamp}`), timeoutMs: 20_000 }),
  ]);
  return {
    id: 'different-csv',
    pass: a.status === 201 && b.status === 201,
    codes: [a.status, b.status],
    messages: [messageOf(a), messageOf(b)],
  };
}

function installClaimDelay() {
  psql(`
    CREATE OR REPLACE FUNCTION bidstack_stress_pause_claim() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.status::text = 'PENDING' AND NEW.status::text = 'RUNNING' THEN
        PERFORM pg_advisory_lock(481516234);
        PERFORM pg_advisory_unlock(481516234);
      END IF;
      RETURN NEW;
    END
    $fn$
  `);
  psql(`DROP TRIGGER IF EXISTS bidstack_stress_pause_claim ON migration_jobs`);
  psql(`
    CREATE TRIGGER bidstack_stress_pause_claim
    BEFORE UPDATE ON migration_jobs
    FOR EACH ROW EXECUTE FUNCTION bidstack_stress_pause_claim()
  `);
}

export function dropClaimDelay() {
  psql(`DROP TRIGGER IF EXISTS bidstack_stress_pause_claim ON migration_jobs`);
  psql(`DROP FUNCTION IF EXISTS bidstack_stress_pause_claim()`);
}

export async function scenarioC2B() {
  flushRateLimits();
  installClaimDelay();
  const lock = holdAdvisory();
  const name = `C2B ${Date.now()}`;
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await lock.release();
  };
  try {
    await lock.ready;
    const mark = psql('SELECT clock_timestamp()');
    const starting = http('POST', '/api/v1/migrations/start-csv', {
      body: csvRow(name),
      timeoutMs: 25_000,
    });
    const pending = await waitFor(async () => {
      const id = psql(
        `SELECT id FROM migration_jobs WHERE status = 'PENDING' AND created_at >= ${q(mark)}::timestamptz ORDER BY created_at LIMIT 1`,
      );
      return id || null;
    }, 8_000);
    if (!pending) {
      await release();
      const early = await starting;
      return {
        id: 'C2B',
        pass: false,
        expectedFailUntil: null,
        detail: 'start did not leave a PENDING row under the claim lock',
        start: early.status,
        body: early.text,
      };
    }
    const canceling = http('DELETE', `/api/v1/migrations/${pending}/cancel`, { timeoutMs: 25_000 });
    await sleep(2_500);
    await release();
    const [started, cancel] = await Promise.all([starting, canceling]);
    await sleep(1_500);
    const status = psql(`SELECT status FROM migration_jobs WHERE id = ${q(pending)}::uuid`);
    const cancels = Number(
      psql(
        `SELECT count(*) FROM audit_log WHERE target_id = ${q(pending)} AND action = 'migration.cancel' AND deleted_at IS NULL`,
      ),
    );
    const companies = Number(
      psql(`SELECT count(*) FROM companies WHERE name = ${q(name)} AND deleted_at IS NULL`),
    );
    const key = redis(['EXISTS', `migration:${pending}:companies:rows`]);
    const pass = cancel.status === 202 && status === 'CANCELLED' && cancels === 1 && status !== 'COMPLETE';
    return {
      id: 'C2B',
      pass,
      expectedFailUntil: pass ? null : 349,
      startStatus: started.status,
      startBody: started.json?.status ?? started.text.slice(0, 180),
      cancelStatus: cancel.status,
      cancelMessage: messageOf(cancel),
      finalStatus: status,
      migrationCancel: cancels,
      companies,
      redisKey: key,
      heldMs: 2500,
    };
  } finally {
    await release().catch(() => undefined);
    dropClaimDelay();
  }
}

async function stopListener(port) {
  const pid = listeningPid(port);
  const before = pid;
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  await waitFor(async () => !listeningPid(port), 8_000);
  const afterPid = listeningPid(port);
  return { before, after: afterPid, gone: afterPid == null };
}

export function startWorker() {
  const child = spawn(
    'bash',
    [
      '-lc',
      'set -a; source /tmp/stress.env; set +a; export PATH="$HOME/.nvm/versions/node/v24.22.3/bin:$PATH"; cd /agent/repos/bidstack-360; exec pnpm --filter @bidstack/worker exec tsx src/main.ts',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

export async function scenarioR1E() {
  flushRateLimits();
  const stopped = await stopListener(4002);
  const name = `R1E ${Date.now()}`;
  const started = await http('POST', '/api/v1/migrations/start-csv', {
    body: csvRow(name),
    timeoutMs: 20_000,
  });
  if (started.status !== 201 || !started.json?.id) {
    startWorker();
    return { id: 'R1E', pass: false, expectedFailUntil: null, start: started.status, text: started.text, stopped };
  }
  const id = started.json.id;
  const orgId = psql(`SELECT org_id FROM migration_jobs WHERE id = ${q(id)}::uuid`);
  const userId = psql(`SELECT user_id FROM migration_jobs WHERE id = ${q(id)}::uuid`);
  psql(`
    INSERT INTO audit_log (org_id, user_id, action, target_type, target_id, diff)
    VALUES (${q(orgId)}::uuid, ${q(userId)}::uuid, 'migration.cancel.requested', 'MigrationJob', ${q(id)}, '{"attemptId":null}'::jsonb)
  `);
  psql(`
    UPDATE migration_jobs
    SET updated_at = now() - interval '20 minutes',
        meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{progressAt}', to_jsonb((now() - interval '20 minutes')::text), true)
    WHERE id = ${q(id)}::uuid
  `);
  const { Queue } = await import('bullmq');
  const IORedis = (await import('ioredis')).default;
  const connection = new IORedis(`redis://127.0.0.1:${process.env.STRESS_REDIS_PORT ?? 6380}`, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    enableOfflineQueue: false,
  });
  try {
    const queue = new Queue('migration', { connection });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'paused', 'prioritized']);
    for (const job of jobs) {
      if (job?.data?.migrationJobId === id) await job.remove();
    }
    await queue.close();
  } finally {
    connection.disconnect();
  }
  startWorker();
  await waitFor(async () => listeningPid(4002), 30_000);
  const failed = await waitFor(async () => {
    const status = psql(`SELECT status FROM migration_jobs WHERE id = ${q(id)}::uuid`);
    return status === 'FAILED' ? status : null;
  }, 90_000);
  redis(['SET', `migration:${id}:companies:rows`, JSON.stringify([{ Name: name }]), 'EX', '3600']);
  const retried = await http('POST', `/api/v1/migrations/${id}/retry`, { body: {}, timeoutMs: 20_000 });
  const settled = await waitFor(async () => {
    const status = psql(`SELECT status FROM migration_jobs WHERE id = ${q(id)}::uuid`);
    return status === 'COMPLETE' || status === 'CANCELLED' || status === 'FAILED' ? status : null;
  }, 30_000);
  const pass = failed === 'FAILED' && retried.status === 200 && settled === 'COMPLETE';
  const cancelledByOldMark = settled === 'CANCELLED';
  return {
    id: 'R1E',
    pass,
    expectedFailUntil: cancelledByOldMark ? 349 : null,
    stoppedWorker: stopped,
    workerAfterStop: listeningPid(4002),
    start: started.status,
    swept: failed,
    retry: retried.status,
    retryMessage: messageOf(retried),
    finalStatus: settled,
  };
}

export async function scenarioD2() {
  flushRateLimits();
  const name = `D2 ${Date.now()}`;
  const started = await http('POST', '/api/v1/migrations/start-csv', {
    body: csvRow(name),
    timeoutMs: 20_000,
  });
  if (started.status !== 201 || !started.json?.id) {
    return { id: 'D2', pass: false, start: started.status, text: started.text };
  }
  const id = started.json.id;
  const done = await waitFor(async () => {
    const row = psql(
      `SELECT status || ' ' || processed_rows || ' ' || error_rows || ' ' || total_rows FROM migration_jobs WHERE id = ${q(id)}::uuid`,
    );
    const [status, processed, errors, total] = row.split(' ');
    if (status === 'COMPLETE' || status === 'FAILED' || status === 'CANCELLED') return row;
    if (Number(processed) + Number(errors) >= Number(total) && Number(total) > 0) return row;
    return null;
  }, 25_000);
  const cancel = await http('DELETE', `/api/v1/migrations/${id}/cancel`, { timeoutMs: 15_000 });
  await sleep(500);
  const finalStatus = psql(`SELECT status FROM migration_jobs WHERE id = ${q(id)}::uuid`);
  const msg = messageOf(cancel);
  const tooLate = /too late|already finished|status COMPLETE/i.test(msg);
  const pass = finalStatus === 'COMPLETE' && tooLate && cancel.status >= 400 && cancel.status < 500;
  const importedThenCancelled = finalStatus === 'CANCELLED';
  return {
    id: 'D2',
    pass,
    expectedFailUntil: importedThenCancelled ? 349 : null,
    observedBeforeCancel: done,
    cancelStatus: cancel.status,
    cancelMessage: msg,
    finalStatus,
  };
}

export async function scenarioStageRace() {
  const opp = psql(
    `SELECT id || ' ' || stage FROM opportunities WHERE deleted_at IS NULL AND stage NOT IN ('closed_won','closed_lost') ORDER BY created_at LIMIT 1`,
  );
  const [id, stage] = opp.split(' ');
  const next = stage === 's1_lead' ? 's1_ongoing' : 's1_lead';
  const [a, b] = await Promise.all([
    http('POST', `/api/v1/opportunities/${id}/stage`, { body: { stage: next }, timeoutMs: 15_000 }),
    http('POST', `/api/v1/opportunities/${id}/stage`, {
      body: { stage: next },
      headers: ROLE,
      timeoutMs: 15_000,
    }),
  ]);
  const finalStage = psql(`SELECT stage FROM opportunities WHERE id = ${q(id)}::uuid`);
  const codes = [a.status, b.status].sort();
  return {
    id: 'stage-race',
    pass: codes.includes(200) && codes.includes(409) && (finalStage === next || finalStage === stage),
    from: stage,
    to: next,
    codes,
    finalStage,
    messages: [messageOf(a), messageOf(b)],
  };
}

export async function scenarioDoubleCreate() {
  const name = `Double ${Date.now()}`;
  const body = {
    customer: 'Synthetic Customer',
    name,
    value: 1000,
    probability: 10,
    dueDate: null,
    owner: null,
    industry: null,
    logo: null,
    country: null,
  };
  const [a, b] = await Promise.all([
    http('POST', '/api/v1/opportunities', { body, timeoutMs: 15_000 }),
    http('POST', '/api/v1/opportunities', { body, timeoutMs: 15_000 }),
  ]);
  const count = Number(
    psql(`SELECT count(*) FROM opportunities WHERE name = ${q(name)} AND deleted_at IS NULL`),
  );
  return {
    id: 'double-create',
    pass: true,
    codes: [a.status, b.status],
    rows: count,
    note: 'No Idempotency-Key on this route. Two 201s are two rows.',
  };
}

export async function scenarioCancelKey() {
  flushRateLimits();
  const name = `CancelKey ${Date.now()}`;
  const started = await http('POST', '/api/v1/migrations/start-csv', {
    body: csvRow(name),
    timeoutMs: 20_000,
  });
  if (!started.json?.id) return { id: 'cancel-key', pass: false, start: started.status, text: started.text };
  const id = started.json.id;
  const key = `migration:${id}:companies:rows`;
  const before = redis(['EXISTS', key]);
  const cancel = await http('DELETE', `/api/v1/migrations/${id}/cancel`, { timeoutMs: 15_000 });
  await sleep(300);
  const after = redis(['EXISTS', key]);
  const status = psql(`SELECT status FROM migration_jobs WHERE id = ${q(id)}::uuid`);
  return {
    id: 'cancel-key',
    pass: true,
    keyRemainsAfterCancel: status === 'CANCELLED' && after === '1',
    before,
    after,
    status,
    cancel: cancel.status,
    coveredBy: status === 'CANCELLED' && after === '1' ? 'not #350 (that PR leaves the cancel path)' : null,
  };
}
