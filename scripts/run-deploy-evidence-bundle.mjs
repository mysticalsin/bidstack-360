#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/release-evidence-bundle-latest.json';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_CAPTURE_CHARS = 16_000;
const OPS_EVIDENCE_REF_ENV = [
  {
    id: 'ops.evidence.approval',
    label: 'Operational approval has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_APPROVAL',
    paths: ['evidenceRefs.approval', 'approval.evidenceRef', 'approval.evidenceUrl'],
  },
  {
    id: 'ops.evidence.bicepBuild',
    label: 'Bicep build validation has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_BICEP_BUILD',
    paths: ['evidenceRefs.bicepBuild', 'infrastructure.bicepBuildEvidenceRef', 'infra.bicepBuildEvidenceRef'],
  },
  {
    id: 'ops.evidence.whatIf',
    label: 'Azure what-if validation has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_WHAT_IF',
    paths: ['evidenceRefs.whatIf', 'infrastructure.whatIfEvidenceRef', 'infra.whatIfEvidenceRef'],
  },
  {
    id: 'ops.evidence.privateNetworking',
    label: 'Private networking approval has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_PRIVATE_NETWORKING',
    paths: [
      'evidenceRefs.privateNetworking',
      'infrastructure.privateNetworkingEvidenceRef',
      'infra.privateNetworkingEvidenceRef',
    ],
  },
  {
    id: 'ops.evidence.storage',
    label: 'Storage validation has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_STORAGE',
    paths: ['evidenceRefs.storage', 'infrastructure.storageEvidenceRef', 'infra.storageEvidenceRef'],
  },
  {
    id: 'ops.evidence.migrationJob',
    label: 'Migration job validation has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_MIGRATION_JOB',
    paths: ['evidenceRefs.migrationJob', 'database.migrationJobEvidenceRef', 'migrations.jobEvidenceRef'],
  },
  {
    id: 'ops.evidence.migrationDeploy',
    label: 'Migration deploy validation has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_MIGRATION_DEPLOY',
    paths: [
      'evidenceRefs.migrationDeploy',
      'database.migrationDeployEvidenceRef',
      'migrations.deployEvidenceRef',
    ],
  },
  {
    id: 'ops.evidence.backupConfig',
    label: 'Backup configuration has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_BACKUP_CONFIG',
    paths: ['evidenceRefs.backupConfig', 'database.backupConfigEvidenceRef', 'backup.configEvidenceRef'],
  },
  {
    id: 'ops.evidence.restoreDrill',
    label: 'Restore drill has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_RESTORE_DRILL',
    paths: ['evidenceRefs.restoreDrill', 'database.restoreDrillEvidenceRef', 'backup.restoreDrillEvidenceRef'],
  },
  {
    id: 'ops.evidence.rollbackRunbook',
    label: 'Rollback runbook review has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_ROLLBACK_RUNBOOK',
    paths: ['evidenceRefs.rollbackRunbook', 'rollback.runbookEvidenceRef'],
  },
  {
    id: 'ops.evidence.rollbackDrill',
    label: 'Rollback drill has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_ROLLBACK_DRILL',
    paths: ['evidenceRefs.rollbackDrill', 'rollback.rollbackDrillEvidenceRef', 'rollback.drillEvidenceRef'],
  },
  {
    id: 'ops.evidence.monitoringAlerts',
    label: 'Monitoring alert validation has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_MONITORING_ALERTS',
    paths: ['evidenceRefs.monitoringAlerts', 'monitoring.alertsEvidenceRef'],
  },
  {
    id: 'ops.evidence.onCall',
    label: 'On-call escalation validation has reviewable evidence',
    env: 'BIDSTACK_OPS_EVIDENCE_ONCALL',
    paths: ['evidenceRefs.onCall', 'monitoring.onCallEvidenceRef', 'monitoring.oncallEvidenceRef'],
  },
];

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_DEPLOY_BUNDLE_REPORT || DEFAULT_OUTPUT_PATH,
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV || 'staging',
    dryRun: false,
    preflightOnly: false,
    continueOnError: false,
    timeoutMs: Number(process.env.BIDSTACK_DEPLOY_BUNDLE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--selftest') {
      parsed.selftest = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--preflight-only') {
      parsed.preflightOnly = true;
    } else if (arg === '--continue-on-error') {
      parsed.continueOnError = true;
    } else if (arg === '--env') {
      parsed.deployEnv = argv[index + 1] ?? parsed.deployEnv;
      index += 1;
    } else if (arg.startsWith('--env=')) {
      parsed.deployEnv = arg.slice('--env='.length);
    } else if (arg === '--root') {
      parsed.root = argv[index + 1] ?? parsed.root;
      index += 1;
    } else if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
    } else if (arg === '--out') {
      parsed.outputPath = argv[index + 1] ?? parsed.outputPath;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      parsed.outputPath = arg.slice('--out='.length);
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number(argv[index + 1] ?? parsed.timeoutMs);
      index += 1;
    } else if (arg.startsWith('--timeout-ms=')) {
      parsed.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.root = path.resolve(parsed.root);
  parsed.deployEnv = normalizeEnvironment(parsed.deployEnv);
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error(`Invalid timeout: ${parsed.timeoutMs}`);
  }
  if (parsed.dryRun && parsed.preflightOnly) {
    throw new Error('--dry-run and --preflight-only are mutually exclusive');
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack release evidence bundle runner

Usage:
  node scripts/run-deploy-evidence-bundle.mjs --env staging
  node scripts/run-deploy-evidence-bundle.mjs --env production
  node scripts/run-deploy-evidence-bundle.mjs --preflight-only --env production
  node scripts/run-deploy-evidence-bundle.mjs --dry-run --env production
  node scripts/run-deploy-evidence-bundle.mjs --selftest

Options:
  --env staging|production
  --out <path>
  --root <path>
  --preflight-only
  --dry-run
  --continue-on-error
  --timeout-ms <ms>

Environment:
  BIDSTACK_DEPLOY_ENV
  BIDSTACK_DEPLOY_BUNDLE_REPORT
  BIDSTACK_DEPLOY_BUNDLE_TIMEOUT_MS
`);
}

function normalizeEnvironment(value) {
  const normalized = String(value || 'staging')
    .trim()
    .toLowerCase();
  if (normalized === 'prod') return 'production';
  if (normalized === 'stage') return 'staging';
  if (normalized === 'production' || normalized === 'staging') return normalized;
  throw new Error(`Release evidence bundle only supports staging or production; got ${value}`);
}

function buildCommandPlan(deployEnv) {
  return [
    {
      id: 'tools',
      label: 'Release tool readiness',
      script: 'deploy:evidence:tools',
      required: true,
      env: {
        BIDSTACK_TOOL_READINESS_EXECUTE_IMAGE_PROBES: 'true',
      },
    },
    {
      id: 'source',
      label: 'Source-control evidence',
      script: 'deploy:evidence:source',
      required: true,
    },
    {
      id: 'sourcePlan',
      label: 'Source review cleanup plan',
      script: 'deploy:evidence:source:plan:write',
      required: true,
      diagnostic: true,
      runAfterFailedStepId: 'source',
    },
    {
      id: 'ops',
      label: 'Operational readiness evidence',
      script: 'deploy:evidence:ops',
      required: true,
    },
    {
      id: 'providers',
      label: 'Provider source quality evidence',
      script: 'deploy:evidence:providers',
      preflightDiagnosticScript: 'deploy:evidence:providers',
      required: true,
    },
    {
      id: 'load',
      label: 'Load certification evidence',
      script: 'deploy:evidence:load',
      preflightDiagnosticScript: 'deploy:evidence:load',
      required: true,
    },
    {
      id: 'semgrep',
      label: 'Semgrep SAST evidence',
      script: 'deploy:evidence:semgrep',
      required: true,
    },
    {
      id: 'container',
      label: 'Container vulnerability evidence',
      script: 'deploy:evidence:container',
      required: true,
    },
    {
      id: 'secrets',
      label: 'Secret-history disposition evidence',
      script: 'deploy:evidence:secrets',
      required: true,
    },
    {
      id: 'sentry',
      label: 'Sentry smoke evidence',
      script: 'deploy:evidence:sentry:trigger',
      required: true,
    },
    {
      id: 'browser',
      label: 'Cross-role browser regression evidence',
      script: 'deploy:evidence:browser',
      preflightDiagnosticScript: 'deploy:evidence:browser:write',
      required: true,
    },
    {
      id: 'verify',
      label: `Strict ${deployEnv} deploy verifier`,
      script: `deploy:evidence:${deployEnv}`,
      required: true,
      finalVerifier: true,
    },
  ].map((step) => ({
    ...step,
    ...commandFieldsForScript(step.script),
  }));
}

function commandFieldsForScript(script) {
  return {
    args: ['run', script],
    command: `pnpm run ${script}`,
  };
}

function quoteCmdArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_@./:=-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function runPnpm(root, args, options) {
  const startedAt = new Date();
  const command = process.platform === 'win32' ? 'cmd' : 'pnpm';
  const commandArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', ['pnpm', ...args].map(quoteCmdArg).join(' ')]
      : args;
  const commandText = process.platform === 'win32'
    ? ['pnpm', ...args].map(quoteCmdArg).join(' ')
    : ['pnpm', ...args].join(' ');

  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: 25 * 1024 * 1024,
    shell: false,
    timeout: options.timeoutMs,
  });
  const completedAt = new Date();
  const exitCode = result.status;
  const error = result.error ? result.error.code || result.error.message : '';

  return {
    command: commandText,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    exitCode,
    passed: exitCode === 0 && !error,
    stdoutTail: tailAndRedact(result.stdout || ''),
    stderrTail: tailAndRedact(result.stderr || ''),
    error: error || undefined,
  };
}

function redact(text) {
  return String(text || '')
    .replace(/(Authorization:\s*Bearer\s+)[^\s"'`,;]+/gi, '$1<redacted>')
    .replace(/(x-bidstack-sentry-smoke-token:\s*)[^\s"'`,;]+/gi, '$1<redacted>')
    .replace(
      /\b((?:API_TOKEN|SENTRY_SMOKE_TOKEN|BIDSTACK_SENTRY_SMOKE_TOKEN|SENTRY_AUTH_TOKEN|CLERK_[A-Z0-9_]*TOKEN|DATABASE_URL|REDIS_URL)\s*[:=]\s*)[^\s"'`,;]+/gi,
      '$1<redacted>',
    )
    .replace(
      /\b((?:BIDSTACK_PROVIDER_QUALITY_API_TOKEN)\s*[:=]\s*)[^\s"'`,;]+/gi,
      '$1<redacted>',
    )
    .replace(/("token"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
    .replace(/("authorization"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2');
}

function tailAndRedact(text) {
  const redacted = redact(text);
  if (redacted.length <= MAX_CAPTURE_CHARS) return redacted;
  return `[truncated to last ${MAX_CAPTURE_CHARS} chars]\n${redacted.slice(-MAX_CAPTURE_CHARS)}`;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return null;
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isIsoTimestamp(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T/.test(normalized) && Number.isFinite(Date.parse(normalized));
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

function pickDispositionString(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function pickDispositionBoolean(source, names) {
  for (const name of names) {
    if (source?.[name] !== undefined && source?.[name] !== null && source?.[name] !== '') {
      return parseOptionalBoolean(source[name]);
    }
  }
  return null;
}

function pickDispositionInteger(source, names) {
  for (const name of names) {
    if (source?.[name] !== undefined && source?.[name] !== null && source?.[name] !== '') {
      return parseOptionalInteger(source[name]);
    }
  }
  return null;
}

function loadSecretDispositionPreflight(root, env) {
  const relativePath = String(env.BIDSTACK_SECRET_DISPOSITION_FILE || '').trim();
  if (!relativePath) return { configured: false };

  const absolutePath = path.resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    return { configured: true, passed: false, detail: `${relativePath} does not exist` };
  }

  try {
    const parsed = normalizeDispositionRecord(parseJsonFileAllowBom(absolutePath));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { configured: true, passed: false, detail: `${relativePath} must contain a JSON object` };
    }
    return {
      configured: true,
      passed: true,
      detail: `${relativePath} loaded`,
      values: {
        BIDSTACK_SECRET_FULL_HISTORY_REVIEWED: pickDispositionBoolean(parsed, [
          'fullHistoryReviewed',
          'fullHistoryGitleaksReviewed',
        ]),
        BIDSTACK_SECRET_FULL_HISTORY_CLEAN: pickDispositionBoolean(parsed, ['fullHistoryClean']),
        BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT: pickDispositionInteger(parsed, [
          'historicalFindingsCount',
          'fullHistoryFindings',
        ]),
        BIDSTACK_SECRET_HISTORICAL_ROTATED: pickDispositionBoolean(parsed, [
          'historicalFindingsRotatedOrRevoked',
          'rotatedHistoricalCredentials',
        ]),
        BIDSTACK_SECRET_OWNER_APPROVED: pickDispositionBoolean(parsed, [
          'ownerApprovedDisposition',
          'securityOwnerApprovedDisposition',
        ]),
        BIDSTACK_SECRET_OWNER_APPROVER: pickDispositionString(parsed, [
          'ownerApprover',
          'securityOwnerApprover',
          'securityOwner',
          'ownerApprovedBy',
        ]),
        BIDSTACK_SECRET_REVIEWER: pickDispositionString(parsed, ['reviewer', 'securityReviewer']),
        BIDSTACK_SECRET_OWNER_APPROVAL_TICKET: pickDispositionString(parsed, [
          'ownerApprovalTicket',
          'securityOwnerApprovalTicket',
          'approvalTicket',
          'ticket',
        ]),
        BIDSTACK_SECRET_OWNER_APPROVED_AT: pickDispositionString(parsed, [
          'ownerApprovedAt',
          'securityOwnerApprovedAt',
          'approvedAt',
        ]),
        BIDSTACK_SECRET_ROTATION_VERIFIED_AT: pickDispositionString(parsed, [
          'rotationVerifiedAt',
          'historicalFindingsRotatedAt',
          'rotatedAt',
        ]),
      },
    };
  } catch (error) {
    return { configured: true, passed: false, detail: `${relativePath} could not be parsed: ${error.message}` };
  }
}

function getPath(source, dottedPath) {
  return String(dottedPath)
    .split('.')
    .reduce((current, segment) => (current && typeof current === 'object' ? current[segment] : undefined), source);
}

function pickRecordString(source, names) {
  for (const name of names) {
    const value = getPath(source, name);
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function pickRecordBoolean(source, names) {
  for (const name of names) {
    const value = getPath(source, name);
    if (value !== undefined && value !== null && value !== '') {
      return parseOptionalBoolean(value);
    }
  }
  return null;
}

function pickRecordInteger(source, names) {
  for (const name of names) {
    const value = getPath(source, name);
    if (value !== undefined && value !== null && value !== '') {
      return parseOptionalInteger(value);
    }
  }
  return null;
}

function loadOperationalReadinessPreflight(root, env) {
  const relativePath = String(env.BIDSTACK_OPS_READINESS_FILE || '').trim();
  if (!relativePath) return { configured: false };

  const absolutePath = path.resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    return { configured: true, passed: false, detail: `${relativePath} does not exist` };
  }

  try {
    const parsed = parseJsonFileAllowBom(absolutePath);
    const source = parsed?.operationalReadiness ?? parsed;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { configured: true, passed: false, detail: `${relativePath} must contain a JSON object` };
    }
    return {
      configured: true,
      passed: true,
      detail: `${relativePath} loaded`,
      values: {
        BIDSTACK_OPS_ENV: pickRecordString(source, ['environment']),
        BIDSTACK_OPS_PLATFORM: pickRecordString(source, ['platform']),
        BIDSTACK_OPS_RELEASE_ID: pickRecordString(source, ['releaseId', 'release.id']),
        BIDSTACK_OPS_REVIEWER: pickRecordString(source, ['reviewer', 'review.reviewer']),
        BIDSTACK_OPS_APPROVER: pickRecordString(source, ['approver', 'approval.approver']),
        BIDSTACK_OPS_APPROVAL_TICKET: pickRecordString(source, [
          'approvalTicket',
          'approval.ticket',
          'approval.approvalTicket',
        ]),
        BIDSTACK_OPS_APPROVED_AT: pickRecordString(source, ['approvedAt', 'approval.approvedAt']),
        BIDSTACK_OPS_BICEP_BUILD_PASSED: pickRecordBoolean(source, [
          'infrastructure.bicepBuildPassed',
          'infra.bicepBuildPassed',
        ]),
        BIDSTACK_OPS_WHAT_IF_PASSED: pickRecordBoolean(source, [
          'infrastructure.whatIfPassed',
          'infra.whatIfPassed',
        ]),
        BIDSTACK_OPS_PRIVATE_NETWORKING_APPROVED: pickRecordBoolean(source, [
          'infrastructure.privateNetworkingApproved',
          'infra.privateNetworkingApproved',
        ]),
        BIDSTACK_OPS_STORAGE_VALIDATED: pickRecordBoolean(source, [
          'infrastructure.storageValidated',
          'infra.storageValidated',
        ]),
        BIDSTACK_OPS_MIGRATION_JOB_VALIDATED: pickRecordBoolean(source, [
          'database.migrationJobValidated',
          'migrations.jobValidated',
        ]),
        BIDSTACK_OPS_MIGRATION_DEPLOY_VALIDATED: pickRecordBoolean(source, [
          'database.migrationDeployValidated',
          'migrations.deployValidated',
        ]),
        BIDSTACK_OPS_BACKUP_CONFIGURED: pickRecordBoolean(source, [
          'database.backupConfigured',
          'backup.configured',
        ]),
        BIDSTACK_OPS_BACKUP_RETENTION_DAYS: pickRecordInteger(source, [
          'database.backupRetentionDays',
          'backup.retentionDays',
        ]),
        BIDSTACK_OPS_GEO_REDUNDANT_BACKUP: pickRecordBoolean(source, [
          'database.geoRedundantBackup',
          'backup.geoRedundant',
        ]),
        BIDSTACK_OPS_RESTORE_DRILL_AT: pickRecordString(source, [
          'database.restoreDrillAt',
          'backup.restoreDrillAt',
        ]),
        BIDSTACK_OPS_RESTORE_RTO_MINUTES: pickRecordInteger(source, [
          'database.restoreRtoMinutes',
          'backup.restoreRtoMinutes',
        ]),
        BIDSTACK_OPS_RESTORE_RPO_MINUTES: pickRecordInteger(source, [
          'database.restoreRpoMinutes',
          'backup.restoreRpoMinutes',
        ]),
        BIDSTACK_OPS_ROLLBACK_RUNBOOK_REVIEWED: pickRecordBoolean(source, [
          'rollback.runbookReviewed',
        ]),
        BIDSTACK_OPS_ROLLBACK_DRILL_AT: pickRecordString(source, [
          'rollback.rollbackDrillAt',
          'rollback.drillAt',
        ]),
        BIDSTACK_OPS_MONITORING_ALERTS_VALIDATED: pickRecordBoolean(source, [
          'monitoring.alertsValidated',
        ]),
        BIDSTACK_OPS_ONCALL_VALIDATED: pickRecordBoolean(source, [
          'monitoring.onCallValidated',
          'monitoring.oncallValidated',
        ]),
        ...Object.fromEntries(
          OPS_EVIDENCE_REF_ENV.map((definition) => [
            definition.env,
            pickRecordString(source, definition.paths),
          ]),
        ),
      },
    };
  } catch (error) {
    return { configured: true, passed: false, detail: `${relativePath} could not be parsed: ${error.message}` };
  }
}

function isLocalTarget(target) {
  try {
    const hostname = new URL(target).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname === 'host.docker.internal' ||
      hostname.endsWith('.local')
    );
  } catch {
    return true;
  }
}

const PLACEHOLDER_EXACT_VALUES = new Set([
  'abc123',
  'change-me',
  'changeme',
  'dummy',
  'fake',
  'ops-123',
  'ops-1234',
  'release-api-token',
  'release-token',
  'sec-123',
  'sec-1234',
  'super-secret',
  'super-secret-token',
  'ticket-123',
  'todo',
]);

const PLACEHOLDER_VALUE_PATTERNS = [
  /<[^>]+>/,
  /\bexample\b/,
  /\bplaceholder\b/,
  /\breplace[-_ ]?me\b/,
  /\bshort[-_ ]?lived[-_ ]?release[-_ ]?bearer[-_ ]?token\b/,
  /\brelease[-_ ]?smoke[-_ ]?token\b/,
  /\bsample\b/,
  /\byour[-_ ]/,
];

function hasPlaceholderSignal(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    PLACEHOLDER_EXACT_VALUES.has(normalized) ||
    PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function isPlaceholderUrl(target) {
  try {
    const hostname = new URL(target).hostname.toLowerCase();
    return (
      hostname === 'example.com' ||
      hostname.endsWith('.example') ||
      hostname.endsWith('.example.com') ||
      hostname.includes('example')
    );
  } catch {
    return false;
  }
}

function presentValue(env, names) {
  const name = names.find((candidate) => String(env[candidate] || '').trim().length > 0);
  return {
    name,
    value: name ? String(env[name]).trim() : '',
  };
}

function normalizeCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isImmutableImageRef(image) {
  return /@sha256:[0-9a-f]{64}$/i.test(String(image || '').trim());
}

function collectPreflight(deployEnv, env, root = process.cwd()) {
  const checks = [];
  const secretDisposition = loadSecretDispositionPreflight(root, env);
  const operationalReadiness = loadOperationalReadinessPreflight(root, env);
  const checkEnv = { ...env };
  if (secretDisposition.configured && secretDisposition.passed && secretDisposition.values) {
    for (const [key, value] of Object.entries(secretDisposition.values)) {
      if (value !== null && value !== undefined && String(value).trim()) {
        checkEnv[key] = String(value);
      }
    }
  }
  if (operationalReadiness.configured && operationalReadiness.passed && operationalReadiness.values) {
    for (const [key, value] of Object.entries(operationalReadiness.values)) {
      if (value !== null && value !== undefined && String(value).trim()) {
        checkEnv[key] = String(value);
      }
    }
  }

  function addCheck(check) {
    checks.push({
      required: true,
      ...check,
    });
  }

  function addAny(id, label, names, options = {}) {
    const found = presentValue(checkEnv, names);
    let passed = Boolean(found.name);
    let reason = found.name ? `${found.name} present` : `${names.join(' or ')} missing`;

    if (passed && options.minLength && found.value.length < options.minLength) {
      passed = false;
      reason = `${found.name} is shorter than ${options.minLength} characters`;
    }
    if (passed && options.nonLocalUrl) {
      try {
        const url = new URL(found.value);
        if (!['http:', 'https:'].includes(url.protocol)) {
          passed = false;
          reason = `${found.name} must be http(s)`;
        } else if (isLocalTarget(found.value)) {
          passed = false;
          reason = `${found.name} cannot target local infrastructure`;
        } else if (isPlaceholderUrl(found.value)) {
          passed = false;
          reason = `${found.name} cannot use example or placeholder infrastructure`;
        }
      } catch {
        passed = false;
        reason = `${found.name} is not an absolute URL`;
      }
    }
    if (passed && options.nonPlaceholder && hasPlaceholderSignal(found.value)) {
      passed = false;
      reason = `${found.name} looks like a placeholder value`;
    }
    if (passed && options.equals) {
      const actual = found.value.toLowerCase();
      if (actual !== options.equals) {
        passed = false;
        reason = `${found.name} must be ${options.equals}`;
      }
    }
    if (passed && options.isoTimestamp && !isIsoTimestamp(found.value)) {
      passed = false;
      reason = `${found.name} must be an ISO timestamp`;
    }

    addCheck({
      id,
      label,
      names,
      sensitive: options.sensitive === true,
      present: Boolean(found.name),
      source: found.name,
      value: options.sensitive || !found.name ? undefined : redact(found.value),
      passed,
      detail: reason,
    });
  }

  function addBoolean(id, label, names) {
    const found = presentValue(checkEnv, names);
    const passed = parseOptionalBoolean(found.value) === true;
    addCheck({
      id,
      label,
      names,
      present: Boolean(found.name),
      source: found.name,
      passed,
      detail: passed ? `${found.name} is true` : `${names.join(' or ')} must be true`,
    });
  }

  function addBooleanOrSecret(id, label, booleanNames, secretNames) {
    const booleanFound = presentValue(checkEnv, booleanNames);
    const secretFound = presentValue(checkEnv, secretNames);
    const passed = parseOptionalBoolean(booleanFound.value) === true || Boolean(secretFound.name);
    addCheck({
      id,
      label,
      names: [...booleanNames, ...secretNames],
      sensitive: Boolean(secretFound.name),
      present: Boolean(booleanFound.name || secretFound.name),
      source: booleanFound.name || secretFound.name,
      passed,
      detail: passed
        ? `${booleanFound.name || secretFound.name} present`
        : `${booleanNames.join(' or ')} must be true, or ${secretNames.join(' or ')} must be set`,
    });
  }

  function addBrowserProductionBuild() {
    const names = ['BIDSTACK_BROWSER_PRODUCTION_BUILD'];
    const found = presentValue(checkEnv, names);
    const normalized = found.value.toLowerCase();
    const passed = normalized === 'true' || normalized === '1';
    addCheck({
      id: 'browser.productionBuild',
      label: 'Browser regression is marked as a production build',
      names,
      present: Boolean(found.name),
      source: found.name,
      passed,
      detail: passed
        ? `${found.name} is ${normalized}`
        : 'BIDSTACK_BROWSER_PRODUCTION_BUILD must be true or 1',
    });
  }

  function addIntegerAtLeast(id, label, names, minimum) {
    const found = presentValue(checkEnv, names);
    const parsed = parseOptionalInteger(found.value);
    const passed = parsed !== null && parsed >= minimum;
    addCheck({
      id,
      label,
      names,
      present: Boolean(found.name),
      source: found.name,
      passed,
      detail: passed ? `${found.name}=${parsed}` : `${names.join(' or ')} must be >= ${minimum}`,
    });
  }

  function addIntegerAtMost(id, label, names, maximum) {
    const found = presentValue(checkEnv, names);
    const parsed = parseOptionalInteger(found.value);
    const passed = parsed !== null && parsed <= maximum;
    addCheck({
      id,
      label,
      names,
      present: Boolean(found.name),
      source: found.name,
      passed,
      detail: passed ? `${found.name}=${parsed}` : `${names.join(' or ')} must be <= ${maximum}`,
    });
  }

  addCheck({
    id: 'deploy.environment',
    label: 'Bundle target environment is release-scoped',
    names: ['BIDSTACK_DEPLOY_ENV'],
    present: true,
    source: 'BIDSTACK_DEPLOY_ENV',
    value: deployEnv,
    passed: deployEnv === 'staging' || deployEnv === 'production',
    detail: deployEnv,
  });

  const containerImageRefs = normalizeCsv(checkEnv.BIDSTACK_CONTAINER_SCAN_IMAGES);
  const mutableContainerImageRefs = containerImageRefs.filter((image) => !isImmutableImageRef(image));
  addCheck({
    id: 'container.images',
    label: 'Container scan uses immutable release image refs',
    names: ['BIDSTACK_CONTAINER_SCAN_IMAGES'],
    present: containerImageRefs.length > 0,
    source: containerImageRefs.length > 0 ? 'BIDSTACK_CONTAINER_SCAN_IMAGES' : undefined,
    passed: containerImageRefs.length > 0 && mutableContainerImageRefs.length === 0,
    detail:
      containerImageRefs.length === 0
        ? 'BIDSTACK_CONTAINER_SCAN_IMAGES missing'
        : mutableContainerImageRefs.length > 0
          ? `mutable refs: ${mutableContainerImageRefs.join(', ')}`
          : `${containerImageRefs.length} immutable image ref(s)`,
  });

  addAny('load.apiBaseUrl', 'Load evidence has a non-local API target', ['K6_DOCKER_API_BASE_URL', 'API_BASE_URL'], { nonLocalUrl: true });
  addAny('load.apiToken', 'Load evidence has an authenticated API token', ['API_TOKEN'], {
    sensitive: true,
    minLength: 24,
    nonPlaceholder: true,
  });

  if (secretDisposition.configured) {
    addCheck({
      id: 'secrets.dispositionFile',
      label: 'Secret disposition file is readable',
      names: ['BIDSTACK_SECRET_DISPOSITION_FILE'],
      present: true,
      source: 'BIDSTACK_SECRET_DISPOSITION_FILE',
      value: redact(String(env.BIDSTACK_SECRET_DISPOSITION_FILE || '')),
      passed: secretDisposition.passed === true,
      detail: secretDisposition.detail,
    });
  }

  if (operationalReadiness.configured) {
    addCheck({
      id: 'ops.readinessFile',
      label: 'Operational readiness file is readable',
      names: ['BIDSTACK_OPS_READINESS_FILE'],
      present: true,
      source: 'BIDSTACK_OPS_READINESS_FILE',
      value: redact(String(env.BIDSTACK_OPS_READINESS_FILE || '')),
      passed: operationalReadiness.passed === true,
      detail: operationalReadiness.detail,
    });
  }

  addAny('ops.releaseId', 'Operational readiness has a release id', ['BIDSTACK_OPS_RELEASE_ID'], {
    nonPlaceholder: true,
  });
  addAny('ops.reviewer', 'Operational readiness has a reviewer', ['BIDSTACK_OPS_REVIEWER'], {
    nonPlaceholder: true,
  });
  addAny('ops.approver', 'Operational readiness has an approver', ['BIDSTACK_OPS_APPROVER'], {
    nonPlaceholder: true,
  });
  addAny('ops.approvalTicket', 'Operational readiness has an approval ticket', ['BIDSTACK_OPS_APPROVAL_TICKET'], {
    nonPlaceholder: true,
  });
  addAny('ops.approvedAt', 'Operational approval has an ISO timestamp', ['BIDSTACK_OPS_APPROVED_AT'], {
    isoTimestamp: true,
  });
  addBoolean('ops.bicepBuild', 'Azure/Bicep build is validated', ['BIDSTACK_OPS_BICEP_BUILD_PASSED']);
  addBoolean('ops.whatIf', 'Azure what-if/plan is validated', ['BIDSTACK_OPS_WHAT_IF_PASSED']);
  addBoolean('ops.privateNetworking', 'Private networking posture is approved', ['BIDSTACK_OPS_PRIVATE_NETWORKING_APPROVED']);
  addBoolean('ops.storage', 'Object storage driver is validated', ['BIDSTACK_OPS_STORAGE_VALIDATED']);
  addBoolean('ops.migrationJob', 'Migration job is validated', ['BIDSTACK_OPS_MIGRATION_JOB_VALIDATED']);
  addBoolean('ops.migrationDeploy', 'Migration deploy path is validated', ['BIDSTACK_OPS_MIGRATION_DEPLOY_VALIDATED']);
  addBoolean('ops.backupConfigured', 'Database backups are configured', ['BIDSTACK_OPS_BACKUP_CONFIGURED']);
  addIntegerAtLeast('ops.backupRetention', 'Database backup retention is release-grade', ['BIDSTACK_OPS_BACKUP_RETENTION_DAYS'], 30);
  addBoolean('ops.geoBackup', 'Geo-redundant backup is enabled or approved', ['BIDSTACK_OPS_GEO_REDUNDANT_BACKUP']);
  addAny('ops.restoreDrillAt', 'Restore drill has an ISO timestamp', ['BIDSTACK_OPS_RESTORE_DRILL_AT'], {
    isoTimestamp: true,
  });
  addIntegerAtMost('ops.restoreRto', 'Restore RTO is within release threshold', ['BIDSTACK_OPS_RESTORE_RTO_MINUTES'], 240);
  addIntegerAtMost('ops.restoreRpo', 'Restore RPO is within release threshold', ['BIDSTACK_OPS_RESTORE_RPO_MINUTES'], 60);
  addBoolean('ops.rollbackRunbook', 'Rollback runbook is reviewed', ['BIDSTACK_OPS_ROLLBACK_RUNBOOK_REVIEWED']);
  addAny('ops.rollbackDrillAt', 'Rollback drill has an ISO timestamp', ['BIDSTACK_OPS_ROLLBACK_DRILL_AT'], {
    isoTimestamp: true,
  });
  addBoolean('ops.monitoringAlerts', 'Monitoring alerts are validated', ['BIDSTACK_OPS_MONITORING_ALERTS_VALIDATED']);
  addBoolean('ops.onCall', 'On-call escalation is validated', ['BIDSTACK_OPS_ONCALL_VALIDATED']);
  for (const check of OPS_EVIDENCE_REF_ENV) {
    addAny(check.id, check.label, [check.env], { nonPlaceholder: true });
  }

  addAny(
    'providers.apiBaseUrl',
    'Provider quality has a non-local API target',
    ['BIDSTACK_PROVIDER_QUALITY_TARGET', 'BIDSTACK_PROVIDER_API_BASE_URL', 'API_BASE_URL'],
    { nonLocalUrl: true },
  );
  addAny(
    'providers.apiToken',
    'Provider quality has an API token',
    ['BIDSTACK_PROVIDER_QUALITY_API_TOKEN', 'API_TOKEN'],
    { sensitive: true, minLength: 24, nonPlaceholder: true },
  );
  addAny(
    'providers.companyKey',
    'Provider quality has a release company key',
    ['BIDSTACK_PROVIDER_QUALITY_COMPANY_KEY'],
    { nonPlaceholder: true },
  );
  addAny(
    'providers.techIntelSources',
    'Provider quality names required Tech Intel MCP sources',
    ['BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES', 'BIDSTACK_DEPLOY_REQUIRED_TECH_INTEL_SOURCES'],
    { nonPlaceholder: true },
  );

  addBoolean('secrets.fullHistoryReviewed', 'Secret history review is explicitly confirmed', ['BIDSTACK_SECRET_FULL_HISTORY_REVIEWED']);
  const historyClean = parseOptionalBoolean(checkEnv.BIDSTACK_SECRET_FULL_HISTORY_CLEAN) === true;
  const findingsCount = Number(checkEnv.BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT);
  const hasFindingsCount =
    String(checkEnv.BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT || '').trim() !== '' && Number.isFinite(findingsCount);
  addCheck({
    id: 'secrets.historyDispositionKnown',
    label: 'Secret history disposition has clean/count evidence',
    names: ['BIDSTACK_SECRET_FULL_HISTORY_CLEAN', 'BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT'],
    present: historyClean || hasFindingsCount,
    source: historyClean ? 'BIDSTACK_SECRET_FULL_HISTORY_CLEAN' : hasFindingsCount ? 'BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT' : undefined,
    passed: historyClean || hasFindingsCount,
    detail: historyClean ? 'full history clean' : hasFindingsCount ? `historical findings count=${findingsCount}` : 'missing clean flag or finding count',
  });
  if (!historyClean && (!hasFindingsCount || findingsCount > 0)) {
    addBoolean('secrets.historicalRotated', 'Historical secret findings are rotated or revoked', ['BIDSTACK_SECRET_HISTORICAL_ROTATED']);
    addBoolean('secrets.ownerApproved', 'Security owner approved the secret disposition', ['BIDSTACK_SECRET_OWNER_APPROVED']);
    addAny('secrets.ownerApprover', 'Secret disposition has a named owner approver', [
      'BIDSTACK_SECRET_OWNER_APPROVER',
      'BIDSTACK_SECRET_SECURITY_OWNER',
    ], { nonPlaceholder: true });
    addAny(
      'secrets.ownerApprovalTicket',
      'Secret disposition has an owner approval ticket',
      ['BIDSTACK_SECRET_OWNER_APPROVAL_TICKET'],
      { nonPlaceholder: true },
    );
    addAny('secrets.ownerApprovedAt', 'Secret owner approval has an ISO timestamp', ['BIDSTACK_SECRET_OWNER_APPROVED_AT'], {
      isoTimestamp: true,
    });
    addAny(
      'secrets.rotationVerifiedAt',
      'Historical secret rotation has an ISO timestamp',
      ['BIDSTACK_SECRET_ROTATION_VERIFIED_AT'],
      { isoTimestamp: true },
    );
  }
  addAny('secrets.reviewer', 'Secret disposition has a named reviewer', ['BIDSTACK_SECRET_REVIEWER'], {
    nonPlaceholder: true,
  });

  addAny('sentry.apiBaseUrl', 'Sentry smoke trigger has a non-local API target', ['BIDSTACK_SENTRY_API_BASE_URL', 'API_BASE_URL'], { nonLocalUrl: true });
  addAny('sentry.smokeToken', 'Sentry smoke trigger has a release token', ['BIDSTACK_SENTRY_SMOKE_TOKEN', 'SENTRY_SMOKE_TOKEN'], {
    sensitive: true,
    minLength: 24,
    nonPlaceholder: true,
  });
  addAny('sentry.authToken', 'Sentry CLI has an auth token for issue verification', ['BIDSTACK_SENTRY_AUTH_TOKEN', 'SENTRY_AUTH_TOKEN'], {
    sensitive: true,
    minLength: 24,
    nonPlaceholder: true,
  });
  addAny('sentry.release', 'Sentry smoke is tied to a release', ['BIDSTACK_SENTRY_RELEASE', 'SENTRY_RELEASE', 'VITE_SENTRY_RELEASE'], {
    nonPlaceholder: true,
  });
  addAny('sentry.environment', 'Sentry smoke environment matches the bundle target', ['BIDSTACK_DEPLOY_ENV', 'SENTRY_ENVIRONMENT'], { equals: deployEnv });
  addAny('sentry.org', 'Sentry organization is configured', ['BIDSTACK_SENTRY_ORG', 'SENTRY_ORG'], {
    nonPlaceholder: true,
  });
  addAny('sentry.apiProject', 'Sentry API project is configured', ['BIDSTACK_SENTRY_API_PROJECT'], {
    nonPlaceholder: true,
  });
  addAny('sentry.workerProject', 'Sentry worker project is configured', ['BIDSTACK_SENTRY_WORKER_PROJECT'], {
    nonPlaceholder: true,
  });
  addBooleanOrSecret(
    'sentry.dsnConfigured',
    'Sentry DSN configuration is proven',
    ['BIDSTACK_SENTRY_DSN_CONFIGURED'],
    ['SENTRY_DSN', 'VITE_SENTRY_DSN'],
  );

  addAny('browser.target', 'Browser regression has a non-local web target', ['BIDSTACK_BROWSER_REGRESSION_TARGET', 'E2E_BASE_URL', 'PUBLIC_BASE_URL'], { nonLocalUrl: true });
  addAny('browser.authMode', 'Browser regression uses Clerk-backed auth', ['BIDSTACK_BROWSER_AUTH_MODE', 'E2E_AUTH_MODE', 'VITE_AUTH_MODE'], { equals: 'clerk' });
  addBrowserProductionBuild();

  const blocking = checks.filter((check) => check.required && check.passed !== true);
  return {
    checks,
    blockingFailures: blocking.map((check) => check.id),
  };
}

function buildArtifact(options, preflight, steps, startedAt, completedAt) {
  const blockingFailures = [];
  const hasPreflightBlockers = preflight.blockingFailures.length > 0;

  for (const id of preflight.blockingFailures) {
    blockingFailures.push(`preflight.${id}`);
  }

  if (options.preflightOnly) {
    // Preflight is an operator-readiness artifact, not release approval.
    // It passes when the release environment inputs are complete, then the
    // normal evidence commands still have to run.
  } else if (options.dryRun) {
    blockingFailures.push('bundle.dry_run');
  } else {
    for (const step of steps) {
      if (!step.required) continue;
      if (step.skipped) {
        if (hasPreflightBlockers && step.skipReason === 'preflight blockers') {
          continue;
        }
        blockingFailures.push(`${step.id}.skipped`);
      } else if (step.passed !== true) {
        blockingFailures.push(`${step.id}.failed`);
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: completedAt.toISOString(),
    runner: 'deploy-evidence-bundle',
    deployEnv: options.deployEnv,
    dryRun: options.dryRun,
    preflightOnly: options.preflightOnly,
    continueOnError: options.continueOnError,
    root: options.root,
    commandCount: steps.length,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    passed: blockingFailures.length === 0,
    blockingFailures,
    preflightBlockers: preflight.blockingFailures,
    environmentChecks: preflight.checks,
    steps,
  };
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = path.resolve(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function dryRunStep(step) {
  return {
    ...step,
    planned: true,
    skipped: true,
    skipReason: 'dry-run',
  };
}

function preflightStep(step) {
  return {
    ...step,
    planned: true,
    skipped: true,
    skipReason: 'preflight-only',
  };
}

function skippedStep(step, reason) {
  return {
    ...step,
    skipped: true,
    skipReason: reason,
    passed: false,
  };
}

function preflightDiagnosticStep(step) {
  if (!step.preflightDiagnosticScript) return null;
  return {
    ...step,
    ...commandFieldsForScript(step.preflightDiagnosticScript),
    script: step.preflightDiagnosticScript,
    originalScript: step.script,
    diagnostic: true,
    preflightDiagnostic: true,
    skipReason: 'preflight diagnostic',
  };
}

function runBundle(options) {
  const startedAt = new Date();
  const plan = buildCommandPlan(options.deployEnv);
  const childEnv = {
    ...process.env,
    BIDSTACK_DEPLOY_ENV: options.deployEnv,
  };
  const preflight = collectPreflight(options.deployEnv, childEnv, options.root);
  const steps = [];
  const preflightBlocked = preflight.blockingFailures.length > 0;
  let stopGenerationSteps = false;
  let failedStepId = '';

  for (const step of plan) {
    if (options.preflightOnly) {
      steps.push(preflightStep(step));
      continue;
    }

    if (options.dryRun) {
      steps.push(dryRunStep(step));
      continue;
    }

    if (preflightBlocked && !options.continueOnError) {
      const diagnostic = preflightDiagnosticStep(step);
      if (diagnostic) {
        const stepEnv = diagnostic.env ? { ...childEnv, ...diagnostic.env } : childEnv;
        const result = runPnpm(options.root, diagnostic.args, {
          env: stepEnv,
          timeoutMs: options.timeoutMs,
        });
        steps.push({
          ...diagnostic,
          ...result,
        });
      } else {
        steps.push(skippedStep(step, 'preflight blockers'));
      }
      continue;
    }

    const canRunAfterFailure =
      step.runAfterFailedStepId && step.runAfterFailedStepId === failedStepId;
    if (
      stopGenerationSteps &&
      !step.finalVerifier &&
      !options.continueOnError &&
      !canRunAfterFailure
    ) {
      steps.push(skippedStep(step, 'previous evidence command failed'));
      continue;
    }

    const stepEnv = step.env ? { ...childEnv, ...step.env } : childEnv;
    const result = runPnpm(options.root, step.args, {
      env: stepEnv,
      timeoutMs: options.timeoutMs,
    });
    steps.push({
      ...step,
      ...result,
    });

    if (!step.finalVerifier && !result.passed) {
      stopGenerationSteps = true;
      failedStepId = step.id;
    }
  }

  const completedAt = new Date();
  const artifact = buildArtifact(options, preflight, steps, startedAt, completedAt);
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);
  printBundleSummary(options, artifact, absolutePath);
  return options.dryRun ? 0 : artifact.passed ? 0 : 1;
}

function printBundleSummary(options, artifact, absolutePath) {
  process.stdout.write('BidStack release evidence bundle\n');
  process.stdout.write(`Environment: ${artifact.deployEnv}\n`);
  process.stdout.write(
    `Mode: ${options.preflightOnly ? 'preflight' : options.dryRun ? 'dry-run' : 'execute'}\n`,
  );
  process.stdout.write(`Artifact: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Preflight blockers: ${artifact.preflightBlockers.length}\n\n`);

  for (const step of artifact.steps) {
    const prefix = step.skipped ? 'SKIP' : step.passed ? 'PASS' : 'FAIL';
    const detail = step.skipReason ? ` - ${step.skipReason}` : step.exitCode !== undefined ? ` - exit=${step.exitCode}` : '';
    process.stdout.write(`${prefix} ${step.label}${detail}\n`);
  }

  process.stdout.write(`\nBlocking failures: ${artifact.blockingFailures.length}\n`);
  if (artifact.blockingFailures.length > 0) {
    process.stdout.write(`${artifact.blockingFailures.join('\n')}\n`);
  }
  if (artifact.passed) {
    if (options.preflightOnly) {
      process.stdout.write(
        '\nRELEASE PREFLIGHT PASSED\nEvidence commands still need to run before deploy approval.\n',
      );
    } else {
      process.stdout.write('\nRELEASE EVIDENCE BUNDLE PASSED\n');
    }
  } else if (options.dryRun) {
    process.stdout.write('\nDry run wrote the command plan; release evidence remains blocked until execution passes.\n');
  } else if (options.preflightOnly) {
    process.stderr.write('\nRELEASE PREFLIGHT BLOCKED\n');
  } else {
    process.stderr.write('\nRELEASE EVIDENCE BUNDLE BLOCKED\n');
  }
}

function runSelftest() {
  assert.equal(normalizeEnvironment('prod'), 'production');
  assert.equal(normalizeEnvironment('stage'), 'staging');
  assert.throws(() => normalizeEnvironment('dev'), /only supports staging or production/);
  assert.throws(
    () => parseArgs(['--dry-run', '--preflight-only']),
    /mutually exclusive/,
  );

  const productionPlan = buildCommandPlan('production');
  assert.equal(productionPlan.at(-1).script, 'deploy:evidence:production');
  assert.equal(productionPlan.at(-1).finalVerifier, true);
  assert.equal(
    productionPlan[0].env.BIDSTACK_TOOL_READINESS_EXECUTE_IMAGE_PROBES,
    'true',
  );
  assert.equal(productionPlan[2].script, 'deploy:evidence:source:plan:write');
  assert.equal(productionPlan[2].diagnostic, true);
  assert.equal(productionPlan[2].runAfterFailedStepId, 'source');
  const providersStep = productionPlan.find((step) => step.id === 'providers');
  assert.equal(providersStep.preflightDiagnosticScript, 'deploy:evidence:providers');
  const providersDiagnostic = preflightDiagnosticStep(providersStep);
  assert.equal(providersDiagnostic.script, 'deploy:evidence:providers');
  assert.equal(providersDiagnostic.originalScript, 'deploy:evidence:providers');
  assert.equal(providersDiagnostic.command, 'pnpm run deploy:evidence:providers');
  assert.equal(providersDiagnostic.preflightDiagnostic, true);
  const loadStep = productionPlan.find((step) => step.id === 'load');
  assert.equal(loadStep.preflightDiagnosticScript, 'deploy:evidence:load');
  const loadDiagnostic = preflightDiagnosticStep(loadStep);
  assert.equal(loadDiagnostic.script, 'deploy:evidence:load');
  assert.equal(loadDiagnostic.originalScript, 'deploy:evidence:load');
  assert.equal(loadDiagnostic.command, 'pnpm run deploy:evidence:load');
  assert.equal(loadDiagnostic.preflightDiagnostic, true);
  const browserStep = productionPlan.find((step) => step.id === 'browser');
  assert.equal(browserStep.preflightDiagnosticScript, 'deploy:evidence:browser:write');
  const browserDiagnostic = preflightDiagnosticStep(browserStep);
  assert.equal(browserDiagnostic.script, 'deploy:evidence:browser:write');
  assert.equal(browserDiagnostic.originalScript, 'deploy:evidence:browser');
  assert.equal(browserDiagnostic.command, 'pnpm run deploy:evidence:browser:write');
  assert.equal(browserDiagnostic.preflightDiagnostic, true);
  assert.equal(productionPlan.every((step) => step.command.startsWith('pnpm run ')), true);

  const completeEnv = {
    BIDSTACK_DEPLOY_ENV: 'production',
    BIDSTACK_CONTAINER_SCAN_IMAGES:
      'registry.example.com/bidcrm-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,' +
      'registry.example.com/bidcrm-web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,' +
      'registry.example.com/bidcrm-worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    API_BASE_URL: 'https://api.release.bidstack360.com',
    API_TOKEN: 'release_live_1234567890abcdef',
    BIDSTACK_OPS_RELEASE_ID: 'release-2026-06-18-c038c5d9',
    BIDSTACK_OPS_REVIEWER: 'release-ops@bidstack360.com',
    BIDSTACK_OPS_APPROVER: 'platform-owner@bidstack360.com',
    BIDSTACK_OPS_APPROVAL_TICKET: 'MANTU-OPS-92741',
    BIDSTACK_OPS_APPROVED_AT: '2026-06-18T10:00:00.000Z',
    BIDSTACK_OPS_BICEP_BUILD_PASSED: 'true',
    BIDSTACK_OPS_WHAT_IF_PASSED: 'true',
    BIDSTACK_OPS_PRIVATE_NETWORKING_APPROVED: 'true',
    BIDSTACK_OPS_STORAGE_VALIDATED: 'true',
    BIDSTACK_OPS_MIGRATION_JOB_VALIDATED: 'true',
    BIDSTACK_OPS_MIGRATION_DEPLOY_VALIDATED: 'true',
    BIDSTACK_OPS_BACKUP_CONFIGURED: 'true',
    BIDSTACK_OPS_BACKUP_RETENTION_DAYS: '35',
    BIDSTACK_OPS_GEO_REDUNDANT_BACKUP: 'true',
    BIDSTACK_OPS_RESTORE_DRILL_AT: '2026-06-18T11:00:00.000Z',
    BIDSTACK_OPS_RESTORE_RTO_MINUTES: '120',
    BIDSTACK_OPS_RESTORE_RPO_MINUTES: '15',
    BIDSTACK_OPS_ROLLBACK_RUNBOOK_REVIEWED: 'true',
    BIDSTACK_OPS_ROLLBACK_DRILL_AT: '2026-06-18T12:00:00.000Z',
    BIDSTACK_OPS_MONITORING_ALERTS_VALIDATED: 'true',
    BIDSTACK_OPS_ONCALL_VALIDATED: 'true',
    BIDSTACK_OPS_EVIDENCE_APPROVAL: 'MANTU-OPS-92741 approval record',
    BIDSTACK_OPS_EVIDENCE_BICEP_BUILD: 'az://deployment/build/release-2026-06-18-c038c5d9',
    BIDSTACK_OPS_EVIDENCE_WHAT_IF: 'az://deployment/what-if/release-2026-06-18-c038c5d9',
    BIDSTACK_OPS_EVIDENCE_PRIVATE_NETWORKING: 'docs://ops/private-networking/review-2026-06-18',
    BIDSTACK_OPS_EVIDENCE_STORAGE: 'docs://ops/storage-driver/validation-2026-06-18',
    BIDSTACK_OPS_EVIDENCE_MIGRATION_JOB: 'az://jobs/migration/release-2026-06-18-c038c5d9',
    BIDSTACK_OPS_EVIDENCE_MIGRATION_DEPLOY: 'az://db/migration/deploy/release-2026-06-18-c038c5d9',
    BIDSTACK_OPS_EVIDENCE_BACKUP_CONFIG: 'az://postgres/backups/policy-35d-geo',
    BIDSTACK_OPS_EVIDENCE_RESTORE_DRILL: 'az://postgres/restore-drill/2026-06-18T11:00:00.000Z',
    BIDSTACK_OPS_EVIDENCE_ROLLBACK_RUNBOOK: 'docs://runbooks/rollback/review-2026-06-18',
    BIDSTACK_OPS_EVIDENCE_ROLLBACK_DRILL: 'docs://runbooks/rollback/drill-2026-06-18T12:00:00.000Z',
    BIDSTACK_OPS_EVIDENCE_MONITORING_ALERTS: 'sentry://alerts/release-2026-06-18-c038c5d9',
    BIDSTACK_OPS_EVIDENCE_ONCALL: 'pagerduty://service/bidstack/release-2026-06-18',
    BIDSTACK_PROVIDER_QUALITY_COMPANY_KEY: 'mantu-global-finance',
    BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES: 'BuiltWith MCP,Wappalyzer MCP',
    BIDSTACK_SECRET_FULL_HISTORY_REVIEWED: 'true',
    BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT: '2',
    BIDSTACK_SECRET_HISTORICAL_ROTATED: 'true',
    BIDSTACK_SECRET_OWNER_APPROVED: 'true',
    BIDSTACK_SECRET_OWNER_APPROVER: 'security-owner@bidstack360.com',
    BIDSTACK_SECRET_OWNER_APPROVAL_TICKET: 'MANTU-SEC-92741',
    BIDSTACK_SECRET_OWNER_APPROVED_AT: '2026-06-18T10:00:00.000Z',
    BIDSTACK_SECRET_ROTATION_VERIFIED_AT: '2026-06-18T09:30:00.000Z',
    BIDSTACK_SECRET_REVIEWER: 'release-security@bidstack360.com',
    SENTRY_SMOKE_TOKEN: '123456789012345678901234',
    SENTRY_AUTH_TOKEN: 'sentry_ci_auth_1234567890abcdef',
    SENTRY_RELEASE: 'bidstack@0.1.0+c038c5d9',
    BIDSTACK_SENTRY_ORG: 'bidstack',
    BIDSTACK_SENTRY_API_PROJECT: 'bidstack-api',
    BIDSTACK_SENTRY_WORKER_PROJECT: 'bidstack-worker',
    BIDSTACK_SENTRY_DSN_CONFIGURED: 'true',
    E2E_BASE_URL: 'https://app.release.bidstack360.com',
    E2E_AUTH_MODE: 'clerk',
    BIDSTACK_BROWSER_PRODUCTION_BUILD: 'true',
  };
  const cleanPreflight = collectPreflight('production', completeEnv);
  assert.deepEqual(cleanPreflight.blockingFailures, []);

  const mutableContainerPreflight = collectPreflight('production', {
    ...completeEnv,
    BIDSTACK_CONTAINER_SCAN_IMAGES: 'bidcrm-api:release,bidcrm-web:release',
  });
  assert.equal(
    mutableContainerPreflight.blockingFailures.includes('container.images'),
    true,
    'expected mutable container image refs to block release preflight',
  );

  const placeholderPreflight = collectPreflight('staging', {
    BIDSTACK_DEPLOY_ENV: 'staging',
    API_BASE_URL: 'https://staging-api.bidstack.example',
    API_TOKEN: 'release-api-token',
    BIDSTACK_OPS_RELEASE_ID: '<release-id>',
    BIDSTACK_OPS_REVIEWER: 'release-ops@example.com',
    BIDSTACK_OPS_APPROVER: 'platform-owner@example.com',
    BIDSTACK_OPS_APPROVAL_TICKET: 'OPS-1234',
    BIDSTACK_OPS_APPROVED_AT: 'not-a-date',
    BIDSTACK_PROVIDER_QUALITY_COMPANY_KEY: '<company-key-with-live-provider-data>',
    BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES: '<builtwith-mcp,wappalyzer-mcp>',
    BIDSTACK_SECRET_FULL_HISTORY_REVIEWED: 'true',
    BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT: '2',
    BIDSTACK_SECRET_HISTORICAL_ROTATED: 'true',
    BIDSTACK_SECRET_OWNER_APPROVED: 'true',
    BIDSTACK_SECRET_OWNER_APPROVER: 'security-owner@example.com',
    BIDSTACK_SECRET_OWNER_APPROVAL_TICKET: 'SEC-123',
    BIDSTACK_SECRET_OWNER_APPROVED_AT: '2026-06-18T10:00:00.000Z',
    BIDSTACK_SECRET_ROTATION_VERIFIED_AT: '2026-06-18T09:30:00.000Z',
    BIDSTACK_SECRET_REVIEWER: 'release-security@example.com',
    SENTRY_SMOKE_TOKEN: '<release-smoke-token-at-least-24-chars>',
    SENTRY_AUTH_TOKEN: '<sentry-auth-token>',
    SENTRY_RELEASE: 'bidstack@0.1.0+<git-sha>',
    BIDSTACK_SENTRY_ORG: '<sentry-org-slug>',
    BIDSTACK_SENTRY_API_PROJECT: 'bidstack-api',
    BIDSTACK_SENTRY_WORKER_PROJECT: 'bidstack-worker',
    BIDSTACK_SENTRY_DSN_CONFIGURED: 'true',
    E2E_BASE_URL: 'https://staging.bidstack.example',
    E2E_AUTH_MODE: 'clerk',
    BIDSTACK_BROWSER_PRODUCTION_BUILD: 'true',
  });
  assert.equal(placeholderPreflight.blockingFailures.includes('load.apiBaseUrl'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('load.apiToken'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('container.images'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('ops.releaseId'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('ops.approvalTicket'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('ops.bicepBuild'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('ops.evidence.approval'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('providers.companyKey'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('providers.techIntelSources'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('secrets.ownerApprover'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('secrets.ownerApprovalTicket'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('secrets.reviewer'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('sentry.smokeToken'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('sentry.authToken'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('sentry.release'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('sentry.org'), true);
  assert.equal(placeholderPreflight.blockingFailures.includes('browser.target'), true);

  const dispositionRoot = mkdtempSync(path.join(tmpdir(), 'bidcrm-bundle-disposition-'));
  try {
    const dispositionPath = path.join(dispositionRoot, 'secret-history-disposition.json');
    writeFileSync(
      dispositionPath,
      `\uFEFF${JSON.stringify(
        {
          fullHistoryReviewed: true,
          historicalFindingsCount: 11,
          historicalFindingsRotatedOrRevoked: true,
          ownerApprovedDisposition: true,
          ownerApprover: 'security-owner@bidstack360.com',
          ownerApprovalTicket: 'MANTU-SEC-45678',
          ownerApprovedAt: '2026-06-18T10:00:00.000Z',
          rotationVerifiedAt: '2026-06-18T09:30:00.000Z',
          reviewer: 'release-security@bidstack360.com',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const fileDispositionPreflight = collectPreflight(
      'production',
      {
        ...completeEnv,
        BIDSTACK_SECRET_DISPOSITION_FILE: dispositionPath,
        BIDSTACK_SECRET_FULL_HISTORY_REVIEWED: '',
        BIDSTACK_SECRET_HISTORICAL_FINDINGS_COUNT: '',
        BIDSTACK_SECRET_HISTORICAL_ROTATED: '',
        BIDSTACK_SECRET_OWNER_APPROVED: '',
        BIDSTACK_SECRET_OWNER_APPROVER: '',
        BIDSTACK_SECRET_REVIEWER: '',
        BIDSTACK_SECRET_OWNER_APPROVAL_TICKET: '',
        BIDSTACK_SECRET_OWNER_APPROVED_AT: '',
        BIDSTACK_SECRET_ROTATION_VERIFIED_AT: '',
      },
      dispositionRoot,
    );
    assert.deepEqual(fileDispositionPreflight.blockingFailures, []);
  } finally {
    rmSync(dispositionRoot, { recursive: true, force: true });
  }

  const blockedPreflight = collectPreflight('production', {
    BIDSTACK_DEPLOY_ENV: 'production',
    API_BASE_URL: 'http://127.0.0.1:4000',
  });
  assert.equal(blockedPreflight.blockingFailures.includes('load.apiBaseUrl'), true);
  assert.equal(blockedPreflight.blockingFailures.includes('sentry.smokeToken'), true);

  const now = new Date('2026-06-18T12:00:00.000Z');
  const allPassed = buildArtifact(
    {
      deployEnv: 'production',
      dryRun: false,
      continueOnError: false,
      root: 'D:\\BIDCRM',
    },
    { checks: [], blockingFailures: [] },
    productionPlan.map((step) => ({ ...step, passed: true, exitCode: 0 })),
    now,
    now,
  );
  assert.equal(allPassed.passed, true);
  assert.deepEqual(allPassed.blockingFailures, []);

  const failed = buildArtifact(
    {
      deployEnv: 'production',
      dryRun: false,
      continueOnError: false,
      root: 'D:\\BIDCRM',
    },
    { checks: [], blockingFailures: ['load.apiBaseUrl'] },
    [
      { ...productionPlan[0], passed: false, exitCode: 1 },
      { ...productionPlan[1], skipped: true, passed: false },
      { ...productionPlan[2], skipped: true, passed: false },
      { ...productionPlan[3], skipped: true, passed: false },
      { ...productionPlan[4], skipped: true, passed: false },
      { ...productionPlan.at(-1), passed: false, exitCode: 1 },
    ],
    now,
    now,
  );
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.blockingFailures, [
    'preflight.load.apiBaseUrl',
    'tools.failed',
    'source.skipped',
    'sourcePlan.skipped',
    'ops.skipped',
    'providers.skipped',
    'verify.failed',
  ]);

  const sourceFailedPlanWritten = buildArtifact(
    {
      deployEnv: 'production',
      dryRun: false,
      continueOnError: false,
      root: 'D:\\BIDCRM',
    },
    { checks: [], blockingFailures: [] },
    [
      { ...productionPlan[0], passed: true, exitCode: 0 },
      { ...productionPlan[1], passed: false, exitCode: 1 },
      { ...productionPlan[2], passed: true, exitCode: 0 },
      { ...productionPlan[3], skipped: true, passed: false },
      { ...productionPlan.at(-1), passed: false, exitCode: 1 },
    ],
    now,
    now,
  );
  assert.deepEqual(sourceFailedPlanWritten.blockingFailures, [
    'source.failed',
    'ops.skipped',
    'verify.failed',
  ]);

  const preflightFailedFast = buildArtifact(
    {
      deployEnv: 'production',
      dryRun: false,
      continueOnError: false,
      root: 'D:\\BIDCRM',
    },
    { checks: [], blockingFailures: ['load.apiBaseUrl', 'sentry.smokeToken'] },
    buildCommandPlan('production').map((step) => skippedStep(step, 'preflight blockers')),
    now,
    now,
  );
  assert.equal(preflightFailedFast.passed, false);
  assert.deepEqual(preflightFailedFast.blockingFailures, [
    'preflight.load.apiBaseUrl',
    'preflight.sentry.smokeToken',
  ]);
  assert.equal(
    preflightFailedFast.steps.every((step) => step.skipReason === 'preflight blockers'),
    true,
  );

  const dryRun = buildArtifact(
    {
      deployEnv: 'staging',
      dryRun: true,
      continueOnError: false,
      root: 'D:\\BIDCRM',
    },
    { checks: [], blockingFailures: [] },
    buildCommandPlan('staging').map(dryRunStep),
    now,
    now,
  );
  assert.equal(dryRun.passed, false);
  assert.deepEqual(dryRun.blockingFailures, ['bundle.dry_run']);

  const preflightOnly = buildArtifact(
    {
      deployEnv: 'staging',
      dryRun: false,
      preflightOnly: true,
      continueOnError: false,
      root: 'D:\\BIDCRM',
    },
    { checks: [], blockingFailures: [] },
    buildCommandPlan('staging').map(preflightStep),
    now,
    now,
  );
  assert.equal(preflightOnly.passed, true);
  assert.deepEqual(preflightOnly.blockingFailures, []);
  assert.equal(preflightOnly.steps.every((step) => step.skipReason === 'preflight-only'), true);

  const blockedPreflightOnly = buildArtifact(
    {
      deployEnv: 'production',
      dryRun: false,
      preflightOnly: true,
      continueOnError: false,
      root: 'D:\\BIDCRM',
    },
    { checks: [], blockingFailures: ['sentry.smokeToken'] },
    buildCommandPlan('production').map(preflightStep),
    now,
    now,
  );
  assert.equal(blockedPreflightOnly.passed, false);
  assert.deepEqual(blockedPreflightOnly.blockingFailures, ['preflight.sentry.smokeToken']);

  assert.equal(redact('Authorization: Bearer super-secret-token'), 'Authorization: Bearer <redacted>');
  assert.equal(redact('API_TOKEN=super-secret-token'), 'API_TOKEN=<redacted>');
  assert.equal(redact('{"token":"super-secret-token"}'), '{"token":"<redacted>"}');

  process.stdout.write('deploy evidence bundle selftest passed\n');
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    runSelftest();
  } else {
    process.exit(runBundle(args));
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
