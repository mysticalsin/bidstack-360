#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/operational-readiness-latest.json';
const DEFAULT_MIN_BACKUP_RETENTION_DAYS = 30;
const DEFAULT_MAX_RESTORE_RTO_MINUTES = 240;
const DEFAULT_MAX_RESTORE_RPO_MINUTES = 60;
const PLACEHOLDER_EXACT_VALUES = new Set([
  'abc123',
  'change-me',
  'changeme',
  'dummy',
  'example',
  'ops-123',
  'ops-1234',
  'sample',
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
const EVIDENCE_REF_DEFINITIONS = [
  {
    key: 'approval',
    label: 'approval evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_APPROVAL',
    sourcePaths: ['evidenceRefs.approval', 'approval.evidenceRef', 'approval.evidenceUrl'],
  },
  {
    key: 'bicepBuild',
    label: 'Bicep build evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_BICEP_BUILD',
    sourcePaths: ['evidenceRefs.bicepBuild', 'infrastructure.bicepBuildEvidenceRef', 'infra.bicepBuildEvidenceRef'],
  },
  {
    key: 'whatIf',
    label: 'Azure what-if evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_WHAT_IF',
    sourcePaths: ['evidenceRefs.whatIf', 'infrastructure.whatIfEvidenceRef', 'infra.whatIfEvidenceRef'],
  },
  {
    key: 'privateNetworking',
    label: 'private networking evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_PRIVATE_NETWORKING',
    sourcePaths: [
      'evidenceRefs.privateNetworking',
      'infrastructure.privateNetworkingEvidenceRef',
      'infra.privateNetworkingEvidenceRef',
    ],
  },
  {
    key: 'storage',
    label: 'storage validation evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_STORAGE',
    sourcePaths: ['evidenceRefs.storage', 'infrastructure.storageEvidenceRef', 'infra.storageEvidenceRef'],
  },
  {
    key: 'migrationJob',
    label: 'migration job evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_MIGRATION_JOB',
    sourcePaths: ['evidenceRefs.migrationJob', 'database.migrationJobEvidenceRef', 'migrations.jobEvidenceRef'],
  },
  {
    key: 'migrationDeploy',
    label: 'migration deploy evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_MIGRATION_DEPLOY',
    sourcePaths: [
      'evidenceRefs.migrationDeploy',
      'database.migrationDeployEvidenceRef',
      'migrations.deployEvidenceRef',
    ],
  },
  {
    key: 'backupConfig',
    label: 'backup configuration evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_BACKUP_CONFIG',
    sourcePaths: ['evidenceRefs.backupConfig', 'database.backupConfigEvidenceRef', 'backup.configEvidenceRef'],
  },
  {
    key: 'restoreDrill',
    label: 'restore drill evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_RESTORE_DRILL',
    sourcePaths: ['evidenceRefs.restoreDrill', 'database.restoreDrillEvidenceRef', 'backup.restoreDrillEvidenceRef'],
  },
  {
    key: 'rollbackRunbook',
    label: 'rollback runbook evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_ROLLBACK_RUNBOOK',
    sourcePaths: ['evidenceRefs.rollbackRunbook', 'rollback.runbookEvidenceRef'],
  },
  {
    key: 'rollbackDrill',
    label: 'rollback drill evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_ROLLBACK_DRILL',
    sourcePaths: ['evidenceRefs.rollbackDrill', 'rollback.rollbackDrillEvidenceRef', 'rollback.drillEvidenceRef'],
  },
  {
    key: 'monitoringAlerts',
    label: 'monitoring alert evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_MONITORING_ALERTS',
    sourcePaths: ['evidenceRefs.monitoringAlerts', 'monitoring.alertsEvidenceRef'],
  },
  {
    key: 'onCall',
    label: 'on-call escalation evidence reference',
    env: 'BIDSTACK_OPS_EVIDENCE_ONCALL',
    sourcePaths: ['evidenceRefs.onCall', 'monitoring.onCallEvidenceRef', 'monitoring.oncallEvidenceRef'],
  },
];

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_OPS_READINESS_EVIDENCE || DEFAULT_OUTPUT_PATH,
    inputPath: process.env.BIDSTACK_OPS_READINESS_FILE || '',
    environment: process.env.BIDSTACK_DEPLOY_ENV || process.env.BIDSTACK_OPS_ENV || 'staging',
    minBackupRetentionDays: Number(
      process.env.BIDSTACK_OPS_MIN_BACKUP_RETENTION_DAYS || DEFAULT_MIN_BACKUP_RETENTION_DAYS,
    ),
    maxRestoreRtoMinutes: Number(
      process.env.BIDSTACK_OPS_MAX_RESTORE_RTO_MINUTES || DEFAULT_MAX_RESTORE_RTO_MINUTES,
    ),
    maxRestoreRpoMinutes: Number(
      process.env.BIDSTACK_OPS_MAX_RESTORE_RPO_MINUTES || DEFAULT_MAX_RESTORE_RPO_MINUTES,
    ),
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
    } else if (arg === '--file') {
      parsed.inputPath = argv[index + 1] ?? parsed.inputPath;
      index += 1;
    } else if (arg.startsWith('--file=')) {
      parsed.inputPath = arg.slice('--file='.length);
    } else if (arg === '--env') {
      parsed.environment = argv[index + 1] ?? parsed.environment;
      index += 1;
    } else if (arg.startsWith('--env=')) {
      parsed.environment = arg.slice('--env='.length);
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
  parsed.environment = normalizeEnvironment(parsed.environment);
  parsed.inputPath = parsed.inputPath ? path.resolve(parsed.root, parsed.inputPath) : '';
  for (const [key, value] of [
    ['minBackupRetentionDays', parsed.minBackupRetentionDays],
    ['maxRestoreRtoMinutes', parsed.maxRestoreRtoMinutes],
    ['maxRestoreRpoMinutes', parsed.maxRestoreRpoMinutes],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${key} must be a positive number`);
    }
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack operational readiness evidence writer

Usage:
  node scripts/write-operational-readiness-evidence.mjs --file deploy-evidence/operational-readiness.json
  node scripts/write-operational-readiness-evidence.mjs --selftest

Environment:
  BIDSTACK_OPS_READINESS_EVIDENCE
  BIDSTACK_OPS_READINESS_FILE
  BIDSTACK_DEPLOY_ENV / BIDSTACK_OPS_ENV
  BIDSTACK_OPS_RELEASE_ID
  BIDSTACK_OPS_REVIEWER
  BIDSTACK_OPS_APPROVER
  BIDSTACK_OPS_APPROVAL_TICKET
  BIDSTACK_OPS_APPROVED_AT
  BIDSTACK_OPS_BICEP_BUILD_PASSED=true
  BIDSTACK_OPS_WHAT_IF_PASSED=true
  BIDSTACK_OPS_PRIVATE_NETWORKING_APPROVED=true
  BIDSTACK_OPS_STORAGE_VALIDATED=true
  BIDSTACK_OPS_MIGRATION_JOB_VALIDATED=true
  BIDSTACK_OPS_MIGRATION_DEPLOY_VALIDATED=true
  BIDSTACK_OPS_BACKUP_CONFIGURED=true
  BIDSTACK_OPS_BACKUP_RETENTION_DAYS=35
  BIDSTACK_OPS_GEO_REDUNDANT_BACKUP=true
  BIDSTACK_OPS_RESTORE_DRILL_AT=2026-06-18T10:00:00.000Z
  BIDSTACK_OPS_RESTORE_RTO_MINUTES=120
  BIDSTACK_OPS_RESTORE_RPO_MINUTES=15
  BIDSTACK_OPS_ROLLBACK_RUNBOOK_REVIEWED=true
  BIDSTACK_OPS_ROLLBACK_DRILL_AT=2026-06-18T11:00:00.000Z
  BIDSTACK_OPS_MONITORING_ALERTS_VALIDATED=true
  BIDSTACK_OPS_ONCALL_VALIDATED=true
  BIDSTACK_OPS_EVIDENCE_APPROVAL
  BIDSTACK_OPS_EVIDENCE_BICEP_BUILD
  BIDSTACK_OPS_EVIDENCE_WHAT_IF
  BIDSTACK_OPS_EVIDENCE_PRIVATE_NETWORKING
  BIDSTACK_OPS_EVIDENCE_STORAGE
  BIDSTACK_OPS_EVIDENCE_MIGRATION_JOB
  BIDSTACK_OPS_EVIDENCE_MIGRATION_DEPLOY
  BIDSTACK_OPS_EVIDENCE_BACKUP_CONFIG
  BIDSTACK_OPS_EVIDENCE_RESTORE_DRILL
  BIDSTACK_OPS_EVIDENCE_ROLLBACK_RUNBOOK
  BIDSTACK_OPS_EVIDENCE_ROLLBACK_DRILL
  BIDSTACK_OPS_EVIDENCE_MONITORING_ALERTS
  BIDSTACK_OPS_EVIDENCE_ONCALL
`);
}

function normalizeEnvironment(value) {
  const normalized = String(value || 'staging').trim().toLowerCase();
  if (normalized === 'prod') return 'production';
  if (normalized === 'stage') return 'staging';
  return normalized || 'staging';
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

function hasPlaceholderSignal(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    PLACEHOLDER_EXACT_VALUES.has(normalized) ||
    PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function parseJsonFileAllowBom(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
}

function getPath(source, dottedPath) {
  return String(dottedPath)
    .split('.')
    .reduce((current, segment) => (current && typeof current === 'object' ? current[segment] : undefined), source);
}

function pickString(source, paths, fallback = '') {
  for (const pathKey of paths) {
    const value = getPath(source, pathKey);
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return fallback;
}

function pickBoolean(source, paths, fallback = null) {
  for (const pathKey of paths) {
    const parsed = parseOptionalBoolean(getPath(source, pathKey));
    if (parsed !== null) return parsed;
  }
  return fallback;
}

function pickInteger(source, paths, fallback = null) {
  for (const pathKey of paths) {
    const parsed = parseOptionalInteger(getPath(source, pathKey));
    if (parsed !== null) return parsed;
  }
  return fallback;
}

function loadInput(options) {
  if (!options.inputPath) {
    return { source: 'environment', value: {} };
  }
  if (!existsSync(options.inputPath)) {
    return {
      source: 'file',
      path: path.relative(options.root, options.inputPath),
      value: {},
      error: `Operational readiness file is missing: ${path.relative(options.root, options.inputPath)}`,
    };
  }
  try {
    const parsed = parseJsonFileAllowBom(options.inputPath);
    return {
      source: 'file',
      path: path.relative(options.root, options.inputPath),
      value: parsed?.operationalReadiness ?? parsed,
    };
  } catch (error) {
    return {
      source: 'file',
      path: path.relative(options.root, options.inputPath),
      value: {},
      error: error.message,
    };
  }
}

function envRecord(env = process.env) {
  return {
    environment: env.BIDSTACK_OPS_ENV || env.BIDSTACK_DEPLOY_ENV,
    platform: env.BIDSTACK_OPS_PLATFORM,
    releaseId: env.BIDSTACK_OPS_RELEASE_ID,
    reviewer: env.BIDSTACK_OPS_REVIEWER,
    approver: env.BIDSTACK_OPS_APPROVER,
    approvalTicket: env.BIDSTACK_OPS_APPROVAL_TICKET,
    approvedAt: env.BIDSTACK_OPS_APPROVED_AT,
    infrastructure: {
      bicepBuildPassed: env.BIDSTACK_OPS_BICEP_BUILD_PASSED,
      whatIfPassed: env.BIDSTACK_OPS_WHAT_IF_PASSED,
      privateNetworkingApproved: env.BIDSTACK_OPS_PRIVATE_NETWORKING_APPROVED,
      storageValidated: env.BIDSTACK_OPS_STORAGE_VALIDATED,
    },
    database: {
      migrationJobValidated: env.BIDSTACK_OPS_MIGRATION_JOB_VALIDATED,
      migrationDeployValidated: env.BIDSTACK_OPS_MIGRATION_DEPLOY_VALIDATED,
      backupConfigured: env.BIDSTACK_OPS_BACKUP_CONFIGURED,
      backupRetentionDays: env.BIDSTACK_OPS_BACKUP_RETENTION_DAYS,
      geoRedundantBackup: env.BIDSTACK_OPS_GEO_REDUNDANT_BACKUP,
      restoreDrillAt: env.BIDSTACK_OPS_RESTORE_DRILL_AT,
      restoreRtoMinutes: env.BIDSTACK_OPS_RESTORE_RTO_MINUTES,
      restoreRpoMinutes: env.BIDSTACK_OPS_RESTORE_RPO_MINUTES,
    },
    rollback: {
      runbookReviewed: env.BIDSTACK_OPS_ROLLBACK_RUNBOOK_REVIEWED,
      rollbackDrillAt: env.BIDSTACK_OPS_ROLLBACK_DRILL_AT,
    },
    monitoring: {
      alertsValidated: env.BIDSTACK_OPS_MONITORING_ALERTS_VALIDATED,
      onCallValidated: env.BIDSTACK_OPS_ONCALL_VALIDATED,
    },
    evidenceRefs: Object.fromEntries(
      EVIDENCE_REF_DEFINITIONS.map((definition) => [
        definition.key,
        env[definition.env],
      ]),
    ),
  };
}

function pickEvidenceRefs(envInput, source) {
  return Object.fromEntries(
    EVIDENCE_REF_DEFINITIONS.map((definition) => [
      definition.key,
      pickString(
        envInput,
        [`evidenceRefs.${definition.key}`],
        pickString(source, definition.sourcePaths),
      ),
    ]),
  );
}

function buildRecord(options, input) {
  const envInput = envRecord();
  const source = { ...input.value, environment: input.value?.environment ?? options.environment };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'operational-readiness-evidence',
    environment: normalizeEnvironment(
      pickString(envInput, ['environment'], pickString(source, ['environment'], options.environment)),
    ),
    platform: pickString(envInput, ['platform'], pickString(source, ['platform'], 'azure')),
    releaseId: pickString(envInput, ['releaseId'], pickString(source, ['releaseId', 'release.id'])),
    reviewer: pickString(envInput, ['reviewer'], pickString(source, ['reviewer', 'review.reviewer'])),
    approver: pickString(envInput, ['approver'], pickString(source, ['approver', 'approval.approver'])),
    approvalTicket: pickString(
      envInput,
      ['approvalTicket'],
      pickString(source, ['approvalTicket', 'approval.ticket', 'approval.approvalTicket']),
    ),
    approvedAt: pickString(envInput, ['approvedAt'], pickString(source, ['approvedAt', 'approval.approvedAt'])),
    infrastructure: {
      bicepBuildPassed: pickBoolean(
        envInput,
        ['infrastructure.bicepBuildPassed'],
        pickBoolean(source, ['infrastructure.bicepBuildPassed', 'infra.bicepBuildPassed']),
      ),
      whatIfPassed: pickBoolean(
        envInput,
        ['infrastructure.whatIfPassed'],
        pickBoolean(source, ['infrastructure.whatIfPassed', 'infra.whatIfPassed']),
      ),
      privateNetworkingApproved: pickBoolean(
        envInput,
        ['infrastructure.privateNetworkingApproved'],
        pickBoolean(source, ['infrastructure.privateNetworkingApproved', 'infra.privateNetworkingApproved']),
      ),
      storageValidated: pickBoolean(
        envInput,
        ['infrastructure.storageValidated'],
        pickBoolean(source, ['infrastructure.storageValidated', 'infra.storageValidated']),
      ),
    },
    database: {
      migrationJobValidated: pickBoolean(
        envInput,
        ['database.migrationJobValidated'],
        pickBoolean(source, ['database.migrationJobValidated', 'migrations.jobValidated']),
      ),
      migrationDeployValidated: pickBoolean(
        envInput,
        ['database.migrationDeployValidated'],
        pickBoolean(source, ['database.migrationDeployValidated', 'migrations.deployValidated']),
      ),
      backupConfigured: pickBoolean(
        envInput,
        ['database.backupConfigured'],
        pickBoolean(source, ['database.backupConfigured', 'backup.configured']),
      ),
      backupRetentionDays: pickInteger(
        envInput,
        ['database.backupRetentionDays'],
        pickInteger(source, ['database.backupRetentionDays', 'backup.retentionDays']),
      ),
      geoRedundantBackup: pickBoolean(
        envInput,
        ['database.geoRedundantBackup'],
        pickBoolean(source, ['database.geoRedundantBackup', 'backup.geoRedundant']),
      ),
      restoreDrillAt: pickString(
        envInput,
        ['database.restoreDrillAt'],
        pickString(source, ['database.restoreDrillAt', 'backup.restoreDrillAt']),
      ),
      restoreRtoMinutes: pickInteger(
        envInput,
        ['database.restoreRtoMinutes'],
        pickInteger(source, ['database.restoreRtoMinutes', 'backup.restoreRtoMinutes']),
      ),
      restoreRpoMinutes: pickInteger(
        envInput,
        ['database.restoreRpoMinutes'],
        pickInteger(source, ['database.restoreRpoMinutes', 'backup.restoreRpoMinutes']),
      ),
    },
    rollback: {
      runbookReviewed: pickBoolean(
        envInput,
        ['rollback.runbookReviewed'],
        pickBoolean(source, ['rollback.runbookReviewed']),
      ),
      rollbackDrillAt: pickString(
        envInput,
        ['rollback.rollbackDrillAt'],
        pickString(source, ['rollback.rollbackDrillAt', 'rollback.drillAt']),
      ),
    },
    monitoring: {
      alertsValidated: pickBoolean(
        envInput,
        ['monitoring.alertsValidated'],
        pickBoolean(source, ['monitoring.alertsValidated']),
      ),
      onCallValidated: pickBoolean(
        envInput,
        ['monitoring.onCallValidated'],
        pickBoolean(source, ['monitoring.onCallValidated', 'monitoring.oncallValidated']),
      ),
    },
    evidenceRefs: pickEvidenceRefs(envInput, source),
    thresholds: {
      minBackupRetentionDays: options.minBackupRetentionDays,
      maxRestoreRtoMinutes: options.maxRestoreRtoMinutes,
      maxRestoreRpoMinutes: options.maxRestoreRpoMinutes,
    },
    input: {
      source: input.source,
      path: input.path,
      error: input.error,
    },
  };
}

function validateArtifact(artifact) {
  const failures = [];
  const requireText = (value, label) => {
    if (!String(value || '').trim()) failures.push(`${label} is required`);
    if (hasPlaceholderSignal(value)) failures.push(`${label} looks like a placeholder`);
  };
  const requireTrue = (value, label) => {
    if (value !== true) failures.push(label);
  };

  if (artifact.input.error) failures.push(artifact.input.error);
  if (!['staging', 'production'].includes(artifact.environment)) {
    failures.push(`environment must be staging or production, got ${artifact.environment || 'missing'}`);
  }
  requireText(artifact.platform, 'platform');
  requireText(artifact.releaseId, 'releaseId');
  requireText(artifact.reviewer, 'reviewer');
  requireText(artifact.approver, 'approver');
  requireText(artifact.approvalTicket, 'approvalTicket');
  if (!isIsoTimestamp(artifact.approvedAt)) failures.push('approvedAt must be an ISO timestamp');
  for (const definition of EVIDENCE_REF_DEFINITIONS) {
    requireText(artifact.evidenceRefs?.[definition.key], definition.label);
  }

  requireTrue(artifact.infrastructure.bicepBuildPassed, 'Azure/Bicep build must be validated');
  requireTrue(artifact.infrastructure.whatIfPassed, 'Azure what-if/plan must be validated');
  requireTrue(artifact.infrastructure.privateNetworkingApproved, 'private networking posture must be approved');
  requireTrue(artifact.infrastructure.storageValidated, 'object storage driver must be validated');

  requireTrue(artifact.database.migrationJobValidated, 'migration job must be validated');
  requireTrue(artifact.database.migrationDeployValidated, 'migration deploy path must be validated');
  requireTrue(artifact.database.backupConfigured, 'database backups must be configured');
  requireTrue(artifact.database.geoRedundantBackup, 'geo-redundant backup must be enabled or explicitly approved');
  if (
    !Number.isInteger(artifact.database.backupRetentionDays) ||
    artifact.database.backupRetentionDays < artifact.thresholds.minBackupRetentionDays
  ) {
    failures.push(
      `backup retention must be at least ${artifact.thresholds.minBackupRetentionDays} days`,
    );
  }
  if (!isIsoTimestamp(artifact.database.restoreDrillAt)) {
    failures.push('restoreDrillAt must be an ISO timestamp');
  }
  if (
    !Number.isInteger(artifact.database.restoreRtoMinutes) ||
    artifact.database.restoreRtoMinutes > artifact.thresholds.maxRestoreRtoMinutes
  ) {
    failures.push(`restore RTO must be <= ${artifact.thresholds.maxRestoreRtoMinutes} minutes`);
  }
  if (
    !Number.isInteger(artifact.database.restoreRpoMinutes) ||
    artifact.database.restoreRpoMinutes > artifact.thresholds.maxRestoreRpoMinutes
  ) {
    failures.push(`restore RPO must be <= ${artifact.thresholds.maxRestoreRpoMinutes} minutes`);
  }

  requireTrue(artifact.rollback.runbookReviewed, 'rollback runbook must be reviewed');
  if (!isIsoTimestamp(artifact.rollback.rollbackDrillAt)) {
    failures.push('rollbackDrillAt must be an ISO timestamp');
  }
  requireTrue(artifact.monitoring.alertsValidated, 'monitoring alerts must be validated');
  requireTrue(artifact.monitoring.onCallValidated, 'on-call escalation must be validated');

  return [...new Set(failures)];
}

function buildArtifact(options) {
  const input = loadInput(options);
  const artifact = buildRecord(options, input);
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
  process.stdout.write(`Operational readiness evidence: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Environment: ${artifact.environment}\n`);
  process.stdout.write(`Platform: ${artifact.platform || 'missing'}\n`);
  process.stdout.write(`Validation failures: ${artifact.validationFailures.length}\n`);
  for (const failure of artifact.validationFailures) {
    process.stderr.write(`FAIL ${failure}\n`);
  }
  if (!artifact.passed) return 1;
  process.stdout.write('Operational readiness evidence passed\n');
  return 0;
}

function goodFixture(overrides = {}) {
  return {
    environment: 'staging',
    platform: 'azure',
    releaseId: 'release-2026-06-18-c038c5d9',
    reviewer: 'release-ops@bidstack360.com',
    approval: {
      approver: 'platform-owner@bidstack360.com',
      ticket: 'OPS-92741',
      approvedAt: '2026-06-18T10:00:00.000Z',
    },
    infrastructure: {
      bicepBuildPassed: true,
      whatIfPassed: true,
      privateNetworkingApproved: true,
      storageValidated: true,
    },
    database: {
      migrationJobValidated: true,
      migrationDeployValidated: true,
      backupConfigured: true,
      backupRetentionDays: 35,
      geoRedundantBackup: true,
      restoreDrillAt: '2026-06-18T11:00:00.000Z',
      restoreRtoMinutes: 120,
      restoreRpoMinutes: 15,
    },
    rollback: {
      runbookReviewed: true,
      rollbackDrillAt: '2026-06-18T12:00:00.000Z',
    },
    monitoring: {
      alertsValidated: true,
      onCallValidated: true,
    },
    evidenceRefs: {
      approval: 'MANTU-OPS-92741 approval record',
      bicepBuild: 'az://deployment/build/release-2026-06-18-c038c5d9',
      whatIf: 'az://deployment/what-if/release-2026-06-18-c038c5d9',
      privateNetworking: 'docs://ops/private-networking/review-2026-06-18',
      storage: 'docs://ops/storage-driver/validation-2026-06-18',
      migrationJob: 'az://jobs/migration/release-2026-06-18-c038c5d9',
      migrationDeploy: 'az://db/migration/deploy/release-2026-06-18-c038c5d9',
      backupConfig: 'az://postgres/backups/policy-35d-geo',
      restoreDrill: 'az://postgres/restore-drill/2026-06-18T11:00:00.000Z',
      rollbackRunbook: 'docs://runbooks/rollback/review-2026-06-18',
      rollbackDrill: 'docs://runbooks/rollback/drill-2026-06-18T12:00:00.000Z',
      monitoringAlerts: 'sentry://alerts/release-2026-06-18-c038c5d9',
      onCall: 'pagerduty://service/bidstack/release-2026-06-18',
    },
    ...overrides,
  };
}

function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidcrm-ops-readiness-'));
  const originalEnv = { ...process.env };
  try {
    const goodPath = path.join(root, 'ops-good.json');
    writeFileSync(goodPath, `${JSON.stringify(goodFixture(), null, 2)}\n`, 'utf8');
    const good = buildArtifact({
      root,
      outputPath: 'out.json',
      inputPath: goodPath,
      environment: 'staging',
      minBackupRetentionDays: 30,
      maxRestoreRtoMinutes: 240,
      maxRestoreRpoMinutes: 60,
    });
    assert.equal(good.passed, true, `expected good fixture: ${good.validationFailures.join(', ')}`);

    const weakRpoPath = path.join(root, 'ops-weak-rpo.json');
    writeFileSync(
      weakRpoPath,
      `${JSON.stringify(goodFixture({ database: { ...goodFixture().database, restoreRpoMinutes: 180 } }), null, 2)}\n`,
      'utf8',
    );
    const weakRpo = buildArtifact({
      root,
      outputPath: 'out.json',
      inputPath: weakRpoPath,
      environment: 'staging',
      minBackupRetentionDays: 30,
      maxRestoreRtoMinutes: 240,
      maxRestoreRpoMinutes: 60,
    });
    assert.equal(weakRpo.passed, false, 'expected weak restore RPO to fail');
    assert.equal(
      weakRpo.validationFailures.some((failure) => failure.includes('restore RPO')),
      true,
      'expected RPO failure',
    );

    const missingDrillPath = path.join(root, 'ops-missing-drill.json');
    writeFileSync(
      missingDrillPath,
      `${JSON.stringify(goodFixture({ rollback: { runbookReviewed: true, rollbackDrillAt: '' } }), null, 2)}\n`,
      'utf8',
    );
    const missingDrill = buildArtifact({
      root,
      outputPath: 'out.json',
      inputPath: missingDrillPath,
      environment: 'staging',
      minBackupRetentionDays: 30,
      maxRestoreRtoMinutes: 240,
      maxRestoreRpoMinutes: 60,
    });
    assert.equal(missingDrill.passed, false, 'expected missing rollback drill to fail');

    const sampleApprovalTicketPath = path.join(root, 'ops-sample-ticket.json');
    writeFileSync(
      sampleApprovalTicketPath,
      `${JSON.stringify(
        goodFixture({ approval: { ...goodFixture().approval, ticket: 'OPS-1234' } }),
        null,
        2,
      )}\n`,
      'utf8',
    );
    const sampleApprovalTicket = buildArtifact({
      root,
      outputPath: 'out.json',
      inputPath: sampleApprovalTicketPath,
      environment: 'staging',
      minBackupRetentionDays: 30,
      maxRestoreRtoMinutes: 240,
      maxRestoreRpoMinutes: 60,
    });
    assert.equal(sampleApprovalTicket.passed, false, 'expected sample approval ticket to fail');
    assert.equal(
      sampleApprovalTicket.validationFailures.some((failure) => failure.includes('approvalTicket')),
      true,
      'expected approval ticket placeholder failure',
    );

    const missingEvidenceRefPath = path.join(root, 'ops-missing-evidence-ref.json');
    writeFileSync(
      missingEvidenceRefPath,
      `${JSON.stringify(goodFixture({ evidenceRefs: { ...goodFixture().evidenceRefs, whatIf: '' } }), null, 2)}\n`,
      'utf8',
    );
    const missingEvidenceRef = buildArtifact({
      root,
      outputPath: 'out.json',
      inputPath: missingEvidenceRefPath,
      environment: 'staging',
      minBackupRetentionDays: 30,
      maxRestoreRtoMinutes: 240,
      maxRestoreRpoMinutes: 60,
    });
    assert.equal(missingEvidenceRef.passed, false, 'expected missing ops evidence reference to fail');
    assert.equal(
      missingEvidenceRef.validationFailures.some((failure) => failure.includes('what-if evidence reference')),
      true,
      'expected what-if evidence reference failure',
    );

    const placeholder = buildArtifact({
      root,
      outputPath: 'out.json',
      inputPath: '',
      environment: 'staging',
      minBackupRetentionDays: 30,
      maxRestoreRtoMinutes: 240,
      maxRestoreRpoMinutes: 60,
    });
    assert.equal(placeholder.passed, false, 'expected missing env/file evidence to fail');

    process.stdout.write('operational readiness evidence selftest passed\n');
  } finally {
    process.env = originalEnv;
    rmSync(root, { recursive: true, force: true });
  }
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
