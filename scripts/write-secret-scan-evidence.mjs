#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/secret-scan-latest.json';
const DEFAULT_RAW_REPORT_DIR = 'deploy-evidence/secret-scan-reports';
const DEFAULT_GITLEAKS_IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.1';
const SECRET_PATTERN =
  /(sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|pk_live_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}|AccountKey=[A-Za-z0-9+/=]{40,}|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY)/g;
const MAX_RECORDED_HIT_FILES = 10;
const PLACEHOLDER_EXACT_VALUES = new Set([
  'abc123',
  'change-me',
  'changeme',
  'dummy',
  'example',
  'sample',
  'sec-123',
  'sec-1234',
  'ticket-123',
  'todo',
]);
const PLACEHOLDER_VALUE_PATTERNS = [
  /<[^>]+>/,
  /\bexample\b/,
  /\bplaceholder\b/,
  /\breplace[-_ ]?me\b/,
  /\bsample\b/,
  /\btodo\b/,
];

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_SECRET_SCAN_EVIDENCE || DEFAULT_OUTPUT_PATH,
    rawReportDir: process.env.BIDSTACK_SECRET_SCAN_RAW_REPORT_DIR || DEFAULT_RAW_REPORT_DIR,
    dispositionFile: process.env.BIDSTACK_SECRET_DISPOSITION_FILE || '',
    reviewer: process.env.BIDSTACK_SECRET_REVIEWER || '',
    ownerApprover:
      process.env.BIDSTACK_SECRET_OWNER_APPROVER ||
      process.env.BIDSTACK_SECRET_SECURITY_OWNER ||
      '',
    ownerApprovalTicket: process.env.BIDSTACK_SECRET_OWNER_APPROVAL_TICKET || '',
    ownerApprovedAt: process.env.BIDSTACK_SECRET_OWNER_APPROVED_AT || '',
    rotationVerifiedAt: process.env.BIDSTACK_SECRET_ROTATION_VERIFIED_AT || '',
    fullHistoryReviewed: parseOptionalBoolean(process.env.BIDSTACK_SECRET_FULL_HISTORY_REVIEWED) ?? false,
    fullHistoryClean: parseOptionalBoolean(process.env.BIDSTACK_SECRET_FULL_HISTORY_CLEAN),
    historicalFindingsCount: parseOptionalInteger(process.env.BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT),
    historicalFindingsRotatedOrRevoked:
      parseOptionalBoolean(process.env.BIDSTACK_SECRET_HISTORICAL_ROTATED) ?? false,
    ownerApprovedDisposition: parseOptionalBoolean(process.env.BIDSTACK_SECRET_OWNER_APPROVED) ?? false,
    runFullHistory: parseOptionalBoolean(process.env.BIDSTACK_SECRET_RUN_FULL_HISTORY) ?? false,
    gitleaksMode: normalizeGitleaksMode(process.env.BIDSTACK_GITLEAKS_MODE || 'auto'),
    gitleaksBin: process.env.BIDSTACK_GITLEAKS_BIN || process.env.GITLEAKS_BIN || 'gitleaks',
    gitleaksImage: process.env.BIDSTACK_GITLEAKS_IMAGE || DEFAULT_GITLEAKS_IMAGE,
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
    } else if (arg === '--raw-report-dir') {
      parsed.rawReportDir = argv[index + 1] ?? parsed.rawReportDir;
      index += 1;
    } else if (arg.startsWith('--raw-report-dir=')) {
      parsed.rawReportDir = arg.slice('--raw-report-dir='.length);
    } else if (arg === '--disposition-file' || arg === '--disposition') {
      parsed.dispositionFile = argv[index + 1] ?? parsed.dispositionFile;
      index += 1;
    } else if (arg.startsWith('--disposition-file=')) {
      parsed.dispositionFile = arg.slice('--disposition-file='.length);
    } else if (arg.startsWith('--disposition=')) {
      parsed.dispositionFile = arg.slice('--disposition='.length);
    } else if (arg === '--reviewer') {
      parsed.reviewer = argv[index + 1] ?? parsed.reviewer;
      index += 1;
    } else if (arg.startsWith('--reviewer=')) {
      parsed.reviewer = arg.slice('--reviewer='.length);
    } else if (arg === '--owner-approver' || arg === '--security-owner') {
      parsed.ownerApprover = argv[index + 1] ?? parsed.ownerApprover;
      index += 1;
    } else if (arg.startsWith('--owner-approver=')) {
      parsed.ownerApprover = arg.slice('--owner-approver='.length);
    } else if (arg.startsWith('--security-owner=')) {
      parsed.ownerApprover = arg.slice('--security-owner='.length);
    } else if (arg === '--owner-approval-ticket') {
      parsed.ownerApprovalTicket = argv[index + 1] ?? parsed.ownerApprovalTicket;
      index += 1;
    } else if (arg.startsWith('--owner-approval-ticket=')) {
      parsed.ownerApprovalTicket = arg.slice('--owner-approval-ticket='.length);
    } else if (arg === '--owner-approved-at') {
      parsed.ownerApprovedAt = argv[index + 1] ?? parsed.ownerApprovedAt;
      index += 1;
    } else if (arg.startsWith('--owner-approved-at=')) {
      parsed.ownerApprovedAt = arg.slice('--owner-approved-at='.length);
    } else if (arg === '--rotation-verified-at') {
      parsed.rotationVerifiedAt = argv[index + 1] ?? parsed.rotationVerifiedAt;
      index += 1;
    } else if (arg.startsWith('--rotation-verified-at=')) {
      parsed.rotationVerifiedAt = arg.slice('--rotation-verified-at='.length);
    } else if (arg === '--full-history-reviewed') {
      parsed.fullHistoryReviewed = true;
    } else if (arg === '--full-history-clean') {
      parsed.fullHistoryClean = true;
      parsed.historicalFindingsCount ??= 0;
    } else if (arg === '--historical-findings-count') {
      parsed.historicalFindingsCount = parseRequiredInteger(argv[index + 1], arg);
      index += 1;
    } else if (arg.startsWith('--historical-findings-count=')) {
      parsed.historicalFindingsCount = parseRequiredInteger(
        arg.slice('--historical-findings-count='.length),
        '--historical-findings-count',
      );
    } else if (arg === '--historical-findings-rotated') {
      parsed.historicalFindingsRotatedOrRevoked = true;
    } else if (arg === '--owner-approved') {
      parsed.ownerApprovedDisposition = true;
    } else if (arg === '--run-full-history') {
      parsed.runFullHistory = true;
    } else if (arg === '--gitleaks-mode') {
      parsed.gitleaksMode = normalizeGitleaksMode(argv[index + 1] ?? parsed.gitleaksMode);
      index += 1;
    } else if (arg.startsWith('--gitleaks-mode=')) {
      parsed.gitleaksMode = normalizeGitleaksMode(arg.slice('--gitleaks-mode='.length));
    } else if (arg === '--gitleaks-bin') {
      parsed.gitleaksBin = argv[index + 1] ?? parsed.gitleaksBin;
      index += 1;
    } else if (arg.startsWith('--gitleaks-bin=')) {
      parsed.gitleaksBin = arg.slice('--gitleaks-bin='.length);
    } else if (arg === '--gitleaks-image') {
      parsed.gitleaksImage = argv[index + 1] ?? parsed.gitleaksImage;
      index += 1;
    } else if (arg.startsWith('--gitleaks-image=')) {
      parsed.gitleaksImage = arg.slice('--gitleaks-image='.length);
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
  return applyDispositionFile(parsed);
}

