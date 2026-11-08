#!/usr/bin/env node
// Compliance evidence writer.
//
// Reads docs/compliance/controls.json and writes one <control-id>.json per
// control plus index.json into the evidence folder (default
// deploy-evidence/compliance/). Each file records:
//   - checks: mapped code and test paths exist, mapped CI jobs exist in the
//     workflow files, the evidence script exists, assertions still hold, the
//     control is listed in CONTROL-MAP.md, gaps are written down
//   - config: which compliance env vars are set (names and booleans only,
//     never values)
//   - tests (with --run-tests): vitest results for the control's unit tests
//   - counts (with --with-db): data subject requests, GDPR audit events,
//     orgs with a data region
//
// Modes:
//   --check       CI-safe: no database, no network, no test run. Exit 1 on a failed check.
//   --run-tests   also run the mapped unit tests (*.test.ts, not *.integration.test.ts)
//   --with-db     also collect counts using DATABASE_URL
//   --out DIR     evidence folder
//   --selftest    exercise the checker against a synthetic repo and exit

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUT = 'deploy-evidence/compliance';
const REGISTER = 'docs/compliance/controls.json';
const CONTROL_MAP = 'docs/compliance/CONTROL-MAP.md';
const STATUSES = new Set(['implemented', 'partial', 'gap']);
const CONFIG_NAME =
  /^(RETENTION_[A-Z_]+|DATA_RESIDENCY_ENFORCE|S3_BUCKET(_[A-Z]{2})?|S3_REGION(_[A-Z]{2})?|AI_AUDIT_RETENTION_DAYS|PII_ENCRYPTION_KEY)$/;

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    out: DEFAULT_OUT,
    check: false,
    runTests: false,
    withDb: false,
    selftest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--run-tests') args.runTests = true;
    else if (a === '--with-db') args.withDb = true;
    else if (a === '--selftest') args.selftest = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--root') args.root = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

/** job keys per workflow file, e.g. { 'ci.yml': Set{'unit', ...} } */
export function workflowJobs(root) {
  const dir = path.join(root, '.github/workflows');
  const out = {};
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    const i = text.search(/^jobs:\s*$/m);
    if (i < 0) continue;
    out[file] = new Set(
      [...text.slice(i).matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]),
    );
  }
  return out;
}

export function checkControl(root, control, ctx) {
  const checks = [];
  const add = (name, ok, detail) => checks.push(detail ? { name, ok, detail } : { name, ok });

  add('id and title present', Boolean(control.id && control.title));
  add('framework present', Boolean(control.framework));
  add('status is implemented, partial or gap', STATUSES.has(control.status));
  if (control.status !== 'implemented')
    add('gap is written down', Boolean(control.gap && control.gap.length > 10));
  for (const p of control.code ?? []) add(`code exists: ${p}`, existsSync(path.join(root, p)));
  for (const p of control.tests ?? []) add(`test exists: ${p}`, existsSync(path.join(root, p)));
  for (const job of control.ciJobs ?? []) {
    const [file, key] = job.split('#');
    add(`ci job exists: ${job}`, Boolean(ctx.jobs[file]?.has(key)));
  }
  add(
    `evidence script exists: ${control.evidenceScript}`,
    Boolean(control.evidenceScript) && existsSync(path.join(root, control.evidenceScript)),
  );
  for (const a of control.assertions ?? []) {
    const file = path.join(root, a.file);
    const ok = existsSync(file) && readFileSync(file, 'utf8').includes(a.contains);
    add(`assertion: ${a.file} contains ${JSON.stringify(a.contains)}`, ok);
  }
  add('listed in CONTROL-MAP.md', ctx.controlMap.includes(control.id));
  return checks;
}

