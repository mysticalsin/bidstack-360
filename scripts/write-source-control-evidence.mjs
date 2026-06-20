#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/source-control-latest.json';
const STATUS_SAMPLE_LIMIT = 50;
const REVIEW_SAMPLE_LIMIT = 8;
const TRACKED_LOCAL_ARTIFACT_PREFIXES = ['.claude/worktrees/'];
const PATH_GROUPS = [
  { id: 'api', label: 'API', prefixes: ['apps/api/'] },
  { id: 'web', label: 'Web', prefixes: ['apps/web/'] },
  { id: 'worker', label: 'Worker', prefixes: ['apps/worker/'] },
  { id: 'mcp', label: 'MCP server', prefixes: ['apps/mcp-server/'] },
  { id: 'packages', label: 'Shared packages', prefixes: ['packages/'] },
  { id: 'scripts', label: 'Scripts', prefixes: ['scripts/'] },
  { id: 'docs', label: 'Docs', prefixes: ['docs/'] },
  { id: 'infra', label: 'Infra', prefixes: ['infra/', '.github/'] },
  { id: 'config', label: 'Root config', prefixes: [] },
];
const ROOT_CONFIG_FILES = new Set([
  '.dockerignore',
  '.env.example',
  '.gitignore',
  'Dockerfile',
  'docker-compose.prod.yml',
  'eslint.config.js',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
]);
const REVIEW_BUCKETS = [
  {
    id: 'secret_or_env',
    label: 'Secret/env-sensitive files',
    matches: (file) =>
      /(^|\/)\.env($|[.\-_])|(^|\/)(secrets?|credentials?|tokens?)($|[.\-_])|(\.pem|\.pfx|\.key)$/i.test(
        file,
      ),
  },
  {
    id: 'schema_or_migration',
    label: 'Database schema/migration files',
    matches: (file) =>
      file.includes('/prisma/') ||
      file.includes('/migrations/') ||
      file.startsWith('packages/db/'),
  },
  {
    id: 'release_config',
    label: 'Release/configuration files',
    matches: (file) =>
      ROOT_CONFIG_FILES.has(file) ||
      file.startsWith('infra/') ||
      file.startsWith('.github/') ||
      file.startsWith('scripts/ops/') ||
      /(^|\/)(Dockerfile|docker-compose|nginx\.conf)$/i.test(file),
  },
  {
    id: 'security_auth',
    label: 'Security/auth/access files',
    matches: (file) =>
      /(auth|rbac|access|sentry|cors|secret|crypto|token|credential|permission|policy)/i.test(
        file,
      ),
  },
  {
    id: 'runtime_code',
    label: 'Runtime code',
    matches: (file) =>
      file.startsWith('apps/api/') ||
      file.startsWith('apps/worker/') ||
      file.startsWith('apps/mcp-server/') ||
      file.startsWith('packages/'),
  },
  {
    id: 'frontend_ux',
    label: 'Frontend UX',
    matches: (file) => file.startsWith('apps/web/'),
  },
  {
    id: 'documentation',
    label: 'Documentation',
    matches: (file) => file.startsWith('docs/') || file === 'MISTAKES.md' || file === 'DESIGN.md',
  },
];

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_SOURCE_CONTROL_EVIDENCE || DEFAULT_OUTPUT_PATH,
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
  process.stdout.write(`BidStack source-control evidence writer

Usage:
  node scripts/write-source-control-evidence.mjs
  node scripts/write-source-control-evidence.mjs --out deploy-evidence/source-control-latest.json
  node scripts/write-source-control-evidence.mjs --selftest

Environment:
  BIDSTACK_SOURCE_CONTROL_EVIDENCE
`);
}

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
  return {
    command: ['git', ...args].join(' '),
    exitCode: result.status,
    passed: result.status === 0 && !result.error,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.code || result.error.message : '',
  };
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).find(Boolean)?.trim() || '';
}

