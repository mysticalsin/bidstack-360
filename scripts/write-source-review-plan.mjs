#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_SOURCE_PATH = 'deploy-evidence/source-control-latest.json';
const DEFAULT_OUTPUT_PATH = 'deploy-evidence/source-review-plan-latest.json';
const SAMPLE_LIMIT = 8;

const WAVE_DEFINITIONS = [
  {
    id: 'release-critical',
    label: 'Release-critical configuration and secrets',
    priority: 'P0',
    bucketIds: ['secret_or_env', 'release_config', 'schema_or_migration'],
    verification: [
      'pnpm deploy:evidence:secrets',
      'pnpm deploy:evidence:source',
      'pnpm deploy:evidence:production',
    ],
    reviewNotes: [
      'Review before application code because these files influence deploy safety.',
      'Do not commit private secret material; use .env.example placeholders only.',
    ],
  },
  {
    id: 'security-access',
    label: 'Security, auth, access, and observability',
    priority: 'P0',
    bucketIds: ['security_auth'],
    verification: [
      'pnpm --filter @bidstack/api test -- src/routes/user-groups.integration.test.ts src/routes/users.roles.integration.test.ts --reporter=dot',
      'pnpm deploy:evidence:selftest',
      'pnpm deploy:evidence:source',
    ],
    reviewNotes: [
      'Review with a security owner when auth, access scope, Sentry, token, credential, or CORS files changed.',
    ],
  },
  {
    id: 'runtime-code',
    label: 'Runtime services and shared packages',
    priority: 'P1',
    bucketIds: ['runtime_code'],
    pathGroupIds: ['api', 'worker', 'mcp', 'packages'],
    verification: [
      'pnpm --filter @bidstack/api exec tsc --noEmit --pretty false',
      'pnpm --filter @bidstack/worker exec tsc --noEmit --pretty false',
      'pnpm --filter @bidstack/shared build',
      'pnpm deploy:evidence:source',
    ],
    reviewNotes: [
      'Split API, worker, MCP, and shared package changes when a single review becomes too broad.',
    ],
  },
  {
    id: 'frontend-ux',
    label: 'Frontend UX and browser regression',
    priority: 'P1',
    bucketIds: ['frontend_ux'],
    pathGroupIds: ['web'],
    verification: [
      'pnpm --filter @bidstack/web exec tsc --noEmit --pretty false',
      'pnpm --filter @bidstack/web e2e -- e2e/critical-controls.spec.ts --project=chromium-desktop',
      'pnpm deploy:evidence:source',
    ],
    reviewNotes: [
      'Preserve premium UX, keyboard access, 44px touch targets, and no-overlap/no-overflow checks.',
    ],
  },
  {
    id: 'docs-runbooks',
    label: 'Documentation, runbooks, and audit records',
    priority: 'P2',
    bucketIds: ['documentation'],
    pathGroupIds: ['docs'],
    verification: ['pnpm deploy:evidence:source'],
    reviewNotes: [
      'Keep audit claims aligned with command output; do not use docs as proof for unrun live evidence.',
    ],
  },
  {
    id: 'uncategorized',
    label: 'Uncategorized and local coordination files',
    priority: 'P2',
    bucketIds: ['uncategorized'],
    pathGroupIds: ['other', 'config'],
    verification: ['pnpm deploy:evidence:source'],
    reviewNotes: [
      'Decide whether local coordination artifacts belong in source control before including them in a release commit.',
    ],
  },
];

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    sourcePath: process.env.BIDSTACK_SOURCE_CONTROL_EVIDENCE || DEFAULT_SOURCE_PATH,
    outputPath: process.env.BIDSTACK_SOURCE_REVIEW_PLAN || DEFAULT_OUTPUT_PATH,
    packetDir: process.env.BIDSTACK_SOURCE_REVIEW_PACKET_DIR || '',
    allowActive: false,
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      parsed.root = argv[index + 1] ?? parsed.root;
      index += 1;
    } else if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
    } else if (arg === '--source') {
      parsed.sourcePath = argv[index + 1] ?? parsed.sourcePath;
      index += 1;
    } else if (arg.startsWith('--source=')) {
      parsed.sourcePath = arg.slice('--source='.length);
    } else if (arg === '--out') {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      parsed.outputPath = arg.slice('--out='.length);
    } else if (arg === '--packet-dir') {
      parsed.packetDir = argv[index + 1] ?? parsed.packetDir;
      index += 1;
    } else if (arg.startsWith('--packet-dir=')) {
      parsed.packetDir = arg.slice('--packet-dir='.length);
    } else if (arg === '--allow-active') {
      parsed.allowActive = true;
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
  if (!parsed.packetDir) {
    parsed.packetDir = defaultPacketDirForOutput(parsed.outputPath);
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack source review plan writer

Usage:
  node scripts/write-source-review-plan.mjs
  node scripts/write-source-review-plan.mjs --source deploy-evidence/source-control-latest.json
  node scripts/write-source-review-plan.mjs --packet-dir deploy-evidence/source-review-plan-latest-packets
  node scripts/write-source-review-plan.mjs --allow-active
  node scripts/write-source-review-plan.mjs --selftest

Environment:
  BIDSTACK_SOURCE_CONTROL_EVIDENCE
  BIDSTACK_SOURCE_REVIEW_PLAN
  BIDSTACK_SOURCE_REVIEW_PACKET_DIR
`);
}

function resolveArtifact(root, relativePath) {
  return path.resolve(root, relativePath);
}

function normalizeArtifactPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function defaultPacketDirForOutput(outputPath) {
  const normalized = normalizeArtifactPath(outputPath || DEFAULT_OUTPUT_PATH);
  return normalized.replace(/\.json$/i, '') + '-packets';
}

function relativeArtifactPath(root, artifactPath) {
  const absolutePath = resolveArtifact(root, artifactPath);
  return path.relative(root, absolutePath).replace(/\\/g, '/');
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
    file: normalizeFilePath(line.slice(3).trim()),
  };
}

function normalizeFilePath(file) {
  const raw = String(file || '').trim().replace(/\\/g, '/');
  const renamed = raw.split(' -> ');
  return renamed.at(-1) || raw;
}

function normalizeManifestEntry(entry) {
  return {
    status: String(entry?.status || '').padEnd(2, ' ').slice(0, 2),
    file: normalizeFilePath(entry?.file || ''),
  };
}

function manifestKey(entry) {
  return `${entry.status}\t${entry.file}`;
}

function normalizeManifest(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeManifestEntry)
    .filter((entry) => entry.status.trim() && entry.file)
    .sort((left, right) => manifestKey(left).localeCompare(manifestKey(right)));
}

function diffManifest(sourceManifest, currentManifest) {
  const sourceKeys = new Set(sourceManifest.map(manifestKey));
  const currentKeys = new Set(currentManifest.map(manifestKey));
  return {
    added: currentManifest
      .filter((entry) => !sourceKeys.has(manifestKey(entry)))
      .slice(0, SAMPLE_LIMIT),
    removed: sourceManifest
      .filter((entry) => !currentKeys.has(manifestKey(entry)))
      .slice(0, SAMPLE_LIMIT),
  };
}

function collectCurrentGitSnapshot(root) {
  const inside = runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.passed || firstLine(inside.stdout) !== 'true') {
    return {
      available: false,
      reasons: ['not_inside_git_worktree'],
      commands: [{ command: inside.command, exitCode: inside.exitCode, error: inside.error }],
      statusManifest: [],
    };
  }

  const commit = runGit(root, ['rev-parse', '--verify', 'HEAD']);
  const branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstream = runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const status = runGit(root, ['status', '--porcelain=v1', '-uall']);
  const statusManifest = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(normalizeStatusEntry);

  return {
    available: commit.passed && branch.passed && status.passed,
    reasons: [
      ...(commit.passed ? [] : ['commit_unavailable']),
      ...(branch.passed ? [] : ['branch_unavailable']),
      ...(status.passed ? [] : ['status_unavailable']),
    ],
    commit: firstLine(commit.stdout),
    branch: firstLine(branch.stdout),
    upstream: upstream.passed ? firstLine(upstream.stdout) : '',
    statusManifest: normalizeManifest(statusManifest),
    commands: [inside, commit, branch, upstream, status].map((command) => ({
      command: command.command,
      exitCode: command.exitCode,
      error: command.error || undefined,
    })),
  };
}

function compareSourceEvidenceToCurrent(sourceArtifact, root) {
  const checkedAt = new Date().toISOString();
  const current = collectCurrentGitSnapshot(root);
  const reasons = [...(current.reasons || [])];
  const sourceManifest = normalizeManifest(sourceArtifact.statusManifest);

  if (Number(sourceArtifact.statusEntryCount || 0) > 0 && sourceManifest.length === 0) {
    reasons.push('source_status_manifest_missing');
  }
  if (current.commit && sourceArtifact.commit && current.commit !== sourceArtifact.commit) {
    reasons.push('commit_mismatch');
  }
  if (current.branch && sourceArtifact.branch && current.branch !== sourceArtifact.branch) {
    reasons.push('branch_mismatch');
  }
  if (String(current.upstream || '') !== String(sourceArtifact.upstream || '')) {
    reasons.push('upstream_mismatch');
  }

  const currentManifest = current.statusManifest || [];
  const sameManifest =
    sourceManifest.length === currentManifest.length &&
    sourceManifest.every((entry, index) => manifestKey(entry) === manifestKey(currentManifest[index]));
  const manifestDelta = diffManifest(sourceManifest, currentManifest);
  if (!sameManifest) {
    reasons.push('status_manifest_mismatch');
  }

  const sourceCount = Number(sourceArtifact.statusEntryCount ?? sourceManifest.length);
  const currentCount = currentManifest.length;
  if (sourceCount !== currentCount && !reasons.includes('status_manifest_mismatch')) {
    reasons.push('status_count_mismatch');
  }

  return {
    checkedAt,
    current: current.available === true && reasons.length === 0,
    reasons,
    source: {
      generatedAt: sourceArtifact.generatedAt || '',
      commit: sourceArtifact.commit || '',
      branch: sourceArtifact.branch || '',
      upstream: sourceArtifact.upstream || '',
      statusEntryCount: sourceCount,
    },
    currentGit: {
      commit: current.commit || '',
      branch: current.branch || '',
      upstream: current.upstream || '',
      statusEntryCount: currentCount,
      available: current.available === true,
    },
    manifestDelta,
  };
}

function readSourceArtifact(root, sourcePath) {
  const absolutePath = resolveArtifact(root, sourcePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Source-control evidence artifact is missing: ${sourcePath}`);
  }
  const value = JSON.parse(readFileSync(absolutePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Source-control evidence artifact must be a JSON object: ${sourcePath}`);
  }
  if (!value.sourceReview || typeof value.sourceReview !== 'object') {
    throw new Error('Source-control evidence is missing sourceReview; rerun pnpm deploy:evidence:source');
  }
  return { value, absolutePath };
}

function byId(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

function mergeSamples(items) {
  const sampleSet = new Set();
  for (const item of items) {
    for (const file of Array.isArray(item?.sampleFiles) ? item.sampleFiles : []) {
      if (sampleSet.size < SAMPLE_LIMIT) sampleSet.add(String(file));
    }
  }
  return [...sampleSet];
}

function matchesWaveEntry(entry, definition) {
  const bucketIds = new Set(definition.bucketIds || []);
  const pathGroupIds = new Set(definition.pathGroupIds || []);
  return (
    (Array.isArray(entry.reviewBucketIds) &&
      entry.reviewBucketIds.some((id) => bucketIds.has(id))) ||
    pathGroupIds.has(entry.pathGroupId)
  );
}

function buildWaveFileManifest(statusManifest, definition) {
  const seen = new Set();
  const files = [];
  for (const entry of Array.isArray(statusManifest) ? statusManifest : []) {
    if (!matchesWaveEntry(entry, definition) || seen.has(entry.file)) continue;
    seen.add(entry.file);
    files.push({
      status: entry.status,
      statusKind: entry.statusKind,
      file: entry.file,
      pathGroupId: entry.pathGroupId,
      reviewBucketIds: entry.reviewBucketIds || [],
    });
  }
  return files;
}

function statusLabel(entry) {
  const status = String(entry?.status || '').trim() || 'dirty';
  const statusKind = String(entry?.statusKind || '').trim();
  return statusKind ? `${statusKind} (${status})` : status;
}

function markdownCode(value) {
  return `\`${String(value || '').replaceAll('`', '\\`')}\``;
}

function buildWaveReviewMarkdown(plan, wave, packet) {
  const lines = [
    `# ${wave.priority} ${wave.label}`,
    '',
    `Generated: ${plan.generatedAt}`,
    `Source evidence: ${plan.sourceEvidencePath}`,
    `Source current: ${plan.sourceEvidenceCurrent ? 'yes' : 'no'}`,
    `Release source clean: ${plan.sourceClean ? 'yes' : 'no'}`,
    '',
    '## Counts',
    '',
    `- Estimated touches: ${wave.estimatedTouches}`,
    `- Exact file count: ${wave.fileCount}`,
    `- Tracked dirty: ${wave.trackedDirtyCount}`,
    `- Untracked: ${wave.untrackedCount}`,
    `- Staged: ${wave.stagedCount}`,
    '',
    '## Artifacts',
    '',
    `- Path list: ${markdownCode(packet.pathsPath)}`,
    '',
    '## Review Notes',
    '',
    ...wave.reviewNotes.map((note) => `- ${note}`),
    '',
    '## Verification',
    '',
    ...wave.verification.map((command) => `- ${markdownCode(command)}`),
    '',
    '## Exact Files',
    '',
    ...wave.files.map((file) => `- [ ] ${markdownCode(file.file)} - ${statusLabel(file)}`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function buildPacketEntries(plan, packetDir) {
  const normalizedDir = normalizeArtifactPath(packetDir || defaultPacketDirForOutput(DEFAULT_OUTPUT_PATH));
  const entries = [];
  for (const wave of plan.reviewWaves) {
    const prefix = `${wave.priority.toLowerCase()}-${wave.id}`;
    const pathsPath = `${normalizedDir}/${prefix}.paths.txt`;
    const reviewPath = `${normalizedDir}/${prefix}.review.md`;
    const packet = {
      waveId: wave.id,
      pathsPath,
      reviewPath,
      fileCount: wave.fileCount,
    };
    entries.push({
      ...packet,
      pathsContent: `${wave.files.map((file) => file.file).join('\n')}\n`,
      reviewContent: buildWaveReviewMarkdown(plan, wave, packet),
    });
  }
  return entries;
}

function buildPacketIndexMarkdown(plan, packets) {
  const lines = [
    '# BidStack Source Review Packets',
    '',
    `Generated: ${plan.generatedAt}`,
    `Source evidence: ${plan.sourceEvidencePath}`,
    `Source current: ${plan.sourceEvidenceCurrent ? 'yes' : 'no'}`,
    `Source clean: ${plan.sourceClean ? 'yes' : 'no'}`,
    `Blocking reasons: ${plan.blockingReasons.length ? plan.blockingReasons.join(', ') : 'none'}`,
    '',
    'These files are non-destructive review aids. They do not approve release;',
    '`pnpm deploy:evidence:source` must pass on a clean, reviewed worktree.',
    '',
    '## Waves',
    '',
  ];

  for (const packet of packets) {
    const wave = plan.reviewWaves.find((item) => item.id === packet.waveId);
    if (!wave) continue;
    lines.push(
      `- ${wave.priority} ${wave.label}: ${wave.fileCount} file(s)`,
      `  - Review packet: ${markdownCode(packet.reviewPath)}`,
      `  - Path list: ${markdownCode(packet.pathsPath)}`,
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function attachReviewPackets(plan, outputPath, packetDir) {
  const packets = buildPacketEntries(plan, packetDir);
  const normalizedDir = normalizeArtifactPath(packetDir);
  const indexPath = `${normalizedDir}/INDEX.md`;
  const packetByWave = new Map(
    packets.map((packet) => [
      packet.waveId,
      {
        pathsPath: packet.pathsPath,
        reviewPath: packet.reviewPath,
        fileCount: packet.fileCount,
      },
    ]),
  );

  return {
    ...plan,
    reviewWaves: plan.reviewWaves.map((wave) => ({
      ...wave,
      reviewPacket: packetByWave.get(wave.id) || null,
    })),
    reviewPackets: {
      packetDir: normalizedDir,
      indexPath,
      planPath: normalizeArtifactPath(outputPath),
      waveCount: packets.length,
      waves: [...packetByWave.entries()].map(([waveId, packet]) => ({ waveId, ...packet })),
    },
  };
}

function writeReviewPackets(root, plan) {
  const packets = buildPacketEntries(plan, plan.reviewPackets?.packetDir);
  for (const packet of packets) {
    writeTextArtifact(root, packet.pathsPath, packet.pathsContent);
    writeTextArtifact(root, packet.reviewPath, packet.reviewContent);
  }
  writeTextArtifact(root, plan.reviewPackets.indexPath, buildPacketIndexMarkdown(plan, packets));
}

function buildWave(definition, bucketMap, pathGroupMap, statusManifest) {
  const buckets = definition.bucketIds.map((id) => bucketMap.get(id)).filter(Boolean);
  const pathGroups = (definition.pathGroupIds || []).map((id) => pathGroupMap.get(id)).filter(Boolean);
  const reviewInputs = [...buckets, ...pathGroups];
  const files = buildWaveFileManifest(statusManifest, definition);
  const trackedDirtyCount = files.filter((file) => file.status !== '??').length;
  const untrackedCount = files.filter((file) => file.status === '??').length;
  const stagedCount = files.filter((file) => file.status[0] !== ' ' && file.status !== '??').length;
  return {
    id: definition.id,
    label: definition.label,
    priority: definition.priority,
    estimatedTouches: files.length,
    trackedDirtyCount,
    untrackedCount,
    stagedCount,
    bucketIds: definition.bucketIds.filter((id) => bucketMap.has(id)),
    pathGroupIds: (definition.pathGroupIds || []).filter((id) => pathGroupMap.has(id)),
    sampleFiles: mergeSamples(reviewInputs),
    files,
    fileCount: files.length,
    verification: definition.verification,
    reviewNotes: definition.reviewNotes,
    present: files.length > 0,
  };
}

function buildPlan(sourceArtifact, sourcePath, sourceCurrency) {
  const sourceReview = sourceArtifact.sourceReview || {};
  const bucketMap = byId(sourceReview.reviewBuckets);
  const pathGroupMap = byId(sourceReview.pathGroups);
  const statusManifest = Array.isArray(sourceArtifact.statusManifest)
    ? sourceArtifact.statusManifest
    : [];
  const currency = sourceCurrency || {
    checkedAt: new Date().toISOString(),
    current: true,
    reasons: [],
  };
  const waves = WAVE_DEFINITIONS.map((definition) =>
    buildWave(definition, bucketMap, pathGroupMap, statusManifest),
  );
  const activeWaves = waves.filter((wave) => wave.present);
  const blockingReasons = [];
  if (currency.current !== true) blockingReasons.push('source_evidence_stale');
  if (sourceArtifact.clean !== true) blockingReasons.push('worktree_dirty');
  if (Number(sourceArtifact.trackedDirtyCount || 0) > 0) blockingReasons.push('tracked_changes');
  if (Number(sourceArtifact.untrackedCount || 0) > 0) blockingReasons.push('untracked_changes');

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'source-review-plan',
    sourceEvidencePath: sourcePath,
    sourceGeneratedAt: sourceArtifact.generatedAt || '',
    commit: sourceArtifact.commit || '',
    branch: sourceArtifact.branch || '',
    upstream: sourceArtifact.upstream || '',
    upstreamSynced: sourceArtifact.upstreamSynced === true,
    sourcePassed: sourceArtifact.passed === true,
    sourceClean: sourceArtifact.clean === true,
    sourceEvidenceCurrent: currency.current === true,
    sourceCurrency: currency,
    statusEntryCount: Number(sourceArtifact.statusEntryCount || 0),
    trackedDirtyCount: Number(sourceArtifact.trackedDirtyCount || 0),
    untrackedCount: Number(sourceArtifact.untrackedCount || 0),
    blockingReasons,
    sourceReview: {
      statusKindCounts: sourceReview.statusKindCounts || {},
      topPathGroups: (sourceReview.pathGroups || []).slice(0, 8),
      topReviewBuckets: (sourceReview.reviewBuckets || []).slice(0, 8),
      truncatedStatusEntries: sourceReview.truncatedStatusEntries === true,
      sampleLimit: sourceReview.sampleLimit,
      reviewSampleLimit: sourceReview.reviewSampleLimit,
      statusManifestAvailable: statusManifest.length > 0,
      statusManifestCount: statusManifest.length,
    },
    reviewWaves: activeWaves,
    inactiveWaves: waves.filter((wave) => !wave.present).map((wave) => wave.id),
    nextActions: [
      'Review waves in priority order; split large waves before committing.',
      'If sourceEvidenceCurrent is false, rerun pnpm deploy:evidence:source before reviewing waves.',
      'Run each wave verification command after review.',
      'Rerun pnpm deploy:evidence:source after source cleanup.',
      'Do not treat this plan as deploy approval; clean source evidence must pass.',
    ],
    passed: sourceArtifact.passed === true && activeWaves.length === 0 && currency.current === true,
  };
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = resolveArtifact(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function writeTextArtifact(root, outputPath, value) {
  const absolutePath = resolveArtifact(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, 'utf8');
  return absolutePath;
}

function runWriter(options) {
  const { value } = readSourceArtifact(options.root, options.sourcePath);
  const sourceCurrency = compareSourceEvidenceToCurrent(value, options.root);
  const artifact = attachReviewPackets(
    buildPlan(value, options.sourcePath, sourceCurrency),
    options.outputPath,
    options.packetDir,
  );
  writeReviewPackets(options.root, artifact);
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);

  process.stdout.write(`Source review plan: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(
    `Review packets: ${relativeArtifactPath(options.root, artifact.reviewPackets.indexPath)}\n`,
  );
  process.stdout.write(`Source evidence current: ${artifact.sourceEvidenceCurrent ? 'yes' : 'no'}\n`);
  if (!artifact.sourceEvidenceCurrent) {
    process.stdout.write(
      `Source evidence currency blockers: ${artifact.sourceCurrency.reasons.join(', ')}\n`,
    );
  }
  process.stdout.write(`Source clean: ${artifact.sourceClean ? 'yes' : 'no'}\n`);
  process.stdout.write(`Review waves: ${artifact.reviewWaves.length}\n`);
  for (const wave of artifact.reviewWaves.slice(0, 6)) {
    process.stdout.write(
      `${wave.priority} ${wave.label}: ${wave.estimatedTouches} touch(es), files=${wave.fileCount}, tracked=${wave.trackedDirtyCount}, untracked=${wave.untrackedCount}\n`,
    );
  }

  if (!artifact.passed) {
    if (!artifact.sourceEvidenceCurrent) {
      process.stderr.write('Source review plan is stale; rerun pnpm deploy:evidence:source first\n');
      return 1;
    }
    if (options.allowActive) {
      process.stdout.write(
        'Source review plan written with active cleanup waves; release source evidence is still blocked\n',
      );
      return 0;
    }
    process.stderr.write('Source review plan requires cleanup before release source evidence can pass\n');
    return 1;
  }

  process.stdout.write('Source review plan has no active cleanup waves\n');
  return 0;
}

function writeJson(root, relativePath, value) {
  const absolutePath = resolveArtifact(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runSelftest() {
  assert.equal(parseArgs(['--allow-active']).allowActive, true);
  assert.equal(
    parseArgs(['--out', 'deploy-evidence/custom-plan.json']).packetDir,
    'deploy-evidence/custom-plan-packets',
  );

  const root = mkdtempSync(path.join(tmpdir(), 'bidcrm-source-review-plan-'));
  try {
    const source = {
      schemaVersion: 1,
      generatedAt: '2026-06-18T11:45:00.000Z',
      commit: '0123456789abcdef0123456789abcdef01234567',
      branch: 'demo',
      upstream: 'origin/demo',
      upstreamSynced: true,
      clean: false,
      passed: false,
      statusEntryCount: 6,
      trackedDirtyCount: 4,
      untrackedCount: 2,
      sourceReview: {
        statusKindCounts: { modified: 4, untracked: 2 },
        statusManifestAvailable: true,
        pathGroups: [
          {
            id: 'api',
            label: 'API',
            count: 3,
            trackedDirtyCount: 2,
            untrackedCount: 1,
            stagedCount: 0,
            sampleFiles: ['apps/api/src/plugins/auth.ts'],
          },
          {
            id: 'web',
            label: 'Web',
            count: 2,
            trackedDirtyCount: 1,
            untrackedCount: 1,
            stagedCount: 0,
            sampleFiles: ['apps/web/src/App.tsx'],
          },
        ],
        reviewBuckets: [
          {
            id: 'security_auth',
            label: 'Security/auth/access files',
            count: 2,
            trackedDirtyCount: 2,
            untrackedCount: 0,
            stagedCount: 0,
            sampleFiles: ['apps/api/src/plugins/auth.ts'],
          },
          {
            id: 'frontend_ux',
            label: 'Frontend UX',
            count: 2,
            trackedDirtyCount: 1,
            untrackedCount: 1,
            stagedCount: 0,
            sampleFiles: ['apps/web/src/App.tsx'],
          },
          {
            id: 'release_config',
            label: 'Release/configuration files',
            count: 1,
            trackedDirtyCount: 1,
            untrackedCount: 0,
            stagedCount: 0,
            sampleFiles: ['Dockerfile'],
          },
        ],
      },
      statusManifest: [
        {
          status: ' M',
          statusKind: 'modified',
          file: 'apps/api/src/plugins/auth.ts',
          pathGroupId: 'api',
          reviewBucketIds: ['runtime_code', 'security_auth'],
        },
        {
          status: ' M',
          statusKind: 'modified',
          file: 'apps/web/src/App.tsx',
          pathGroupId: 'web',
          reviewBucketIds: ['frontend_ux'],
        },
        {
          status: '??',
          statusKind: 'untracked',
          file: 'apps/web/src/NewPanel.tsx',
          pathGroupId: 'web',
          reviewBucketIds: ['frontend_ux'],
        },
        {
          status: ' M',
          statusKind: 'modified',
          file: 'Dockerfile',
          pathGroupId: 'config',
          reviewBucketIds: ['release_config'],
        },
      ],
    };
    writeJson(root, DEFAULT_SOURCE_PATH, source);

    const currentCurrency = {
      checkedAt: '2026-06-18T11:46:00.000Z',
      current: true,
      reasons: [],
    };
    const staleCurrency = {
      checkedAt: '2026-06-18T11:46:00.000Z',
      current: false,
      reasons: ['status_manifest_mismatch'],
      source: {
        generatedAt: source.generatedAt,
        commit: source.commit,
        branch: source.branch,
        upstream: source.upstream,
        statusEntryCount: 6,
      },
      currentGit: {
        commit: source.commit,
        branch: source.branch,
        upstream: source.upstream,
        statusEntryCount: 7,
        available: true,
      },
      manifestDelta: {
        added: [{ status: '??', file: 'apps/web/src/new-critical-control.tsx' }],
        removed: [],
      },
    };

    const plan = buildPlan(source, DEFAULT_SOURCE_PATH, currentCurrency);
    assert.equal(plan.passed, false);
    assert.deepEqual(plan.blockingReasons, [
      'worktree_dirty',
      'tracked_changes',
      'untracked_changes',
    ]);
    assert.equal(plan.reviewWaves[0].id, 'release-critical');
    assert.equal(
      plan.reviewWaves.some((wave) => wave.id === 'security-access' && wave.priority === 'P0'),
      true,
    );
    assert.equal(
      plan.reviewWaves.some(
        (wave) =>
          wave.id === 'frontend-ux' &&
          wave.estimatedTouches === 2 &&
          wave.fileCount === 2 &&
          wave.trackedDirtyCount === 1 &&
          wave.untrackedCount === 1,
      ),
      true,
    );
    const securityWave = plan.reviewWaves.find((wave) => wave.id === 'security-access');
    assert.equal(securityWave.fileCount, 1);
    assert.equal(securityWave.files[0].file, 'apps/api/src/plugins/auth.ts');
    const releaseWave = plan.reviewWaves.find((wave) => wave.id === 'release-critical');
    assert.equal(releaseWave.files.some((file) => file.file === 'Dockerfile'), true);
    const packetPlan = attachReviewPackets(
      plan,
      DEFAULT_OUTPUT_PATH,
      'deploy-evidence/source-review-plan-test-packets',
    );
    writeReviewPackets(root, packetPlan);
    const securityPacket = packetPlan.reviewWaves.find((wave) => wave.id === 'security-access')
      .reviewPacket;
    assert.match(securityPacket.pathsPath, /security-access\.paths\.txt$/);
    assert.equal(
      readFileSync(resolveArtifact(root, securityPacket.pathsPath), 'utf8').includes(
        'apps/api/src/plugins/auth.ts',
      ),
      true,
      'expected security packet path list to include exact file',
    );
    assert.equal(
      readFileSync(resolveArtifact(root, securityPacket.reviewPath), 'utf8').includes(
        'pnpm deploy:evidence:selftest',
      ),
      true,
      'expected security packet review checklist to include verification command',
    );
    assert.equal(
      readFileSync(resolveArtifact(root, packetPlan.reviewPackets.indexPath), 'utf8').includes(
        'P0 Security, auth, access, and observability',
      ),
      true,
      'expected packet index to list security wave',
    );

    const stalePlan = buildPlan(source, DEFAULT_SOURCE_PATH, staleCurrency);
    assert.equal(stalePlan.passed, false);
    assert.equal(stalePlan.sourceEvidenceCurrent, false);
    assert.equal(stalePlan.blockingReasons[0], 'source_evidence_stale');
    assert.equal(stalePlan.sourceCurrency.manifestDelta.added[0].file, 'apps/web/src/new-critical-control.tsx');

    const cleanSource = {
      ...source,
      clean: true,
      passed: true,
      statusEntryCount: 0,
      trackedDirtyCount: 0,
      untrackedCount: 0,
      sourceReview: {
        statusKindCounts: {},
        pathGroups: [],
        reviewBuckets: [],
      },
      statusManifest: [],
    };
    const cleanPlan = buildPlan(cleanSource, DEFAULT_SOURCE_PATH, currentCurrency);
    assert.equal(cleanPlan.passed, true);
    assert.equal(cleanPlan.reviewWaves.length, 0);

    const gitRoot = mkdtempSync(path.join(tmpdir(), 'bidcrm-source-review-git-'));
    try {
      runGit(gitRoot, ['init']);
      runGit(gitRoot, ['config', 'user.email', 'release@example.com']);
      runGit(gitRoot, ['config', 'user.name', 'Release Bot']);
      writeFileSync(path.join(gitRoot, 'README.md'), '# Release fixture\n', 'utf8');
      runGit(gitRoot, ['add', 'README.md']);
      runGit(gitRoot, ['commit', '-m', 'initial']);
      writeFileSync(path.join(gitRoot, 'README.md'), '# Release fixture\n\nChanged\n', 'utf8');
      const snapshot = collectCurrentGitSnapshot(gitRoot);
      const sourceFromSnapshot = {
        commit: snapshot.commit,
        branch: snapshot.branch,
        upstream: snapshot.upstream,
        statusEntryCount: snapshot.statusManifest.length,
        statusManifest: snapshot.statusManifest,
      };
      assert.equal(compareSourceEvidenceToCurrent(sourceFromSnapshot, gitRoot).current, true);
      writeFileSync(path.join(gitRoot, 'new-file.md'), '# New\n', 'utf8');
      const stale = compareSourceEvidenceToCurrent(sourceFromSnapshot, gitRoot);
      assert.equal(stale.current, false);
      assert.equal(stale.reasons.includes('status_manifest_mismatch'), true);
      assert.equal(stale.manifestDelta.added.some((entry) => entry.file === 'new-file.md'), true);
    } finally {
      rmSync(gitRoot, { recursive: true, force: true });
    }

    assert.throws(
      () => readSourceArtifact(root, 'deploy-evidence/missing.json'),
      /artifact is missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write('source review plan selftest passed\n');
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