function collectConfig(root) {
  const names = new Set();
  const example = path.join(root, '.env.example');
  if (existsSync(example)) {
    for (const m of readFileSync(example, 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) {
      if (CONFIG_NAME.test(m[1])) names.add(m[1]);
    }
  }
  const out = {};
  for (const n of [...names].sort()) out[n] = { documented: true, set: Boolean(process.env[n]) };
  return out;
}

function runTests(root, controls) {
  const byPkg = new Map();
  for (const c of controls) {
    for (const t of c.tests ?? []) {
      if (t.endsWith('.integration.test.ts') || !/\.test\.tsx?$/.test(t)) continue;
      const m = t.match(/^((?:apps|packages)\/[^/]+)\/(.+)$/);
      if (!m) continue;
      if (!byPkg.has(m[1])) byPkg.set(m[1], new Set());
      byPkg.get(m[1]).add(m[2]);
    }
  }
  const results = {};
  for (const [pkg, files] of byPkg) {
    const report = path.join(mkdtempSync(path.join(tmpdir(), 'ce-')), 'vitest.json');
    spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', ...files, '--reporter=json', `--outputFile=${report}`],
      {
        cwd: path.join(root, pkg),
        encoding: 'utf8',
        stdio: 'ignore',
      },
    );
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(report, 'utf8'));
    } catch {
      parsed = null;
    }
    for (const f of files) {
      const r = parsed?.testResults?.find((x) => x.name.endsWith(f));
      results[`${pkg}/${f}`] = r
        ? {
            status: r.status,
            passed: r.assertionResults.filter((a) => a.status === 'passed').length,
            total: r.assertionResults.length,
          }
        : { status: 'not-run' };
    }
  }
  return results;
}

async function collectCounts(root) {
  if (!process.env.DATABASE_URL) return { skipped: 'DATABASE_URL not set' };
  try {
    const require = createRequire(path.join(root, 'packages/db/package.json'));
    const { PrismaClient } = require('./generated/client/index.js');
    const db = new PrismaClient();
    try {
      const n = async (sql) => Number((await db.$queryRawUnsafe(sql))[0]?.n ?? 0);
      return {
        dataSubjectRequestsDone: await n(
          `SELECT count(*)::int AS n FROM data_subject_requests WHERE status = 'done'`,
        ),
        dataSubjectRequestsFailed: await n(
          `SELECT count(*)::int AS n FROM data_subject_requests WHERE status = 'failed'`,
        ),
        gdprAuditEvents: await n(
          `SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'gdpr.%'`,
        ),
        orgsWithDataRegion: await n(
          `SELECT count(*)::int AS n FROM org_settings WHERE data_region IS NOT NULL`,
        ),
      };
    } finally {
      await db.$disconnect();
    }
  } catch (err) {
    return { error: String(err?.message ?? err).slice(0, 200) };
  }
}