function normalizeStatusEntry(line) {
  return {
    status: line.slice(0, 2),
    file: line.slice(3).trim(),
  };
}

function normalizeFilePath(file) {
  const raw = String(file || '').trim().replace(/\\/g, '/');
  const renamed = raw.split(' -> ');
  return renamed.at(-1) || raw;
}

function classifyStatus(entry) {
  const status = String(entry.status || '');
  if (status === '??') return 'untracked';
  if (status.includes('U')) return 'unmerged';
  if (status.includes('R')) return 'renamed';
  if (status.includes('D')) return 'deleted';
  if (status.includes('A')) return 'added';
  if (status.includes('M')) return 'modified';
  if (status.includes('C')) return 'copied';
  return 'other';
}

function pathGroupFor(file) {
  const normalized = normalizeFilePath(file);
  for (const group of PATH_GROUPS) {
    if (group.prefixes.some((prefix) => normalized.startsWith(prefix))) {
      return group;
    }
  }
  if (ROOT_CONFIG_FILES.has(normalized) || !normalized.includes('/')) {
    return PATH_GROUPS.find((group) => group.id === 'config');
  }
  return { id: 'other', label: 'Other' };
}

function createSummaryBucket(bucket) {
  return {
    id: bucket.id,
    label: bucket.label,
    count: 0,
    trackedDirtyCount: 0,
    untrackedCount: 0,
    stagedCount: 0,
    sampleFiles: [],
  };
}

function incrementBucket(map, bucket, entry) {
  if (!map.has(bucket.id)) {
    map.set(bucket.id, createSummaryBucket(bucket));
  }
  const summary = map.get(bucket.id);
  summary.count += 1;
  if (entry.status === '??') summary.untrackedCount += 1;
  if (entry.status !== '??') summary.trackedDirtyCount += 1;
  if (entry.status[0] !== ' ' && entry.status !== '??') summary.stagedCount += 1;
  if (summary.sampleFiles.length < REVIEW_SAMPLE_LIMIT) {
    summary.sampleFiles.push(normalizeFilePath(entry.file));
  }
}

function buildSourceReview(statusEntries) {
  const statusKindCounts = {};
  const pathGroupMap = new Map();
  const reviewBucketMap = new Map();

  for (const entry of statusEntries) {
    const statusKind = classifyStatus(entry);
    statusKindCounts[statusKind] = (statusKindCounts[statusKind] || 0) + 1;

    incrementBucket(pathGroupMap, pathGroupFor(entry.file), entry);

    const file = normalizeFilePath(entry.file);
    let matched = false;
    for (const bucket of REVIEW_BUCKETS) {
      if (bucket.matches(file)) {
        incrementBucket(reviewBucketMap, bucket, entry);
        matched = true;
      }
    }
    if (!matched) {
      incrementBucket(reviewBucketMap, { id: 'uncategorized', label: 'Uncategorized' }, entry);
    }
  }

  const sortBuckets = (left, right) => right.count - left.count || left.id.localeCompare(right.id);
  return {
    totalEntries: statusEntries.length,
    sampleLimit: STATUS_SAMPLE_LIMIT,
    reviewSampleLimit: REVIEW_SAMPLE_LIMIT,
    truncatedStatusEntries: statusEntries.length > STATUS_SAMPLE_LIMIT,
    statusKindCounts,
    pathGroups: [...pathGroupMap.values()].sort(sortBuckets),
    reviewBuckets: [...reviewBucketMap.values()].sort(sortBuckets),
  };
}

function reviewBucketsFor(file) {
  const matchedBuckets = REVIEW_BUCKETS.filter((bucket) => bucket.matches(file)).map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
  }));
  return matchedBuckets.length > 0
    ? matchedBuckets
    : [{ id: 'uncategorized', label: 'Uncategorized' }];
}

