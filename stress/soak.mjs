import { API, CAPS, listeningPid, psql, redis, rssBytes, sleep } from './lib.mjs';
import { loadAutocannon } from './load.mjs';

function clients() {
  const text = redis(['CLIENT', 'LIST']);
  return text ? text.split('\n').filter(Boolean).length : 0;
}

function pgConnections() {
  return Number(psql(`SELECT count(*) FROM pg_stat_activity WHERE datname = 'bidstack'`));
}

export async function scenarioSoak() {
  if (CAPS.soakSeconds <= 0) return { id: 'soak', skipped: true, pass: true };
  const autocannon = loadAutocannon();
  const apiPid = listeningPid(4000);
  const workerPid = listeningPid(4002);
  const webPid = listeningPid(38081);
  const baseline = {
    api: rssBytes(apiPid),
    worker: rssBytes(workerPid),
    web: rssBytes(webPid),
    pg: pgConnections(),
    redis: clients(),
  };
  const samples = [];
  let serverErrors = 0;
  const instance = autocannon({
    url: API + '/api/v1/tasks?limit=20',
    connections: 2,
    duration: CAPS.soakSeconds,
    timeout: 10,
    requests: [
      { path: '/api/v1/crm/dashboard' },
      { path: '/api/v1/accounts/key' },
      { path: '/api/v1/opportunities?limit=20' },
      { path: '/api/v1/tasks?limit=20' },
    ],
  });
  instance.on('response', (_client, statusCode) => {
    if (Number(statusCode) >= 500) serverErrors += 1;
  });
  const started = Date.now();
  const sampler = setInterval(() => {
    samples.push({
      t: Math.round((Date.now() - started) / 1000),
      api: rssBytes(listeningPid(4000)),
      worker: rssBytes(listeningPid(4002)),
      web: rssBytes(listeningPid(38081)),
      pg: pgConnections(),
      redis: clients(),
    });
  }, 30_000);
  await new Promise((resolve, reject) => {
    instance.on('done', resolve);
    instance.on('error', reject);
  });
  clearInterval(sampler);
  const warm = samples.find((row) => row.t >= CAPS.soakWarmupSeconds) ?? samples[0];
  const last = samples[samples.length - 1];
  await sleep(15_000);
  const drained = {
    api: rssBytes(listeningPid(4000)),
    worker: rssBytes(listeningPid(4002)),
    web: rssBytes(listeningPid(38081)),
    pg: pgConnections(),
    redis: clients(),
    sampledAfterDrain: true,
  };
  function growth(after, before) {
    if (after == null || before == null || before === 0) return null;
    return (after - before) / before;
  }
  const apiGrowth = growth(last?.api, warm?.api);
  const workerGrowth = growth(last?.worker, warm?.worker);
  const webGrowth = growth(last?.web, warm?.web);
  const pgBack = drained.pg <= baseline.pg + 2;
  const redisBack = drained.redis <= baseline.redis + 2;
  const pass =
    serverErrors === 0 &&
    (apiGrowth == null || apiGrowth <= CAPS.soakRssGrowth) &&
    (workerGrowth == null || workerGrowth <= CAPS.soakRssGrowth) &&
    (webGrowth == null || webGrowth <= CAPS.soakRssGrowth) &&
    pgBack &&
    redisBack;
  return {
    id: 'soak',
    pass,
    seconds: CAPS.soakSeconds,
    serverErrors,
    baseline,
    warm,
    last,
    drained,
    growth: { api: apiGrowth, worker: workerGrowth, web: webGrowth },
    samples: samples.length,
  };
}