function printHelp() {
  process.stdout.write(`BidStack secret scan evidence writer

Usage:
  node scripts/write-secret-scan-evidence.mjs --reviewer release-security@example.com --owner-approver security-owner@example.com --full-history-reviewed --historical-findings-count 11 --historical-findings-rotated --owner-approved
  node scripts/write-secret-scan-evidence.mjs --disposition-file deploy-evidence/secret-history-disposition.json
  node scripts/write-secret-scan-evidence.mjs --run-full-history --reviewer release-security@example.com --owner-approver security-owner@example.com --historical-findings-rotated --owner-approved
  node scripts/write-secret-scan-evidence.mjs --selftest

Environment:
  BIDSTACK_SECRET_SCAN_EVIDENCE
  BIDSTACK_SECRET_SCAN_RAW_REPORT_DIR
  BIDSTACK_SECRET_DISPOSITION_FILE
  BIDSTACK_SECRET_REVIEWER
  BIDSTACK_SECRET_OWNER_APPROVER / BIDSTACK_SECRET_SECURITY_OWNER
  BIDSTACK_SECRET_OWNER_APPROVAL_TICKET
  BIDSTACK_SECRET_OWNER_APPROVED_AT
  BIDSTACK_SECRET_ROTATION_VERIFIED_AT
  BIDSTACK_SECRET_FULL_HISTORY_REVIEWED
  BIDSTACK_SECRET_FULL_HISTORY_CLEAN
  BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT
  BIDSTACK_SECRET_HISTORICAL_ROTATED
  BIDSTACK_SECRET_OWNER_APPROVED
  BIDSTACK_SECRET_RUN_FULL_HISTORY
  BIDSTACK_GITLEAKS_MODE=auto|native|docker
  BIDSTACK_GITLEAKS_BIN / GITLEAKS_BIN
  BIDSTACK_GITLEAKS_IMAGE
`);
}