function buildStatusManifest(statusEntries) {
  return statusEntries.map((entry) => {
    const file = normalizeFilePath(entry.file);
    const group = pathGroupFor(file);
    const buckets = reviewBucketsFor(file);
    return {
      status: entry.status,
      file,
      statusKind: classifyStatus(entry),
      pathGroupId: group.id,
      pathGroupLabel: group.label,
      reviewBucketIds: buckets.map((bucket) => bucket.id),
      reviewBucketLabels: buckets.map((bucket) => bucket.label),
    };
  });
}

function summarizeCommand(result) {
  return {
    command: result.command,
    exitCode: result.exitCode,
    passed: result.passed,
    error: result.error || undefined,
  };
}

function parseTrackedLocalArtifacts(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeFilePath(line.split(/\s+/).at(-1)))
    .filter(Boolean);
}

function collectGitState(root) {
  const inside = runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.passed || firstLine(inside.stdout) !== 'true') {
    return {
      insideWorkTree: false,
      commands: [summarizeCommand(inside)],
      statusEntries: [],
    };
  }

  const topLevel = runGit(root, ['rev-parse', '--show-toplevel']);
  const commit = runGit(root, ['rev-parse', '--verify', 'HEAD']);
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commitTimestamp = runGit(root, ['log', '-1', '--format=%cI']);
  const status = runGit(root, ['status', '--porcelain=v1', '-uall']);
  const upstream = runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const aheadBehind = upstream.passed ? runGit(root, ['rev-list', '--left-right', '--count', '@{u}...HEAD']) : null;
  const trackedLocalArtifacts = runGit(root, [
    'ls-files',
    '-s',
    '--',
    ...TRACKED_LOCAL_ARTIFACT_PREFIXES,
  ]);

  const statusEntries = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(normalizeStatusEntry);
  const untrackedCount = statusEntries.filter((entry) => entry.status === '??').length;
  const stagedCount = statusEntries.filter((entry) => entry.status[0] !== ' ' && entry.status !== '??').length;
  const trackedDirtyCount = statusEntries.filter((entry) => entry.status !== '??').length;

  const [behindText, aheadText] = firstLine(aheadBehind?.stdout).split(/\s+/);
  const aheadCount = Number(aheadText);
  const behindCount = Number(behindText);

  return {
    insideWorkTree: true,
    topLevel: firstLine(topLevel.stdout).replace(/\\/g, '/'),
    commit: firstLine(commit.stdout),
    branch: firstLine(branch.stdout),
    commitTimestamp: firstLine(commitTimestamp.stdout),
    upstream: upstream.passed ? firstLine(upstream.stdout) : '',
    upstreamSynced:
      upstream.passed &&
      Number.isInteger(aheadCount) &&
      Number.isInteger(behindCount) &&
      aheadCount === 0 &&
      behindCount === 0,
    aheadCount: Number.isInteger(aheadCount) ? aheadCount : null,
    behindCount: Number.isInteger(behindCount) ? behindCount : null,
    clean: statusEntries.length === 0,
    dirty: statusEntries.length > 0,
    statusEntryCount: statusEntries.length,
    stagedCount,
    trackedDirtyCount,
    untrackedCount,
    statusEntries: statusEntries.slice(0, STATUS_SAMPLE_LIMIT),
    statusManifest: buildStatusManifest(statusEntries),
    sourceReview: buildSourceReview(statusEntries),
    trackedLocalArtifacts: trackedLocalArtifacts.passed
      ? parseTrackedLocalArtifacts(trackedLocalArtifacts.stdout)
      : [],
    commands: [inside, topLevel, commit, branch, commitTimestamp, status, upstream, aheadBehind, trackedLocalArtifacts]
      .filter(Boolean)
      .map(summarizeCommand),
  };
}

