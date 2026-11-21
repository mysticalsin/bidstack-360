import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scenarioCsv } from './csv.mjs';
import {
  dropClaimDelay,
  scenarioB11,
  scenarioC2B,
  scenarioCancelKey,
  scenarioD2,
  scenarioDifferentFiles,
  scenarioDoubleCreate,
  scenarioR1E,
  scenarioSameFile,
  scenarioStageRace,
} from './hammer.mjs';
import { scenarioFaults, scenarioBoot } from './faults.mjs';
import { CAPS, listeningPid, rssBytes, sha256File, sleep } from './lib.mjs';
import { scenarioLoad } from './load.mjs';
import { scenarioSoak } from './soak.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repo = dirname(root);
const started = Date.now();

function headSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

function writeChecksums() {
  const files = [
    'stress/run.mjs',
    'stress/lib.mjs',
    'stress/load.mjs',
    'stress/hammer.mjs',
    'stress/csv.mjs',
    'stress/faults.mjs',
    'stress/soak.mjs',
    'stress/README.md',
  ];
  const lines = files.map((file) => `${sha256File(join(repo, file))}  ${file}`);
  writeFileSync(join(repo, 'stress/SHA256SUMS'), lines.join('\n') + '\n');
  return lines;
}

async function guard(name, fn) {
  const watchdog = setInterval(() => {
    if (Date.now() - started > CAPS.hardTimeoutMs) {
      console.error('hard timeout');
      process.exit(2);
    }
    const limits = [
      [4000, CAPS.apiRss, 'api'],
      [4002, CAPS.workerRss, 'worker'],
      [38081, CAPS.webRss, 'web'],
    ];
    for (const [port, cap, label] of limits) {
      const pid = listeningPid(port);
      const rss = rssBytes(pid);
      if (rss != null && rss > cap) {
        console.error(label, 'rss', rss, 'over', cap);
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
    const self = rssBytes(process.pid);
    if (self != null && self > CAPS.harnessRss) {
      console.error('harness rss', self);
      process.exit(2);
    }
  }, 2_000);
  try {
    return await fn();
  } catch (err) {
    return { id: name, pass: false, error: err instanceof Error ? err.stack : String(err) };
  } finally {
    clearInterval(watchdog);
    await sleep(200);
    returnAfter(name);
  }
}

function returnAfter(name) {
  const again = {
    api: rssBytes(listeningPid(4000)),
    worker: rssBytes(listeningPid(4002)),
    web: rssBytes(listeningPid(38081)),
  };
  console.error('remeasure', name, JSON.stringify(again));
}

async function main() {
  const head = headSha();
  const checksums = writeChecksums();
  const results = [];
  const steps = [
    ['load', scenarioLoad],
    ['B11', scenarioB11],
    ['same-csv', scenarioSameFile],
    ['different-csv', scenarioDifferentFiles],
    ['stage-race', scenarioStageRace],
    ['double-create', scenarioDoubleCreate],
    ['C2B', scenarioC2B],
    ['cancel-key', scenarioCancelKey],
    ['D2', scenarioD2],
    ['csv', scenarioCsv],
    ['R1E', scenarioR1E],
    ['faults', scenarioFaults],
    ['boot', scenarioBoot],
    ['soak', scenarioSoak],
  ];
  for (const [name, fn] of steps) {
    console.error('run', name);
    const value = await guard(name, fn);
    results.push(value);
    writeFileSync(
      join(repo, 'stress/LAST-RUN.json'),
      JSON.stringify({ head: headSha(), partial: true, results }, null, 2) + '\n',
    );
    console.error('done', name, value?.pass, value?.expectedFailUntil ?? '', JSON.stringify(value).slice(0, 500));
  }
  dropClaimDelay();
  const report = {
    head,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    checksums,
    caps: CAPS,
    results,
  };
  writeFileSync(join(repo, 'stress/LAST-RUN.json'), JSON.stringify(report, null, 2) + '\n');
  const unexpected = results.filter((row) => row && row.pass === false && !row.expectedFailUntil && !row.coveredBy);
  console.log(JSON.stringify({ head, unexpected: unexpected.map((row) => row.id) }));
  process.exit(unexpected.length ? 1 : 0);
}

await main();
