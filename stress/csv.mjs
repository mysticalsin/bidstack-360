import { CAPS, flushRateLimits, http, listeningPid, psql, rssBytes, sleep, zipBomb } from './lib.mjs';

function rows(count) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = { Name: 'N' + i };
  return out;
}

async function peakRss(pid, fn) {
  let peak = rssBytes(pid);
  const timer = setInterval(() => {
    const current = rssBytes(pid);
    if (current != null && (peak == null || current > peak)) peak = current;
  }, 200);
  try {
    const result = await fn();
    return { result, peak, after: rssBytes(pid) };
  } finally {
    clearInterval(timer);
  }
}

export async function scenarioCsv() {
  flushRateLimits();
  const api = listeningPid(4000);
  const worker = listeningPid(4002);
  const workerBefore = rssBytes(worker);
  const ten = await peakRss(api, () =>
    http('POST', '/api/v1/migrations/start-csv', {
      body: {
        source: 'CSV',
        entityType: 'companies',
        rows: rows(10_000),
        mappings: { Name: 'company.name' },
        dedupStrategy: 'skip',
      },
      timeoutMs: 60_000,
    }),
  );
  let tenProgress = null;
  if (ten.result.json?.id) {
    await sleep(3_000);
    tenProgress = psql(
      `SELECT status || ' ' || processed_rows || '/' || total_rows FROM migration_jobs WHERE id = '${ten.result.json.id}'::uuid`,
    );
    await http('DELETE', `/api/v1/migrations/${ten.result.json.id}/cancel`, { timeoutMs: 15_000 });
  }
  const workerDuring = rssBytes(listeningPid(4002));
  const hundred = await peakRss(api, () =>
    http('POST', '/api/v1/migrations/start-csv', {
      body: {
        source: 'CSV',
        entityType: 'companies',
        rows: rows(100_000),
        mappings: { Name: 'company.name' },
        dedupStrategy: 'skip',
      },
      timeoutMs: 30_000,
    }),
  );
  const sheet = rows(100_000)
    .map((row) => row.Name)
    .join('\n');
  const parsed = await peakRss(api, () =>
    http('POST', '/api/v1/migrations/parse-spreadsheet', {
      body: {
        filename: 'hundred.csv',
        contentBase64: Buffer.from('Name\n' + sheet).toString('base64'),
      },
      timeoutMs: 30_000,
    }),
  );
  const malformed = await http('POST', '/api/v1/migrations/parse-spreadsheet', {
    body: { filename: 'bad.xlsx', contentBase64: Buffer.from('this is not a workbook').toString('base64') },
    timeoutMs: 15_000,
  });
  const bomb = zipBomb(32 * 1024 * 1024);
  const bombRes = await peakRss(api, () =>
    http('POST', '/api/v1/migrations/parse-spreadsheet', {
      body: { filename: 'bomb.xlsx', contentBase64: bomb.toString('base64') },
      timeoutMs: 20_000,
    }),
  );
  const huge = await peakRss(api, () =>
    http('POST', '/api/v1/migrations/parse-spreadsheet', {
      body: {
        filename: 'huge.csv',
        contentBase64: Buffer.from('Name\n' + 'H'.repeat(1_000_000)).toString('base64'),
      },
      timeoutMs: 20_000,
    }),
  );
  const workerAfter = rssBytes(listeningPid(4002));
  const workerPeak = Math.max(workerBefore ?? 0, workerDuring ?? 0, workerAfter ?? 0);
  const apiAlive = listeningPid(4000) != null;
  const workerAlive = listeningPid(4002) != null;
  const bomb4xx = bombRes.result.status >= 400 && bombRes.result.status < 500;
  const malformed4xx = malformed.status >= 400 && malformed.status < 500;
  return {
    id: 'csv',
    pass: workerPeak < CAPS.csvWorkerRss && bomb4xx && malformed4xx && apiAlive && workerAlive,
    tenK: { status: ten.result.status, ms: ten.result.ms, apiPeak: ten.peak, progress: tenProgress },
    hundredK: {
      status: hundred.result.status,
      ms: hundred.result.ms,
      apiPeak: hundred.peak,
      body: hundred.result.text.slice(0, 180),
    },
    parse100k: {
      status: parsed.result.status,
      ms: parsed.result.ms,
      returned: Array.isArray(parsed.result.json?.rows) ? parsed.result.json.rows.length : null,
      apiPeak: parsed.peak,
    },
    malformed: { status: malformed.status, ms: malformed.ms, body: malformed.text.slice(0, 180) },
    zipBomb: {
      status: bombRes.result.status,
      ms: bombRes.result.ms,
      apiPeak: bombRes.peak,
      compressed: bomb.length,
      body: bombRes.result.text.slice(0, 180),
    },
    hugeRow: { status: huge.result.status, ms: huge.result.ms, apiPeak: huge.peak },
    workerRssBefore: workerBefore,
    workerRssPeak: workerPeak,
    workerAlive,
    apiAlive,
  };
}