function validateArtifact(artifact) {
  const failures = [];
  if (artifact.insideWorkTree !== true) failures.push('not inside a git worktree');
  if (!/^[0-9a-f]{40}$/i.test(String(artifact.commit || ''))) {
    failures.push('release commit sha is missing or invalid');
  }
  if (!String(artifact.upstream || '').trim()) {
    failures.push('release branch must have an upstream tracking branch');
  }
  if (artifact.upstreamSynced !== true || Number(artifact.aheadCount || 0) !== 0 || Number(artifact.behindCount || 0) !== 0) {
    failures.push('release branch must be synced with its upstream tracking branch');
  }
  if (artifact.clean !== true || artifact.dirty === true || Number(artifact.statusEntryCount || 0) > 0) {
    failures.push('git worktree must be clean for release evidence');
  }
  if (Number(artifact.untrackedCount || 0) > 0) {
    failures.push('git worktree has untracked files');
  }
  if (Number(artifact.trackedDirtyCount || 0) > 0) {
    failures.push('git worktree has tracked modifications');
  }
  if (Array.isArray(artifact.trackedLocalArtifacts) && artifact.trackedLocalArtifacts.length > 0) {
    failures.push(
      `source control must not track local agent worktrees: ${artifact.trackedLocalArtifacts
        .slice(0, 5)
        .join(', ')}`,
    );
  }
  return failures;
}