function pickString(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function pickBoolean(source, names, fallback) {
  for (const name of names) {
    if (source?.[name] !== undefined && source?.[name] !== null && source?.[name] !== '') {
      return parseOptionalBoolean(source[name]) ?? fallback;
    }
  }
  return fallback;
}

function pickInteger(source, names, fallback) {
  for (const name of names) {
    if (source?.[name] !== undefined && source?.[name] !== null && source?.[name] !== '') {
      return parseRequiredInteger(source[name], name);
    }
  }
  return fallback;
}

function normalizeDispositionRecord(value) {
  if (value && typeof value === 'object' && value.secretHistoryDisposition) {
    return value.secretHistoryDisposition;
  }
  return value;
}

function parseJsonFileAllowBom(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
}

function applyDispositionFile(options) {
  if (!String(options.dispositionFile || '').trim()) {
    return options;
  }

  const absolutePath = path.resolve(options.root, options.dispositionFile);
  const parsed = normalizeDispositionRecord(parseJsonFileAllowBom(absolutePath));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Secret disposition file must contain a JSON object: ${options.dispositionFile}`);
  }

  return {
    ...options,
    dispositionFile: path.relative(options.root, absolutePath),
    reviewer: pickString(parsed, ['reviewer', 'securityReviewer']) || options.reviewer,
    ownerApprover:
      pickString(parsed, ['ownerApprover', 'securityOwnerApprover', 'securityOwner', 'ownerApprovedBy']) ||
      options.ownerApprover,
    ownerApprovalTicket:
      pickString(parsed, ['ownerApprovalTicket', 'securityOwnerApprovalTicket', 'approvalTicket', 'ticket']) ||
      options.ownerApprovalTicket,
    ownerApprovedAt:
      pickString(parsed, ['ownerApprovedAt', 'securityOwnerApprovedAt', 'approvedAt']) ||
      options.ownerApprovedAt,
    rotationVerifiedAt:
      pickString(parsed, ['rotationVerifiedAt', 'historicalFindingsRotatedAt', 'rotatedAt']) ||
      options.rotationVerifiedAt,
    fullHistoryReviewed: pickBoolean(parsed, ['fullHistoryReviewed', 'fullHistoryGitleaksReviewed'], options.fullHistoryReviewed),
    fullHistoryClean: pickBoolean(parsed, ['fullHistoryClean'], options.fullHistoryClean),
    historicalFindingsCount: pickInteger(parsed, ['historicalFindingsCount', 'fullHistoryFindings'], options.historicalFindingsCount),
    historicalFindingsRotatedOrRevoked: pickBoolean(
      parsed,
      ['historicalFindingsRotatedOrRevoked', 'rotatedHistoricalCredentials'],
      options.historicalFindingsRotatedOrRevoked,
    ),
    ownerApprovedDisposition: pickBoolean(
      parsed,
      ['ownerApprovedDisposition', 'securityOwnerApprovedDisposition'],
      options.ownerApprovedDisposition,
    ),
  };
}

function normalizeGitleaksMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase();
  if (['auto', 'native', 'docker'].includes(mode)) {
    return mode;
  }
  throw new Error(`Invalid gitleaks mode: ${value}`);
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  return parseRequiredInteger(value, 'integer');
}

function parseRequiredInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function isIsoTimestamp(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T/.test(normalized) && Number.isFinite(Date.parse(normalized));
}

function hasPlaceholderSignal(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    PLACEHOLDER_EXACT_VALUES.has(normalized) ||
    PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function runCommand(root, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    shell: false,
  });

  if (result.error) {
    return {
      command: commandLabel(command, args),
      exitCode: null,
      passed: false,
      error: result.error.code || result.error.message,
    };
  }

  return {
    command: commandLabel(command, args),
    exitCode: result.status,
    passed: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function dockerMountPath(absolutePath) {
  return path.resolve(absolutePath).replace(/\\/g, '/');
}

function buildGitleaksArgs({ reportPath, currentCommitOnly, sourcePath = '.' }) {
  const args = [
    'git',
    '--config=.gitleaks.toml',
    '--redact=100',
    '--report-format=json',
    `--report-path=${reportPath}`,
  ];
  if (currentCommitOnly) {
    args.push('--log-opts=--max-count=1');
  }
  args.push(sourcePath);
  return args;
}

function resolveGitleaksRunner(root, options) {
  if (options.gitleaksMode === 'docker') {
    return { kind: 'docker' };
  }

  const nativeProbe = runCommand(root, options.gitleaksBin, ['version']);
  if (nativeProbe.passed) {
    return { kind: 'native' };
  }

  if (options.gitleaksMode === 'native') {
    return {
      kind: 'unavailable',
      summary: summarizeCommand(nativeProbe, {
        scanner: 'gitleaks-native-probe',
        requestedMode: options.gitleaksMode,
      }),
    };
  }

  return { kind: 'docker', nativeProbe: summarizeCommand(nativeProbe, { scanner: 'gitleaks-native-probe' }) };
}

function runGitleaksWithRunner(root, options, runner, reportPath, currentCommitOnly) {
  if (runner.kind === 'unavailable') {
    return {
      command: `${options.gitleaksBin} version`,
      exitCode: null,
      passed: false,
      error: runner.summary.error || 'gitleaks native executable is unavailable',
      stdout: '',
      stderr: '',
      runner: 'unavailable',
    };
  }

  if (runner.kind === 'native') {
    const args = buildGitleaksArgs({ reportPath, currentCommitOnly });
    return {
      ...runCommand(root, options.gitleaksBin, args, { maxBuffer: 25 * 1024 * 1024 }),
      runner: 'native',
    };
  }

  const containerReportPath = `/reports/${path.basename(reportPath)}`;
  const dockerArgs = [
    'run',
    '--rm',
    '-v',
    `${dockerMountPath(root)}:/repo:ro`,
    '-v',
    `${dockerMountPath(path.dirname(reportPath))}:/reports`,
    '-w',
    '/repo',
    '-e',
    'GIT_CONFIG_COUNT=1',
    '-e',
    'GIT_CONFIG_KEY_0=safe.directory',
    '-e',
    'GIT_CONFIG_VALUE_0=/repo',
    options.gitleaksImage,
    ...buildGitleaksArgs({
      reportPath: containerReportPath,
      currentCommitOnly,
      sourcePath: '/repo',
    }).map((arg) => (arg === '--config=.gitleaks.toml' ? '--config=/repo/.gitleaks.toml' : arg)),
  ];

  return {
    ...runCommand(root, 'docker', dockerArgs, { maxBuffer: 25 * 1024 * 1024 }),
    runner: 'docker',
  };
}

function summarizeCommand(result, extra = {}) {
  return {
    command: result.command,
    exitCode: result.exitCode,
    passed: result.passed,
    error: result.error || undefined,
    ...extra,
  };
}

function runTrackedTreeScan(root) {
  const result = runCommand(root, 'bash', ['scripts/check-secrets.sh', '--full']);
  return {
    clean: result.passed,
    summary: summarizeCommand(result, { scanner: 'scripts/check-secrets.sh --full' }),
  };
}

function runGit(root, args) {
  return runCommand(root, 'git', args, { maxBuffer: 25 * 1024 * 1024 });
}

function shouldScanUntrackedFile(relativePath) {
  const normalized = toPosix(relativePath);
  if (!normalized) return false;
  if (
    normalized.startsWith('node_modules/') ||
    normalized.startsWith('.git/') ||
    normalized.startsWith('dist/') ||
    normalized.startsWith('build/') ||
    normalized.startsWith('coverage/') ||
    normalized.startsWith('deploy-evidence/') ||
    normalized.startsWith('load-test-report/') ||
    normalized.includes('/node_modules/') ||
    normalized.includes('/dist/') ||
    normalized.includes('/build/') ||
    normalized.includes('/coverage/')
  ) {
    return false;
  }
  if (/\.(png|jpg|jpeg|gif|webp|avif|ico|pdf|zip|gz|tgz|7z|mp4|mov|woff2?|ttf)$/i.test(normalized)) {
    return false;
  }
  if (normalized.endsWith('.md') || normalized.endsWith('.env.example') || normalized.endsWith('pnpm-lock.yaml')) {
    return false;
  }
  return true;
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function hasBinaryNull(bytes) {
  return bytes.includes(0);
}

function scanUntrackedFiles(root) {
  const listing = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (!listing.passed) {
    return {
      clean: false,
      filesScanned: 0,
      hitCount: 0,
      hitFiles: [],
      summary: summarizeCommand(listing, { scanner: 'git ls-files --others --exclude-standard' }),
    };
  }

  const files = listing.stdout
    .split('\0')
    .map((file) => file.trim())
    .filter(Boolean)
    .filter(shouldScanUntrackedFile);

  const hitFiles = [];
  let hitCount = 0;
  let filesScanned = 0;

  for (const relativePath of files) {
    const absolutePath = path.resolve(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    const bytes = readFileSync(absolutePath);
    if (hasBinaryNull(bytes)) continue;
    filesScanned += 1;
    const text = bytes.toString('utf8');
    SECRET_PATTERN.lastIndex = 0;
    const matches = text.match(SECRET_PATTERN);
    if (matches && matches.length > 0) {
      hitCount += matches.length;
      if (hitFiles.length < MAX_RECORDED_HIT_FILES) {
        hitFiles.push(toPosix(relativePath));
      }
    }
  }

  return {
    clean: hitCount === 0,
    filesScanned,
    hitCount,
    hitFiles,
    summary: {
      command: 'git ls-files --others --exclude-standard -z + node secret regex',
      exitCode: 0,
      passed: hitCount === 0,
      scanner: 'untracked-file-secret-regex',
      filesScanned,
      hitCount,
      hitFiles,
    },
  };
}

function parseGitleaksReport(reportPath) {
  if (!existsSync(reportPath)) return null;
  const raw = readFileSync(reportPath, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.findings)) return parsed.findings;
  return [];
}

function persistGitleaksRawReport(root, options, reportPath, currentCommitOnly) {
  if (!existsSync(reportPath)) return '';
  const fileName = currentCommitOnly ? 'gitleaks-current-commit.json' : 'gitleaks-full-history.json';
  const absolutePath = path.resolve(root, options.rawReportDir || DEFAULT_RAW_REPORT_DIR, fileName);
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Gitleaks raw report path must stay inside the repo: ${absolutePath}`);
  }
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  copyFileSync(reportPath, absolutePath);
  return toPosix(relativePath);
}

