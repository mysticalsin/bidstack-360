#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/ci-repeat-latest.json';
const DEFAULT_REQUIRED_RUN_COUNT = 10;
const DEFAULT_REQUIRED_CHECKS = [
  'install',
  'audit',
  'db:generate',
  'lint',
  'typecheck',
  'test',
  'build',
];

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_CI_REPEAT_EVIDENCE || DEFAULT_OUTPUT_PATH,
    inputPath:
      process.env.BIDSTACK_CI_REPEAT_INPUT || process.env.BIDSTACK_CI_REPEAT_EVIDENCE_INPUT || '',
    runsJson: process.env.BIDSTACK_CI_REPEAT_RUNS_JSON || '',
    requiredRunCount: parseInteger(
      process.env.BIDSTACK_CI_REQUIRED_RUN_COUNT,
      DEFAULT_REQUIRED_RUN_COUNT,
    ),
    requiredChecks: normalizeCsv(process.env.BIDSTACK_CI_REQUIRED_CHECKS).length
      ? normalizeCsv(process.env.BIDSTACK_CI_REQUIRED_CHECKS)
      : DEFAULT_REQUIRED_CHECKS,
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      parsed.root = argv[index + 1] ?? parsed.root;
      index += 1;
    } else if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
    } else if (arg === '--out') {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      parsed.outputPath = arg.slice('--out='.length);
    } else if (arg === '--input') {
      parsed.inputPath = argv[index + 1] ?? parsed.inputPath;
      index += 1;
    } else if (arg.startsWith('--input=')) {
      parsed.inputPath = arg.slice('--input='.length);
    } else if (arg === '--runs-json') {
      parsed.runsJson = argv[index + 1] ?? parsed.runsJson;
      index += 1;
    } else if (arg.startsWith('--runs-json=')) {
      parsed.runsJson = arg.slice('--runs-json='.length);
    } else if (arg === '--required-run-count') {
      parsed.requiredRunCount = parseInteger(argv[index + 1], parsed.requiredRunCount);
      index += 1;
    } else if (arg.startsWith('--required-run-count=')) {
      parsed.requiredRunCount = parseInteger(
        arg.slice('--required-run-count='.length),
        parsed.requiredRunCount,
      );
    } else if (arg === '--selftest') {
      parsed.selftest = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.root = path.resolve(parsed.root);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack CI repeat evidence writer

Usage:
  node scripts/write-ci-repeat-evidence.mjs --input deploy-evidence/ci-repeat-source.json
  node scripts/write-ci-repeat-evidence.mjs --runs-json '<json>'
  node scripts/write-ci-repeat-evidence.mjs --selftest

Environment:
  BIDSTACK_CI_REPEAT_INPUT
  BIDSTACK_CI_REPEAT_RUNS_JSON
  BIDSTACK_CI_REQUIRED_RUN_COUNT
  BIDSTACK_CI_REQUIRED_CHECKS
  BIDSTACK_CI_REPEAT_EVIDENCE
`);
}

function parseInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'y', 'success', 'succeeded', 'passed'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'failure', 'failed', 'cancelled', 'skipped'].includes(normalized)) {
    return false;
  }
  return null;
}

function isIsoTimestamp(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T/.test(normalized) && Number.isFinite(Date.parse(normalized));
}

function hasPlaceholderSignal(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes('<') ||
    normalized.includes('placeholder') ||
    normalized.includes('changeme') ||
    normalized.includes('todo') ||
    normalized.includes('example.com') ||
    normalized === 'sample'
  );
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && !hasPlaceholderSignal(url.hostname);
  } catch {
    return false;
  }
}

function loadInput(options) {
  if (String(options.runsJson || '').trim()) {
    return {
      source: 'BIDSTACK_CI_REPEAT_RUNS_JSON',
      value: JSON.parse(options.runsJson),
    };
  }

  if (String(options.inputPath || '').trim()) {
    const absolutePath = path.resolve(options.root, options.inputPath);
    return {
      source: options.inputPath,
      value: JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '')),
    };
  }

  throw new Error(
    'CI repeat evidence requires BIDSTACK_CI_REPEAT_INPUT or BIDSTACK_CI_REPEAT_RUNS_JSON',
  );
}

function normalizeCheckValue(value) {
  if (value && typeof value === 'object') {
    return (
      parseBoolean(value.passed) === true ||
      parseBoolean(value.ok) === true ||
      parseBoolean(value.status) === true ||
      parseBoolean(value.conclusion) === true
    );
  }
  return parseBoolean(value) === true;
}

function normalizeChecks(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const checks = {};
  for (const [key, checkValue] of Object.entries(source)) {
    checks[key] = normalizeCheckValue(checkValue);
  }
  return checks;
}

function normalizeRun(run, index, fallback) {
  const checks = normalizeChecks(run.checks || run.jobs || run.requiredChecks);
  return {
    index,
    runId: String(run.runId || run.id || run.number || `run-${index + 1}`),
    attempt: parseInteger(run.attempt, 1),
    url: String(run.url || run.htmlUrl || run.webUrl || '').trim(),
    commit: String(run.commit || run.sha || fallback.releaseCommit || '').trim(),
    branch: String(run.branch || run.ref || fallback.branch || '').trim(),
    status: String(run.status || '')
      .trim()
      .toLowerCase(),
    conclusion: String(run.conclusion || run.result || '')
      .trim()
      .toLowerCase(),
    startedAt: String(run.startedAt || run.createdAt || '').trim(),
    completedAt: String(run.completedAt || run.updatedAt || '').trim(),
    failedSuites: parseInteger(run.failedSuites ?? run.failedSuiteCount, 0),
    skippedSuites: parseInteger(run.skippedSuites ?? run.skippedSuiteCount, 0),
    checks,
  };
}

function runPassed(run, requiredChecks) {
  const statusPassed =
    parseBoolean(run.conclusion) === true ||
    parseBoolean(run.status) === true ||
    (!run.conclusion && !run.status && Object.keys(run.checks).length > 0);
  return (
    statusPassed &&
    run.failedSuites === 0 &&
    run.skippedSuites === 0 &&
    requiredChecks.every((check) => run.checks[check] === true)
  );
}

function normalizeArtifact(rawInput, options, inputSource) {
  const source =
    rawInput?.ciRepeat && typeof rawInput.ciRepeat === 'object' ? rawInput.ciRepeat : rawInput;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('CI repeat input must be a JSON object');
  }

  const requiredRunCount = parseInteger(source.requiredRunCount, options.requiredRunCount);
  const requiredChecks =
    normalizeCsv(source.requiredChecks).length > 0
      ? normalizeCsv(source.requiredChecks)
      : Array.isArray(source.requiredChecks) && source.requiredChecks.length > 0
        ? source.requiredChecks.map(String)
        : options.requiredChecks;
  const releaseCommit = String(
    source.releaseCommit ||
      source.commit ||
      source.sha ||
      process.env.BIDSTACK_CI_RELEASE_COMMIT ||
      '',
  ).trim();
  const branch = String(source.branch || source.ref || process.env.BIDSTACK_CI_BRANCH || '').trim();
  const runs = (
    Array.isArray(source.runs)
      ? source.runs
      : Array.isArray(source.runSummaries)
        ? source.runSummaries
        : []
  ).map((run, index) => normalizeRun(run, index, { releaseCommit, branch }));

  const passedRunCount = runs.filter((run) => runPassed(run, requiredChecks)).length;
  const failedRunCount = runs.length - passedRunCount;
  const skippedSuiteCount = runs.reduce((total, run) => total + run.skippedSuites, 0);
  const failedSuiteCount = runs.reduce((total, run) => total + run.failedSuites, 0);

  const database = source.database || {};
  const privacy = {
    compactRunMetadataIncluded: true,
    rawLogsIncluded: parseBoolean(source.privacy?.rawLogsIncluded) === true,
    rawRunPayloadsIncluded: parseBoolean(source.privacy?.rawRunPayloadsIncluded) === true,
    commandStdoutIncluded: parseBoolean(source.privacy?.commandStdoutIncluded) === true,
    commandStderrIncluded: parseBoolean(source.privacy?.commandStderrIncluded) === true,
    secretsIncluded: parseBoolean(source.privacy?.secretsIncluded) === true,
  };

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'ci-repeat-evidence',
    inputSource: String(inputSource || ''),
    provider: String(source.provider || process.env.BIDSTACK_CI_PROVIDER || '').trim(),
    repository: String(source.repository || process.env.BIDSTACK_CI_REPOSITORY || '').trim(),
    workflow: String(source.workflow || process.env.BIDSTACK_CI_WORKFLOW || '').trim(),
    environment: String(source.environment || process.env.BIDSTACK_DEPLOY_ENV || '').trim(),
    releaseCommit,
    branch,
    requiredRunCount,
    requiredChecks,
    consecutivePassed: parseBoolean(source.consecutivePassed) ?? failedRunCount === 0,
    passedRunCount,
    failedRunCount,
    failedSuiteCount,
    skippedSuiteCount,
    isolatedInfrastructure:
      parseBoolean(source.isolatedInfrastructure) ??
      parseBoolean(database.isolatedInfrastructure) ??
      parseBoolean(database.isolated),
    database: {
      kind: String(database.kind || database.engine || source.databaseKind || 'postgres').trim(),
      isolated:
        parseBoolean(database.isolated) ??
        parseBoolean(database.isolatedInfrastructure) ??
        parseBoolean(source.isolatedInfrastructure),
      pgvectorEnabled:
        parseBoolean(database.pgvectorEnabled) ?? parseBoolean(source.pgvectorEnabled),
    },
    evidenceUrl: String(source.evidenceUrl || source.url || '').trim(),
    privacy,
    runs,
  };

  const validationFailures = validateArtifact(artifact);
  return {
    ...artifact,
    passed: validationFailures.length === 0,
    validationFailures,
  };
}

function validateArtifact(artifact) {
  const failures = [];
  if (hasPlaceholderSignal(artifact.provider))
    failures.push('CI provider is missing or placeholder');
  if (hasPlaceholderSignal(artifact.workflow))
    failures.push('CI workflow is missing or placeholder');
  if (!/^[0-9a-f]{40}$/i.test(artifact.releaseCommit)) {
    failures.push('release commit must be a full 40-character SHA');
  }
  if (hasPlaceholderSignal(artifact.branch)) failures.push('CI branch is missing or placeholder');
  if (!isHttpsUrl(artifact.evidenceUrl))
    failures.push('CI evidence URL must be a non-placeholder HTTPS URL');
  if (!Number.isInteger(artifact.requiredRunCount) || artifact.requiredRunCount < 10) {
    failures.push('CI evidence must require at least 10 consecutive runs');
  }
  if (!Array.isArray(artifact.runs) || artifact.runs.length < artifact.requiredRunCount) {
    failures.push('CI evidence must include every required run summary');
  }
  if (artifact.passedRunCount < artifact.requiredRunCount) {
    failures.push('CI evidence has fewer than the required passing runs');
  }
  if (artifact.failedRunCount !== 0) failures.push('CI repeat proof contains failed runs');
  if (artifact.failedSuiteCount !== 0) failures.push('CI repeat proof contains failed suites');
  if (artifact.skippedSuiteCount !== 0) failures.push('CI repeat proof contains skipped suites');
  if (artifact.consecutivePassed !== true) failures.push('CI repeat proof must be consecutive');
  if (artifact.isolatedInfrastructure !== true || artifact.database.isolated !== true) {
    failures.push('CI repeat proof must use isolated infrastructure');
  }
  if (artifact.database.pgvectorEnabled !== true) {
    failures.push('CI repeat proof must use pgvector-enabled Postgres');
  }
  for (const flag of [
    'rawLogsIncluded',
    'rawRunPayloadsIncluded',
    'commandStdoutIncluded',
    'commandStderrIncluded',
    'secretsIncluded',
  ]) {
    if (artifact.privacy?.[flag] === true) failures.push(`CI artifact must not include ${flag}`);
  }
  for (const [index, run] of (artifact.runs || []).entries()) {
    if (!/^[0-9a-f]{40}$/i.test(run.commit) || run.commit !== artifact.releaseCommit) {
      failures.push(`CI run ${index + 1} is not tied to the release commit`);
    }
    if (run.branch !== artifact.branch) failures.push(`CI run ${index + 1} branch mismatch`);
    if (!isHttpsUrl(run.url)) failures.push(`CI run ${index + 1} URL must be HTTPS`);
    if (!isIsoTimestamp(run.completedAt))
      failures.push(`CI run ${index + 1} completedAt must be ISO`);
    if (!runPassed(run, artifact.requiredChecks)) {
      failures.push(`CI run ${index + 1} is not a complete passing full-suite run`);
    }
  }
  return failures;
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = path.resolve(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function runWriter(options) {
  const input = loadInput(options);
  const artifact = normalizeArtifact(input.value, options, input.source);
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);

  process.stdout.write(`CI repeat evidence: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Provider: ${artifact.provider || 'missing'}\n`);
  process.stdout.write(`Workflow: ${artifact.workflow || 'missing'}\n`);
  process.stdout.write(`Release commit: ${artifact.releaseCommit || 'missing'}\n`);
  process.stdout.write(
    `Runs: ${artifact.passedRunCount}/${artifact.requiredRunCount} passing, failed=${artifact.failedRunCount}, skippedSuites=${artifact.skippedSuiteCount}\n`,
  );

  if (artifact.validationFailures.length > 0) {
    for (const failure of artifact.validationFailures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    return 1;
  }

  process.stdout.write('CI repeat evidence passed\n');
  return 0;
}

function createGoodInput(overrides = {}) {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const checks = Object.fromEntries(DEFAULT_REQUIRED_CHECKS.map((check) => [check, true]));
  return {
    provider: 'github-actions',
    repository: 'mantu/bidstack-360',
    workflow: 'ci.yml',
    environment: 'staging',
    releaseCommit: commit,
    branch: 'demo',
    requiredRunCount: 10,
    requiredChecks: DEFAULT_REQUIRED_CHECKS,
    consecutivePassed: true,
    isolatedInfrastructure: true,
    database: { kind: 'postgres', isolated: true, pgvectorEnabled: true },
    evidenceUrl: 'https://github.com/mantu/bidstack-360/actions?query=branch%3Ademo',
    privacy: {
      rawLogsIncluded: false,
      rawRunPayloadsIncluded: false,
      commandStdoutIncluded: false,
      commandStderrIncluded: false,
      secretsIncluded: false,
    },
    runs: Array.from({ length: 10 }, (_, index) => ({
      runId: `ci-${1000 + index}`,
      attempt: 1,
      url: `https://github.com/mantu/bidstack-360/actions/runs/${1000 + index}`,
      commit,
      branch: 'demo',
      status: 'success',
      conclusion: 'success',
      startedAt: `2026-06-18T10:${String(index).padStart(2, '0')}:00.000Z`,
      completedAt: `2026-06-18T10:${String(index + 1).padStart(2, '0')}:00.000Z`,
      failedSuites: 0,
      skippedSuites: 0,
      checks,
    })),
    ...overrides,
  };
}