function buildArtifact(options) {
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'source-control-evidence',
    root: options.root,
    ...collectGitState(options.root),
  };
  const validationFailures = validateArtifact(artifact);
  return {
    ...artifact,
    passed: validationFailures.length === 0,
    validationFailures,
  };
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = path.resolve(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function runWriter(options) {
  const artifact = buildArtifact(options);
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);

  process.stdout.write(`Source-control evidence: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Commit: ${artifact.commit || 'missing'}\n`);
  process.stdout.write(`Branch: ${artifact.branch || 'missing'}\n`);
  process.stdout.write(`Clean: ${artifact.clean ? 'yes' : 'no'}\n`);
  process.stdout.write(`Status entries: ${artifact.statusEntryCount ?? 'unknown'}\n`);
  if (artifact.trackedLocalArtifacts?.length > 0) {
    process.stdout.write(`Tracked local artifacts: ${artifact.trackedLocalArtifacts.length}\n`);
  }
  const reviewBuckets = artifact.sourceReview?.reviewBuckets || [];
  if (reviewBuckets.length > 0) {
    const topBuckets = reviewBuckets
      .slice(0, 5)
      .map((bucket) => `${bucket.label}=${bucket.count}`)
      .join(', ');
    process.stdout.write(`Review buckets: ${topBuckets}\n`);
  }
  if (artifact.sourceReview?.truncatedStatusEntries) {
    process.stdout.write(
      `Status sample truncated to ${artifact.sourceReview.sampleLimit} of ${artifact.statusEntryCount} entries\n`,
    );
  }

  if (artifact.validationFailures.length > 0) {
    for (const failure of artifact.validationFailures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    return 1;
  }

  process.stdout.write('Source-control evidence passed\n');
  return 0;
}

function run(root, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.error?.message || ''}`);
  }
}

function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidcrm-source-control-'));
  let remote = '';
  try {
    run(root, 'git', ['init']);
    run(root, 'git', ['config', 'user.email', 'release@example.com']);
    run(root, 'git', ['config', 'user.name', 'Release Bot']);
    writeFileSync(path.join(root, 'README.md'), '# Release fixture\n', 'utf8');
    run(root, 'git', ['add', 'README.md']);
    run(root, 'git', ['commit', '-m', 'initial']);
    remote = path.join(root, '..', `${path.basename(root)}-remote.git`);
    run(root, 'git', ['init', '--bare', remote]);
    run(root, 'git', ['remote', 'add', 'origin', remote]);
    run(root, 'git', ['push', '-u', 'origin', 'HEAD']);

    const clean = buildArtifact({ root, outputPath: DEFAULT_OUTPUT_PATH });
    assert.equal(clean.passed, true, `expected clean fixture to pass: ${clean.validationFailures.join(', ')}`);
    assert.equal(clean.clean, true);
    assert.equal(clean.upstreamSynced, true);
    assert.match(clean.commit, /^[0-9a-f]{40}$/i);

    run(root, 'git', [
      'update-index',
      '--add',
      '--cacheinfo',
      '160000',
      clean.commit,
      '.claude/worktrees/agent-test',
    ]);
    run(root, 'git', ['commit', '-m', 'tracked local artifact']);
    run(root, 'git', ['push']);
    const trackedLocalArtifact = buildArtifact({ root, outputPath: DEFAULT_OUTPUT_PATH });
    assert.equal(
      trackedLocalArtifact.passed,
      false,
      'expected tracked local worktree artifact to fail release evidence',
    );
    assert.deepEqual(trackedLocalArtifact.trackedLocalArtifacts, ['.claude/worktrees/agent-test']);
    assert.equal(
      trackedLocalArtifact.validationFailures.some((failure) =>
        failure.includes('source control must not track local agent worktrees'),
      ),
      true,
      'expected tracked local artifact failure',
    );

    run(root, 'git', ['rm', '--cached', '--', '.claude/worktrees/agent-test']);
    run(root, 'git', ['commit', '-m', 'remove tracked local artifact']);
    run(root, 'git', ['push']);

    mkdirSync(path.join(root, 'apps', 'api', 'src'), { recursive: true });
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(path.join(root, 'apps', 'api', 'src', 'server.ts'), 'export const dirty = true;\n', 'utf8');
    writeFileSync(path.join(root, 'docs', 'release.md'), '# Release note\n', 'utf8');
    writeFileSync(path.join(root, '.env.local'), 'PLACEHOLDER=true\n', 'utf8');
    const dirty = buildArtifact({ root, outputPath: DEFAULT_OUTPUT_PATH });
    assert.equal(dirty.passed, false, 'expected untracked file to fail release evidence');
    assert.equal(dirty.untrackedCount, 3);
    assert.equal(dirty.statusManifest.length, 3);
    assert.equal(
      dirty.statusManifest.some(
        (entry) =>
          entry.file === 'apps/api/src/server.ts' &&
          entry.pathGroupId === 'api' &&
          entry.reviewBucketIds.includes('runtime_code'),
      ),
      true,
      'expected API runtime entry in status manifest',
    );
    assert.equal(dirty.sourceReview.statusKindCounts.untracked, 3);
    assert.equal(
      dirty.sourceReview.reviewBuckets.some(
        (bucket) => bucket.id === 'secret_or_env' && bucket.count === 1,
      ),
      true,
      'expected env-sensitive bucket',
    );
    assert.equal(
      dirty.sourceReview.pathGroups.some((group) => group.id === 'api' && group.count === 1),
      true,
      'expected API path group',
    );
    assert.equal(
      dirty.validationFailures.some((failure) => failure.includes('untracked')),
      true,
      'expected untracked failure',
    );

    run(root, 'git', ['add', 'apps/api/src/server.ts', 'docs/release.md', '.env.local']);
    const staged = buildArtifact({ root, outputPath: DEFAULT_OUTPUT_PATH });
    assert.equal(staged.passed, false, 'expected staged file to fail release evidence');
    assert.equal(staged.stagedCount, 3);
    assert.equal(
      staged.validationFailures.some((failure) => failure.includes('tracked modifications')),
      true,
      'expected tracked modification failure',
    );

    run(root, 'git', ['commit', '-m', 'dirty']);
    const ahead = buildArtifact({ root, outputPath: DEFAULT_OUTPUT_PATH });
    assert.equal(ahead.passed, false, 'expected unpushed commit to fail release evidence');
    assert.equal(ahead.aheadCount, 1);
    assert.equal(
      ahead.validationFailures.some((failure) => failure.includes('upstream')),
      true,
      'expected upstream sync failure',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (remote) {
      rmSync(remote, { recursive: true, force: true });
    }
  }

  process.stdout.write('source-control evidence selftest passed\n');
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