function runGitleaks(root, options, { currentCommitOnly }) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'bidcrm-gitleaks-'));
  const reportPath = path.join(tempDir, currentCommitOnly ? 'current.json' : 'full-history.json');

  try {
    const runner = resolveGitleaksRunner(root, options);
    const result = runGitleaksWithRunner(root, options, runner, reportPath, currentCommitOnly);
    const findings = parseGitleaksReport(reportPath);
    const findingsCount = findings ? findings.length : null;
    const clean = result.exitCode === 0 && findingsCount === 0;
    const findingsExit = result.exitCode === 1 && findingsCount !== null && findingsCount > 0;
    const rawReportPath = findings !== null ? persistGitleaksRawReport(root, options, reportPath, currentCommitOnly) : '';
    return {
      clean,
      reviewed: result.exitCode === 0 || findingsExit,
      findingsCount,
      summary: summarizeCommand(result, {
        scanner: currentCommitOnly ? 'gitleaks-current-commit' : 'gitleaks-full-history',
        runner: result.runner,
        image: result.runner === 'docker' ? options.gitleaksImage : undefined,
        nativeFallback:
          runner.kind === 'docker' && runner.nativeProbe ? runner.nativeProbe.error || 'native-unavailable' : undefined,
        findingsCount,
        rawReportPath,
      }),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function normalizeManualDisposition(options, fullHistoryScan) {
  if (fullHistoryScan) {
    return {
      fullHistoryReviewed: fullHistoryScan.reviewed,
      fullHistoryClean: fullHistoryScan.clean,
      historicalFindingsCount: fullHistoryScan.findingsCount,
      fullHistoryReviewMethod: 'gitleaks-full-history',
    };
  }

  const count =
    options.fullHistoryClean === true && options.historicalFindingsCount === null
      ? 0
      : options.historicalFindingsCount;
  const fullHistoryClean =
    options.fullHistoryClean === true || (Number.isInteger(count) && count === 0)
      ? true
      : options.fullHistoryClean === false || Number.isInteger(count)
        ? false
        : null;

  return {
    fullHistoryReviewed: options.fullHistoryReviewed,
    fullHistoryClean,
    historicalFindingsCount: count,
    fullHistoryReviewMethod: 'manual-disposition',
  };
}

function buildArtifact(options, scanResults) {
  const history = normalizeManualDisposition(options, scanResults.fullHistory);
  const trackedTreeClean = scanResults.trackedTree.clean;
  const untrackedSecretScanClean = scanResults.untracked.clean;
  const currentCommitGitleaksClean = scanResults.currentCommit.clean;
  const currentTreeClean = trackedTreeClean && untrackedSecretScanClean;

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    currentTreeClean,
    trackedTreeClean,
    untrackedSecretScanClean,
    currentCommitGitleaksClean,
    fullHistoryReviewed: history.fullHistoryReviewed,
    fullHistoryClean: history.fullHistoryClean,
    historicalFindingsCount: history.historicalFindingsCount,
    historicalFindingsRotatedOrRevoked: options.historicalFindingsRotatedOrRevoked,
    ownerApprovedDisposition: options.ownerApprovedDisposition,
    reviewer: String(options.reviewer || '').trim(),
    ownerApprover: String(options.ownerApprover || '').trim(),
    ownerApprovalTicket: String(options.ownerApprovalTicket || '').trim(),
    ownerApprovedAt: String(options.ownerApprovedAt || '').trim(),
    rotationVerifiedAt: String(options.rotationVerifiedAt || '').trim(),
    dispositionSource: options.dispositionFile ? 'file' : 'environment-or-cli',
    dispositionFile: options.dispositionFile ? toPosix(options.dispositionFile) : undefined,
    fullHistoryReviewMethod: history.fullHistoryReviewMethod,
    rawReports: {
      currentCommit: scanResults.currentCommit.summary.rawReportPath || '',
      fullHistory: scanResults.fullHistory?.summary.rawReportPath || '',
    },
    commands: [
      scanResults.trackedTree.summary,
      scanResults.untracked.summary,
      scanResults.currentCommit.summary,
      ...(scanResults.fullHistory ? [scanResults.fullHistory.summary] : []),
    ],
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
  if (artifact.trackedTreeClean !== true) failures.push('tracked tree secret scan is not clean');
  if (artifact.untrackedSecretScanClean !== true) failures.push('untracked file secret scan is not clean');
  if (artifact.currentTreeClean !== true) failures.push('current tree secret scan is not clean');
  if (artifact.currentCommitGitleaksClean !== true) failures.push('current commit gitleaks snapshot is not clean');
  if (artifact.currentCommitGitleaksClean === true && !String(artifact.rawReports?.currentCommit || '').trim()) {
    failures.push('current commit gitleaks raw report is required');
  }
  if (artifact.fullHistoryReviewed !== true) failures.push('full git history must be reviewed');
  if (
    artifact.fullHistoryReviewMethod === 'gitleaks-full-history' &&
    !String(artifact.rawReports?.fullHistory || '').trim()
  ) {
    failures.push('full-history gitleaks raw report is required');
  }

  const count = Number(artifact.historicalFindingsCount);
  const hasCount = Number.isInteger(count) && count >= 0;
  if (artifact.fullHistoryClean === true && hasCount && count > 0) {
    failures.push('fullHistoryClean cannot be true when historical findings are present');
  }
  if (artifact.fullHistoryClean === false && hasCount && count === 0) {
    failures.push('fullHistoryClean cannot be false when historical findings count is zero');
  }

  const historyIsClean = artifact.fullHistoryClean === true || (hasCount && count === 0);
  if (!historyIsClean) {
    if (!hasCount) {
      failures.push('historicalFindingsCount or fullHistoryClean is required');
    }
    if (artifact.historicalFindingsRotatedOrRevoked !== true) {
      failures.push('historical findings require rotated or revoked credentials');
    } else if (!isIsoTimestamp(artifact.rotationVerifiedAt)) {
      failures.push('historical rotation/revocation requires an ISO rotationVerifiedAt timestamp');
    }
    if (artifact.ownerApprovedDisposition !== true) {
      failures.push('historical findings require owner-approved disposition');
    } else {
      const ownerApprover = String(artifact.ownerApprover || '').trim();
      if (!ownerApprover) {
        failures.push('owner-approved disposition requires a named owner approver');
      } else if (hasPlaceholderSignal(ownerApprover)) {
        failures.push('owner-approved disposition owner approver looks like placeholder evidence');
      }

      const ownerApprovalTicket = String(artifact.ownerApprovalTicket || '').trim();
      if (!ownerApprovalTicket) {
        failures.push('owner-approved disposition requires an approval ticket or reference');
      } else if (hasPlaceholderSignal(ownerApprovalTicket)) {
        failures.push('owner-approved disposition ticket looks like placeholder evidence');
      }
      if (!isIsoTimestamp(artifact.ownerApprovedAt)) {
        failures.push('owner-approved disposition requires an ISO ownerApprovedAt timestamp');
      }
    }
  }

  if (!String(artifact.reviewer || '').trim()) {
    failures.push('secret disposition requires a named reviewer');
  } else if (hasPlaceholderSignal(artifact.reviewer)) {
    failures.push('secret disposition reviewer looks like placeholder evidence');
  }

  return failures;
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = path.resolve(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function runScans(options) {
  return {
    trackedTree: runTrackedTreeScan(options.root),
    untracked: scanUntrackedFiles(options.root),
    currentCommit: runGitleaks(options.root, options, { currentCommitOnly: true }),
    fullHistory: options.runFullHistory
      ? runGitleaks(options.root, options, { currentCommitOnly: false })
      : null,
  };
}

function runWriter(options) {
  const scanResults = runScans(options);
  const artifact = buildArtifact(options, scanResults);
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);

  process.stdout.write(`Secret scan evidence: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Tracked tree clean: ${artifact.trackedTreeClean ? 'yes' : 'no'}\n`);
  process.stdout.write(`Untracked scan clean: ${artifact.untrackedSecretScanClean ? 'yes' : 'no'}\n`);
  process.stdout.write(`Current commit gitleaks clean: ${artifact.currentCommitGitleaksClean ? 'yes' : 'no'}\n`);
  process.stdout.write(`Full-history method: ${artifact.fullHistoryReviewMethod}\n`);
  process.stdout.write(
    `Historical findings: ${
      Number.isInteger(Number(artifact.historicalFindingsCount)) ? artifact.historicalFindingsCount : 'unknown'
    }\n`,
  );

  if (artifact.validationFailures.length > 0) {
    for (const failure of artifact.validationFailures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    return 1;
  }

  process.stdout.write('Secret scan evidence passed\n');
  return 0;
}

function fakeScanResults({
  trackedTreeClean = true,
  untrackedClean = true,
  currentCommitClean = true,
  fullHistory = null,
} = {}) {
  return {
    trackedTree: {
      clean: trackedTreeClean,
      summary: { command: 'fixture tracked scan', exitCode: trackedTreeClean ? 0 : 1, passed: trackedTreeClean },
    },
    untracked: {
      clean: untrackedClean,
      summary: {
        command: 'fixture untracked scan',
        exitCode: untrackedClean ? 0 : 1,
        passed: untrackedClean,
        filesScanned: 1,
        hitCount: untrackedClean ? 0 : 1,
      },
    },
    currentCommit: {
      clean: currentCommitClean,
      summary: {
        command: 'fixture current gitleaks',
        exitCode: currentCommitClean ? 0 : 1,
        passed: currentCommitClean,
        scanner: 'gitleaks-current-commit',
        findingsCount: currentCommitClean ? 0 : 1,
        rawReportPath: 'deploy-evidence/secret-scan-reports/fixture-current.json',
      },
    },
    fullHistory,
  };
}

function baseOptions(overrides = {}) {
  return {
    root: process.cwd(),
    outputPath: DEFAULT_OUTPUT_PATH,
    rawReportDir: DEFAULT_RAW_REPORT_DIR,
    reviewer: 'release-security@bidstack360.com',
    ownerApprover: 'security-owner@bidstack360.com',
    ownerApprovalTicket: 'MANTU-SEC-92741',
    ownerApprovedAt: '2026-06-18T10:00:00.000Z',
    rotationVerifiedAt: '2026-06-18T09:30:00.000Z',
    dispositionFile: '',
    fullHistoryReviewed: true,
    fullHistoryClean: null,
    historicalFindingsCount: 11,
    historicalFindingsRotatedOrRevoked: true,
    ownerApprovedDisposition: true,
    runFullHistory: false,
    gitleaksMode: 'auto',
    gitleaksBin: 'gitleaks',
    gitleaksImage: DEFAULT_GITLEAKS_IMAGE,
    ...overrides,
  };
}

function secretFixture(parts) {
  return parts.join('');
}

function runSelftest() {
  for (const fixture of [
    secretFixture(['sk-', 'proj-', '1234567890abcdef1234567890abcdef']),
    secretFixture(['sk-', 'ant-api03-', '1234567890abcdef1234567890abcdef']),
    secretFixture(['github_', 'pat_', '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ_123456']),
    secretFixture(['xox', 'b-', '123456789012-123456789012-abcdefghijklmnopqrstuv']),
    secretFixture(['AI', 'zaSyA', '1234567890abcdefghijklmnopqrstuvwx']),
    secretFixture(['Account', 'Key=', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=']),
  ]) {
    SECRET_PATTERN.lastIndex = 0;
    assert.equal(SECRET_PATTERN.test(fixture), true, `expected modern secret fixture to be detected: ${fixture}`);
  }

  const ownSource = readFileSync(new URL(import.meta.url), 'utf8');
  SECRET_PATTERN.lastIndex = 0;
  assert.equal(SECRET_PATTERN.test(ownSource), false, 'secret scan writer source must not contain raw token fixtures');

  const cleanHistory = buildArtifact(
    baseOptions({ fullHistoryClean: true, historicalFindingsCount: 0 }),
    fakeScanResults(),
  );
  assert.deepEqual(cleanHistory.validationFailures, [], 'expected clean full-history fixture to pass');
  assert.equal(cleanHistory.passed, true);

  const historicalDisposition = buildArtifact(baseOptions(), fakeScanResults());
  assert.deepEqual(historicalDisposition.validationFailures, [], 'expected rotated historical finding fixture to pass');
  assert.equal(historicalDisposition.passed, true);

  const missingReviewer = buildArtifact(baseOptions({ reviewer: '' }), fakeScanResults());
  assert.equal(missingReviewer.passed, false, 'expected missing reviewer to fail');
  assert.equal(
    missingReviewer.validationFailures.some((failure) => failure.includes('named reviewer')),
    true,
    'expected reviewer failure',
  );

  const missingOwnerApproval = buildArtifact(baseOptions({ ownerApprovedDisposition: false }), fakeScanResults());
  assert.equal(missingOwnerApproval.passed, false, 'expected unresolved history without owner approval to fail');
  assert.equal(
    missingOwnerApproval.validationFailures.some((failure) => failure.includes('owner-approved')),
    true,
    'expected owner approval failure',
  );

  const missingOwnerApprover = buildArtifact(baseOptions({ ownerApprover: '' }), fakeScanResults());
  assert.equal(missingOwnerApprover.passed, false, 'expected owner approval without approver identity to fail');
  assert.equal(
    missingOwnerApprover.validationFailures.some((failure) => failure.includes('owner approver')),
    true,
    'expected owner approver failure',
  );

  const placeholderOwnerApprover = buildArtifact(
    baseOptions({ ownerApprover: 'security-owner@example.com' }),
    fakeScanResults(),
  );
  assert.equal(placeholderOwnerApprover.passed, false, 'expected placeholder owner approver to fail');
  assert.equal(
    placeholderOwnerApprover.validationFailures.some((failure) => failure.includes('placeholder')),
    true,
    'expected placeholder owner approver failure',
  );

  const missingOwnerApprovalTicket = buildArtifact(baseOptions({ ownerApprovalTicket: '' }), fakeScanResults());
  assert.equal(missingOwnerApprovalTicket.passed, false, 'expected owner approval without a ticket to fail');
  assert.equal(
    missingOwnerApprovalTicket.validationFailures.some((failure) => failure.includes('ticket')),
    true,
    'expected owner approval ticket failure',
  );

  const placeholderOwnerApprovalTicket = buildArtifact(
    baseOptions({ ownerApprovalTicket: 'SEC-1234' }),
    fakeScanResults(),
  );
  assert.equal(placeholderOwnerApprovalTicket.passed, false, 'expected placeholder owner approval ticket to fail');
  assert.equal(
    placeholderOwnerApprovalTicket.validationFailures.some((failure) => failure.includes('placeholder')),
    true,
    'expected placeholder owner approval ticket failure',
  );

  const placeholderReviewer = buildArtifact(
    baseOptions({ reviewer: 'release-security@example.com' }),
    fakeScanResults(),
  );
  assert.equal(placeholderReviewer.passed, false, 'expected placeholder reviewer to fail');
  assert.equal(
    placeholderReviewer.validationFailures.some((failure) => failure.includes('placeholder')),
    true,
    'expected placeholder reviewer failure',
  );

  const missingRotationTimestamp = buildArtifact(baseOptions({ rotationVerifiedAt: '' }), fakeScanResults());
  assert.equal(missingRotationTimestamp.passed, false, 'expected rotation evidence without timestamp to fail');
  assert.equal(
    missingRotationTimestamp.validationFailures.some((failure) => failure.includes('rotationVerifiedAt')),
    true,
    'expected rotation timestamp failure',
  );

  const dispositionRoot = mkdtempSync(path.join(tmpdir(), 'bidcrm-secret-disposition-'));
  try {
    writeFileSync(
      path.join(dispositionRoot, 'secret-history-disposition.json'),
      `\uFEFF${JSON.stringify(
        {
          fullHistoryReviewed: true,
          historicalFindingsCount: 11,
          historicalFindingsRotatedOrRevoked: true,
          ownerApprovedDisposition: true,
          ownerApprover: 'security-owner@bidstack360.com',
          ownerApprovalTicket: 'MANTU-SEC-45678',
          ownerApprovedAt: '2026-06-18T11:00:00.000Z',
          rotationVerifiedAt: '2026-06-18T10:30:00.000Z',
          reviewer: 'release-security@bidstack360.com',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const fromFile = buildArtifact(
      applyDispositionFile(
        baseOptions({
          root: dispositionRoot,
          dispositionFile: 'secret-history-disposition.json',
          reviewer: '',
          ownerApprover: '',
          ownerApprovalTicket: '',
          ownerApprovedAt: '',
          rotationVerifiedAt: '',
          fullHistoryReviewed: false,
          historicalFindingsCount: null,
          historicalFindingsRotatedOrRevoked: false,
          ownerApprovedDisposition: false,
        }),
      ),
      fakeScanResults(),
    );
    assert.equal(fromFile.passed, true, 'expected disposition file fixture to pass');
    assert.equal(fromFile.dispositionSource, 'file');
    assert.equal(fromFile.ownerApprovalTicket, 'MANTU-SEC-45678');
  } finally {
    rmSync(dispositionRoot, { recursive: true, force: true });
  }

  const placeholderDispositionRoot = mkdtempSync(path.join(tmpdir(), 'bidcrm-secret-disposition-placeholder-'));
  try {
    writeFileSync(
      path.join(placeholderDispositionRoot, 'secret-history-disposition.json'),
      `${JSON.stringify(
        {
          fullHistoryReviewed: true,
          historicalFindingsCount: 11,
          historicalFindingsRotatedOrRevoked: true,
          ownerApprovedDisposition: true,
          ownerApprover: 'security-owner@example.com',
          ownerApprovalTicket: 'SEC-1234',
          ownerApprovedAt: '2026-06-18T11:00:00.000Z',
          rotationVerifiedAt: '2026-06-18T10:30:00.000Z',
          reviewer: 'release-security@example.com',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const fromPlaceholderFile = buildArtifact(
      applyDispositionFile(
        baseOptions({
          root: placeholderDispositionRoot,
          dispositionFile: 'secret-history-disposition.json',
          reviewer: '',
          ownerApprover: '',
          ownerApprovalTicket: '',
        }),
      ),
      fakeScanResults(),
    );
    assert.equal(fromPlaceholderFile.passed, false, 'expected copied template disposition file to fail');
    assert.equal(
      fromPlaceholderFile.validationFailures.filter((failure) => failure.includes('placeholder')).length >= 3,
      true,
      'expected placeholder reviewer, owner, and ticket failures from file',
    );
  } finally {
    rmSync(placeholderDispositionRoot, { recursive: true, force: true });
  }

  const dirtyCurrentScan = buildArtifact(baseOptions(), fakeScanResults({ currentCommitClean: false }));
  assert.equal(dirtyCurrentScan.passed, false, 'expected dirty current commit snapshot to fail');
  assert.equal(
    dirtyCurrentScan.validationFailures.some((failure) => failure.includes('current commit')),
    true,
    'expected current commit failure',
  );

  const gitleaksHistory = buildArtifact(
    baseOptions({ fullHistoryReviewed: false, historicalFindingsCount: null }),
    fakeScanResults({
      fullHistory: {
        clean: false,
        reviewed: true,
        findingsCount: 3,
        summary: {
          command: 'fixture full-history gitleaks',
          exitCode: 1,
          passed: false,
          scanner: 'gitleaks-full-history',
          findingsCount: 3,
          rawReportPath: 'deploy-evidence/secret-scan-reports/fixture-full-history.json',
        },
      },
    }),
  );
  assert.equal(gitleaksHistory.fullHistoryReviewed, true);
  assert.equal(gitleaksHistory.historicalFindingsCount, 3);
  assert.equal(gitleaksHistory.passed, true, 'expected run-full-history result plus disposition to pass');

  assert.deepEqual(
    buildGitleaksArgs({ reportPath: 'out.json', currentCommitOnly: true }),
    [
      'git',
      '--config=.gitleaks.toml',
      '--redact=100',
      '--report-format=json',
      '--report-path=out.json',
      '--log-opts=--max-count=1',
      '.',
    ],
    'expected current Gitleaks command to use the supported git subcommand',
  );

  process.stdout.write('secret scan evidence selftest passed\n');
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