export async function writeEvidence(args) {
  const { root } = args;
  const register = JSON.parse(readFileSync(path.join(root, REGISTER), 'utf8'));
  const controls = register.controls;
  const ctx = {
    jobs: workflowJobs(root),
    controlMap: existsSync(path.join(root, CONTROL_MAP))
      ? readFileSync(path.join(root, CONTROL_MAP), 'utf8')
      : '',
  };
  const outDir = path.resolve(root, args.out);
  mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const config = collectConfig(root);
  const tests = args.runTests && !args.check ? (args.runTestsImpl ?? runTests)(root, controls) : null;
  const counts = args.withDb && !args.check ? await collectCounts(root) : null;

  const seen = new Set();
  const index = [];
  for (const c of controls) {
    const checks = checkControl(root, c, ctx);
    if (seen.has(c.id)) checks.push({ name: 'id is unique', ok: false });
    seen.add(c.id);
    // A requested test run that failed or never ran must fail the control.
    for (const t of (c.tests ?? []).filter((x) => tests?.[x])) {
      checks.push({ name: `test passed: ${t}`, ok: tests[t].status === 'passed' });
    }
    const evidence = {
      control: c.id,
      framework: c.framework,
      title: c.title,
      status: c.status,
      gap: c.gap ?? null,
      generatedAt,
      mode: args.check ? 'check' : 'full',
      checks,
      config,
      ...(tests
        ? {
            tests: Object.fromEntries(
              (c.tests ?? []).filter((t) => tests[t]).map((t) => [t, tests[t]]),
            ),
          }
        : {}),
      ...(counts ? { counts } : {}),
    };
    writeFileSync(path.join(outDir, `${c.id}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    index.push({ id: c.id, status: c.status, ok: checks.every((x) => x.ok) });
  }
  const failed = index.filter((x) => !x.ok).map((x) => x.id);
  writeFileSync(
    path.join(outDir, 'index.json'),
    `${JSON.stringify({ generatedAt, total: index.length, failed, byStatus: countBy(index, 'status'), controls: index }, null, 2)}\n`,
  );
  return { total: index.length, failed, outDir };
}

function countBy(rows, key) {
  return rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});
}

async function selftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'compliance-selftest-'));
  try {
    const w = (p, s) => {
      mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
      writeFileSync(path.join(root, p), s);
    };
    w(
      '.github/workflows/ci.yml',
      'on: push\njobs:\n  unit:\n    runs-on: x\n  integration:\n    runs-on: x\n',
    );
    w('src/a.ts', 'export const requirePermission = 1;\n');
    w('src/a.test.ts', '');
    w('scripts/write-x-evidence.mjs', '');
    w('.env.example', 'RETENTION_MODE=\nOTHER_SECRET=\n');
    w(CONTROL_MAP, 'GOOD-1 BAD-1 GAP-1\n');
    const base = {
      framework: 'SOC 2 TSC',
      title: 't',
      evidenceScript: 'scripts/write-x-evidence.mjs',
    };
    w(
      REGISTER,
      JSON.stringify({
        controls: [
          {
            ...base,
            id: 'GOOD-1',
            status: 'implemented',
            code: ['src/a.ts'],
            tests: ['src/a.test.ts'],
            ciJobs: ['ci.yml#unit'],
            assertions: [{ file: 'src/a.ts', contains: 'requirePermission' }],
          },
          {
            ...base,
            id: 'BAD-1',
            status: 'implemented',
            code: ['src/missing.ts'],
            tests: [],
            ciJobs: ['ci.yml#e2e'],
            assertions: [{ file: 'src/a.ts', contains: 'nope' }],
          },
          { ...base, id: 'GAP-1', status: 'gap', code: [], tests: [], ciJobs: [] },
          {
            ...base,
            id: 'UNMAPPED-1',
            status: 'implemented',
            code: [],
            tests: [],
            ciJobs: [],
            evidenceScript: 'scripts/none.mjs',
          },
        ],
      }),
    );
    const res = await writeEvidence({ root, out: 'ev', check: true });
    assert.equal(res.total, 4);
    assert.deepEqual(res.failed.sort(), ['BAD-1', 'GAP-1', 'UNMAPPED-1']);
    const bad = JSON.parse(readFileSync(path.join(root, 'ev/BAD-1.json'), 'utf8'));
    const failedNames = bad.checks.filter((c) => !c.ok).map((c) => c.name);
    assert.ok(failedNames.includes('code exists: src/missing.ts'));
    assert.ok(failedNames.includes('ci job exists: ci.yml#e2e'));
    assert.ok(failedNames.some((n) => n.startsWith('assertion:')));
    const gap = JSON.parse(readFileSync(path.join(root, 'ev/GAP-1.json'), 'utf8'));
    assert.deepEqual(
      gap.checks.filter((c) => !c.ok).map((c) => c.name),
      ['gap is written down'],
    );
    const unmapped = JSON.parse(readFileSync(path.join(root, 'ev/UNMAPPED-1.json'), 'utf8'));
    assert.ok(unmapped.checks.some((c) => c.name === 'listed in CONTROL-MAP.md' && !c.ok));
    assert.ok(unmapped.checks.some((c) => c.name.startsWith('evidence script exists') && !c.ok));
    const good = JSON.parse(readFileSync(path.join(root, 'ev/GOOD-1.json'), 'utf8'));
    assert.ok(good.checks.every((c) => c.ok));
    assert.deepEqual(Object.keys(good.config), ['RETENTION_MODE']);
    assert.equal(typeof good.config.RETENTION_MODE.set, 'boolean');
    assert.ok(existsSync(path.join(root, 'ev/index.json')));

    const runTestsImpl = () => ({ 'src/a.test.ts': { status: 'not-run' } });
    const notRun = await writeEvidence({ root, out: 'ev-tests', runTests: true, runTestsImpl });
    assert.ok(notRun.failed.includes('GOOD-1'));
    const passing = await writeEvidence({
      root,
      out: 'ev-tests-ok',
      runTests: true,
      runTestsImpl: () => ({ 'src/a.test.ts': { status: 'passed', passed: 1, total: 1 } }),
    });
    assert.ok(!passing.failed.includes('GOOD-1'));
    console.log('write-compliance-evidence selftest passed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.selftest) {
  await selftest();
} else {
  const res = await writeEvidence(args);
  console.log(
    `compliance evidence: ${res.total} controls written to ${path.relative(process.cwd(), res.outDir) || '.'}`,
  );
  if (res.failed.length) {
    console.error(`compliance evidence: failed checks in ${res.failed.join(', ')}`);
    process.exitCode = 1;
  }
}
