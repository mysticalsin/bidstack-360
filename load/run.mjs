#!/usr/bin/env node
/**
 * Stress suite for the Polo API and MCP server (autocannon).
 *
 * Scenarios (load/scenarios.mjs): dashboard reads, write mix, search, export,
 * MCP tools. Each runs CONNECTIONS concurrent connections for DURATION
 * seconds and reports p50/p95/p99 latency, throughput and the error split
 * (5xx, 429, other 4xx, socket errors, timeouts).
 *
 * Usage:
 *   node load/run.mjs [--scenario dashboard,write] [--out results.json] [--md results.md]
 * Environment:
 *   API_URL       default http://127.0.0.1:4000 (stub auth, loopback only)
 *   MCP_URL       default http://127.0.0.1:4001 (MCP scenario skipped if unreachable)
 *   CONNECTIONS   default 100
 *   DURATION      seconds, default 60
 *   LOAD_ROLE     stub role header (BIDSTACK_ALLOW_STUB_ROLE_HEADER=true), default admin
 *
 * The API must run with stub auth and API_RATE_LIMIT_MAX raised (e.g.
 * 10000000), otherwise the per-user limiter answers 429 and the run measures
 * the limiter. Per-route limits (search 120/min) are left on and reported as
 * 429s. Seed bulk data first: psql < load/seed-bulk.sql.
 *
 * autocannon is installed on first use into load/.deps (gitignored) so the
 * workspace lockfile stays untouched.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildScenarios } from './scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEPS = path.join(HERE, '.deps');
const AUTOCANNON_VERSION = '8.0.0';

function loadAutocannon() {
  const pkg = path.join(DEPS, 'node_modules', 'autocannon', 'package.json');
  if (!existsSync(pkg)) {
    mkdirSync(DEPS, { recursive: true });
    execFileSync(
      'npm',
      ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', DEPS, `autocannon@${AUTOCANNON_VERSION}`],
      { stdio: 'inherit' },
    );
  }
  return createRequire(pkg)('autocannon');
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runOne(autocannon, scenario, { connections, duration }) {
  return new Promise((resolve, reject) => {
    const statusCounts = {};
    const latencies = [];
    const instance = autocannon(
      {
        url: scenario.url,
        connections,
        duration,
        timeout: 30,
        requests: scenario.requests,
        headers: scenario.headers,
      },
      (err, result) => (err ? reject(err) : resolve({ result, statusCounts, latencies })),
    );
    instance.on('response', (_client, statusCode, _bytes, responseTime) => {
      statusCounts[statusCode] = (statusCounts[statusCode] ?? 0) + 1;
      latencies.push(responseTime);
    });
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}

function summarize(name, { result, statusCounts, latencies }) {
  const sorted = Float64Array.from(latencies).sort();
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const sum = (pred) =>
    Object.entries(statusCounts)
      .filter(([code]) => pred(Number(code)))
      .reduce((a, [, n]) => a + n, 0);
  const s5xx = sum((c) => c >= 500);
  const s429 = sum((c) => c === 429);
  const s4xx = sum((c) => c >= 400 && c < 500 && c !== 429);
  const failures = s5xx + s4xx + result.errors + result.timeouts;
  const attempts = total + result.errors + result.timeouts;
  return {
    scenario: name,
    requests: total,
    rps: Math.round(result.requests.average),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
    s5xx,
    s429,
    s4xx,
    socketErrors: result.errors,
    timeouts: result.timeouts,
    errorRate: attempts ? Number(((failures / attempts) * 100).toFixed(2)) : 0,
    statusCounts,
  };
}

function toMarkdown(rows, meta) {
  const head =
    `Connections ${meta.connections}, ${meta.duration} s per scenario, ${meta.startedAt}\n\n` +
    '| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | 5xx | 429 | other 4xx | socket err | timeouts | error rate % |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';
  return (
    head +
    rows
      .map(
        (r) =>
          `| ${r.scenario} | ${r.requests} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.s5xx} | ${r.s429} | ${r.s4xx} | ${r.socketErrors} | ${r.timeouts} | ${r.errorRate} |`,
      )
      .join('\n') +
    '\n'
  );
}

async function main() {
  const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';
  const mcpUrl = process.env.MCP_URL ?? 'http://127.0.0.1:4001';
  const connections = Number(process.env.CONNECTIONS ?? 100);
  const duration = Number(process.env.DURATION ?? 60);
  const role = process.env.LOAD_ROLE ?? 'admin';
  const only = arg('--scenario')?.split(',');

  const autocannon = loadAutocannon();
  const scenarios = await buildScenarios({ apiUrl, mcpUrl, role });
  const meta = { connections, duration, startedAt: new Date().toISOString(), apiUrl, mcpUrl };
  const rows = [];
  for (const scenario of scenarios) {
    if (only && !only.includes(scenario.name)) continue;
    if (scenario.skip) {
      console.log(`skip ${scenario.name}: ${scenario.skip}`);
      continue;
    }
    console.log(`run ${scenario.name} (${connections} connections, ${duration} s)`);
    const row = summarize(scenario.name, await runOne(autocannon, scenario, { connections, duration }));
    console.log(JSON.stringify(row));
    rows.push(row);
  }
  const out = arg('--out');
  if (out) writeFileSync(out, `${JSON.stringify({ meta, rows }, null, 2)}\n`);
  const md = arg('--md');
  if (md) writeFileSync(md, toMarkdown(rows, meta));
  console.log(toMarkdown(rows, meta));
}

await main();