function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidcrm-ci-repeat-'));
  try {
    const good = normalizeArtifact(createGoodInput(), {
      requiredRunCount: 10,
      requiredChecks: DEFAULT_REQUIRED_CHECKS,
    });
    assert.equal(good.passed, true, good.validationFailures.join(', '));
    assert.equal(good.runs.length, 10);
    assert.equal(good.skippedSuiteCount, 0);

    const tooFew = normalizeArtifact(
      createGoodInput({ runs: createGoodInput().runs.slice(0, 9) }),
      {
        requiredRunCount: 10,
        requiredChecks: DEFAULT_REQUIRED_CHECKS,
      },
    );
    assert.equal(tooFew.passed, false);
    assert.equal(
      tooFew.validationFailures.some((failure) =>
        failure.includes('include every required run summary'),
      ),
      true,
    );

    const wrongCommitInput = createGoodInput();
    wrongCommitInput.runs[4] = {
      ...wrongCommitInput.runs[4],
      commit: 'ffffffffffffffffffffffffffffffffffffffff',
    };
    const wrongCommit = normalizeArtifact(wrongCommitInput, {
      requiredRunCount: 10,
      requiredChecks: DEFAULT_REQUIRED_CHECKS,
    });
    assert.equal(wrongCommit.passed, false);
    assert.equal(
      wrongCommit.validationFailures.some((failure) =>
        failure.includes('not tied to the release commit'),
      ),
      true,
    );

    const skippedInput = createGoodInput();
    skippedInput.runs[2] = { ...skippedInput.runs[2], skippedSuites: 1 };
    const skipped = normalizeArtifact(skippedInput, {
      requiredRunCount: 10,
      requiredChecks: DEFAULT_REQUIRED_CHECKS,
    });
    assert.equal(skipped.passed, false);
    assert.equal(
      skipped.validationFailures.some((failure) => failure.includes('skipped suites')),
      true,
    );

    const unsafe = normalizeArtifact(
      createGoodInput({ privacy: { ...createGoodInput().privacy, rawLogsIncluded: true } }),
      {
        requiredRunCount: 10,
        requiredChecks: DEFAULT_REQUIRED_CHECKS,
      },
    );
    assert.equal(unsafe.passed, false);
    assert.equal(
      unsafe.validationFailures.some((failure) => failure.includes('rawLogsIncluded')),
      true,
    );

    const inputPath = path.join(root, 'ci-input.json');
    writeFileSync(inputPath, `${JSON.stringify(createGoodInput(), null, 2)}\n`, 'utf8');
    const input = loadInput({ root, inputPath, runsJson: '' });
    const fromFile = normalizeArtifact(input.value, {
      requiredRunCount: 10,
      requiredChecks: DEFAULT_REQUIRED_CHECKS,
    });
    assert.equal(fromFile.passed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write('CI repeat evidence selftest passed\n');
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    runSelftest();
  } else {
    process.exit(runWriter(args));
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
