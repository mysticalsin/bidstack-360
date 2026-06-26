#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const STRICT_ENVS = new Set(['production', 'staging']);
const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_PATHS = {
  source: 'deploy-evidence/source-control-latest.json',
  load: 'load-test-report/production-load-latest.json',
  semgrep: 'deploy-evidence/semgrep-latest.json',
  container: 'deploy-evidence/container-scan-latest.json',
  secrets: 'deploy-evidence/secret-scan-latest.json',
  providers: 'deploy-evidence/provider-quality-latest.json',
  sentry: 'deploy-evidence/sentry-smoke-latest.json',
  browser: 'deploy-evidence/browser-regression-latest.json',
  tools: 'deploy-evidence/tool-readiness-latest.json',
  ops: 'deploy-evidence/operational-readiness-latest.json',
};
const DEFAULT_LOAD_RAW_SUMMARY = 'load-test-report/k6-summary-latest.json';
const DEFAULT_BROWSER_SOURCE_REPORT = 'deploy-evidence/playwright-browser-regression.json';
const DEFAULT_CONTAINER_RAW_REPORT_DIR = 'deploy-evidence/container-scan-reports';
const DEFAULT_SECRET_RAW_REPORT_DIR = 'deploy-evidence/secret-scan-reports';
const DEFAULT_CONTAINER_IMAGES = [
  'bidcrm-api:root-api-user-probe',
  'bidcrm-web:root-web-probe',
  'bidcrm-worker:root-current-osd',
  'bidcrm-mcp:root-mcp-user-probe',
  'bidcrm-migrate:nonroot-probe',
];
const DEFAULT_BROWSER_ROLES = ['admin', 'manager', 'read-only', 'viewer'];
const DEFAULT_BROWSER_PROJECTS = ['chromium-desktop', 'firefox-desktop', 'webkit-desktop'];
const DEFAULT_BROWSER_SPECS = ['e2e/flows/rbac.spec.ts'];
const ACCEPTED_BROWSER_PROFILES = new Set(['cross-role-regression', 'release-regression']);
const TOOL_DOCKER_IMAGE_PROBES = [
  { runnerId: 'gitleaks.runner', imageId: 'gitleaks.image' },
  { runnerId: 'k6.runner', imageId: 'k6.image' },
  { runnerId: 'semgrep.runner', imageId: 'semgrep.image', alwaysDocker: true },
  { runnerId: 'trivy.runner', imageId: 'trivy.image', alwaysDocker: true },
];
const OPS_EVIDENCE_REF_CHECKS = [
  {
    id: 'ops.evidence.approval',
    label: 'Operational approval has reviewable evidence',
    paths: ['evidenceRefs.approval', 'approval.evidenceRef', 'approval.evidenceUrl'],
  },
  {
    id: 'ops.evidence.bicepBuild',
    label: 'Bicep build validation has reviewable evidence',
    paths: ['evidenceRefs.bicepBuild', 'infrastructure.bicepBuildEvidenceRef', 'infra.bicepBuildEvidenceRef'],
  },
  {
    id: 'ops.evidence.whatIf',
    label: 'Azure what-if validation has reviewable evidence',
    paths: ['evidenceRefs.whatIf', 'infrastructure.whatIfEvidenceRef', 'infra.whatIfEvidenceRef'],
  },
  {
    id: 'ops.evidence.privateNetworking',
    label: 'Private networking approval has reviewable evidence',
    paths: [
      'evidenceRefs.privateNetworking',
      'infrastructure.privateNetworkingEvidenceRef',
      'infra.privateNetworkingEvidenceRef',
    ],
  },
  {
    id: 'ops.evidence.storage',
    label: 'Storage validation has reviewable evidence',
    paths: ['evidenceRefs.storage', 'infrastructure.storageEvidenceRef', 'infra.storageEvidenceRef'],
  },
  {
    id: 'ops.evidence.migrationJob',
    label: 'Migration job validation has reviewable evidence',
    paths: ['evidenceRefs.migrationJob', 'database.migrationJobEvidenceRef', 'migrations.jobEvidenceRef'],
  },
  {
    id: 'ops.evidence.migrationDeploy',
    label: 'Migration deploy validation has reviewable evidence',
    paths: [
      'evidenceRefs.migrationDeploy',
      'database.migrationDeployEvidenceRef',
      'migrations.deployEvidenceRef',
    ],
  },
  {
    id: 'ops.evidence.backupConfig',
    label: 'Backup configuration has reviewable evidence',
    paths: ['evidenceRefs.backupConfig', 'database.backupConfigEvidenceRef', 'backup.configEvidenceRef'],
  },
  {
    id: 'ops.evidence.restoreDrill',
    label: 'Restore drill has reviewable evidence',
    paths: ['evidenceRefs.restoreDrill', 'database.restoreDrillEvidenceRef', 'backup.restoreDrillEvidenceRef'],
  },
  {
    id: 'ops.evidence.rollbackRunbook',
    label: 'Rollback runbook review has reviewable evidence',
    paths: ['evidenceRefs.rollbackRunbook', 'rollback.runbookEvidenceRef'],
  },
  {
    id: 'ops.evidence.rollbackDrill',
    label: 'Rollback drill has reviewable evidence',
    paths: ['evidenceRefs.rollbackDrill', 'rollback.rollbackDrillEvidenceRef', 'rollback.drillEvidenceRef'],
  },
  {
    id: 'ops.evidence.monitoringAlerts',
    label: 'Monitoring alert validation has reviewable evidence',
    paths: ['evidenceRefs.monitoringAlerts', 'monitoring.alertsEvidenceRef'],
  },
  {
    id: 'ops.evidence.onCall',
    label: 'On-call escalation validation has reviewable evidence',
    paths: ['evidenceRefs.onCall', 'monitoring.onCallEvidenceRef', 'monitoring.oncallEvidenceRef'],
  },
];

function parseArgs(argv) {
  const parsed = {
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV || 'production',
    root: process.cwd(),
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--selftest') {
      parsed.selftest = true;
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
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.deployEnv = normalizeEnvironment(parsed.deployEnv);
  parsed.root = path.resolve(parsed.root);
  return parsed;
}

function printHelp() {
  process.stdout.write(`BidStack deploy evidence verifier

Usage:
  node scripts/verify-deploy-evidence.mjs --env production
  node scripts/verify-deploy-evidence.mjs --env staging
  node scripts/verify-deploy-evidence.mjs --selftest

Environment overrides:
  BIDSTACK_SOURCE_CONTROL_EVIDENCE
  BIDSTACK_LOAD_CERT_PATH
  BIDSTACK_SEMGREP_REPORT
  BIDSTACK_CONTAINER_SCAN_REPORT
  BIDSTACK_SECRET_SCAN_EVIDENCE
  BIDSTACK_PROVIDER_QUALITY_EVIDENCE
  BIDSTACK_SENTRY_EVIDENCE_PATH
  BIDSTACK_BROWSER_REGRESSION_EVIDENCE
  BIDSTACK_TOOL_READINESS_EVIDENCE
  BIDSTACK_OPS_READINESS_EVIDENCE
  BIDSTACK_DEPLOY_REQUIRED_PROVIDERS
  BIDSTACK_DEPLOY_REQUIRED_TECH_INTEL_SOURCES
  BIDSTACK_DEPLOY_EVIDENCE_MAX_AGE_HOURS
  BIDSTACK_DEPLOY_EVIDENCE_REPORT
`);
}

function normalizeEnvironment(value) {
  const normalized = String(value || 'production')
    .trim()
    .toLowerCase();
  if (normalized === 'prod') {
    return 'production';
  }
  if (normalized === 'stage') {
    return 'staging';
  }
  return normalized || 'production';
}

function normalizeOptionalEnvironment(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'prod') {
    return 'production';
  }
  if (normalized === 'stage') {
    return 'staging';
  }
  return normalized;
}

function isIsoTimestamp(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T/.test(normalized) && Number.isFinite(Date.parse(normalized));
}

function defaultReportPath(deployEnv) {
  const normalized = normalizeEnvironment(deployEnv);
  if (STRICT_ENVS.has(normalized)) {
    return `deploy-evidence/strict-${normalized}-latest.json`;
  }
  return 'deploy-evidence/deploy-evidence-latest.json';
}

function makeConfig(options) {
  const deployEnv = normalizeEnvironment(options.deployEnv);
  const strict = STRICT_ENVS.has(deployEnv);
  const maxAgeHours = Number(
    process.env.BIDSTACK_DEPLOY_EVIDENCE_MAX_AGE_HOURS ||
      options.maxAgeHours ||
      DEFAULT_MAX_AGE_HOURS,
  );
  const requiredImages = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_IMAGES || DEFAULT_CONTAINER_IMAGES.join(',')
  )
    .split(',')
    .map((image) => image.trim())
    .filter(Boolean);
  const requiredBrowserRoles = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_BROWSER_ROLES || DEFAULT_BROWSER_ROLES.join(',')
  )
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
  const requiredBrowserProjects = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_BROWSER_PROJECTS || DEFAULT_BROWSER_PROJECTS.join(',')
  )
    .split(',')
    .map((project) => project.trim())
    .filter(Boolean);
  const requiredBrowserSpecs = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_BROWSER_SPECS || DEFAULT_BROWSER_SPECS.join(',')
  )
    .split(',')
    .map((spec) => spec.trim())
    .filter(Boolean);
  const requiredProviders = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_PROVIDERS || 'apollo,seamless,tech_intel'
  )
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean);
  const requiredTechIntelSources = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_TECH_INTEL_SOURCES ||
    process.env.BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES ||
    ''
  )
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean);

  return {
    root: path.resolve(options.root || process.cwd()),
    deployEnv,
    strict,
    maxAgeHours:
      Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : DEFAULT_MAX_AGE_HOURS,
    reportPath: process.env.BIDSTACK_DEPLOY_EVIDENCE_REPORT || defaultReportPath(deployEnv),
    semgrepBlockingSeverities: (
      process.env.BIDSTACK_DEPLOY_SEMGREP_BLOCKING_SEVERITIES || 'ERROR,CRITICAL,HIGH'
    )
      .split(',')
      .map((severity) => severity.trim().toUpperCase())
      .filter(Boolean),
    requiredImages,
    requiredBrowserRoles,
    requiredBrowserProjects,
    requiredBrowserSpecs,
    requiredProviders,
    requiredTechIntelSources,
    paths: {
      source: process.env.BIDSTACK_SOURCE_CONTROL_EVIDENCE || DEFAULT_PATHS.source,
      load: process.env.BIDSTACK_LOAD_CERT_PATH || DEFAULT_PATHS.load,
      semgrep: process.env.BIDSTACK_SEMGREP_REPORT || DEFAULT_PATHS.semgrep,
      container: process.env.BIDSTACK_CONTAINER_SCAN_REPORT || DEFAULT_PATHS.container,
      secrets: process.env.BIDSTACK_SECRET_SCAN_EVIDENCE || DEFAULT_PATHS.secrets,
      providers: process.env.BIDSTACK_PROVIDER_QUALITY_EVIDENCE || DEFAULT_PATHS.providers,
      sentry: process.env.BIDSTACK_SENTRY_EVIDENCE_PATH || DEFAULT_PATHS.sentry,
      browser: process.env.BIDSTACK_BROWSER_REGRESSION_EVIDENCE || DEFAULT_PATHS.browser,
      tools: process.env.BIDSTACK_TOOL_READINESS_EVIDENCE || DEFAULT_PATHS.tools,
      ops: process.env.BIDSTACK_OPS_READINESS_EVIDENCE || DEFAULT_PATHS.ops,
    },
  };
}

function createRecorder() {
  const checks = [];
  return {
    checks,
    pass(id, label, detail = '') {
      checks.push({ status: 'pass', id, label, detail });
    },
    warn(id, label, detail = '') {
      checks.push({ status: 'warn', id, label, detail });
    },
    fail(id, label, detail = '') {
      checks.push({ status: 'fail', id, label, detail });
    },
    softFail(config, id, label, detail = '') {
      if (config.strict) {
        this.fail(id, label, detail);
      } else {
        this.warn(id, label, detail);
      }
    },
  };
}

function resolveArtifact(config, relativePath) {
  return path.resolve(config.root, relativePath);
}

function resolvePathInsideRoot(root, value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw, absolutePath: '', insideRoot: false };
  const absolutePath = path.resolve(root, raw);
  const relative = path.relative(root, absolutePath);
  return {
    raw,
    absolutePath,
    insideRoot: Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative),
  };
}

function readJsonArtifact(config, recorder, id, label, relativePath) {
  const absolutePath = resolveArtifact(config, relativePath);
  if (!existsSync(absolutePath)) {
    recorder.softFail(config, id, `${label} artifact is missing`, relativePath);
    return null;
  }

  try {
    const value = JSON.parse(readFileSync(absolutePath, 'utf8'));
    return { value, absolutePath, relativePath };
  } catch (error) {
    recorder.softFail(config, id, `${label} artifact is not valid JSON`, error.message);
    return null;
  }
}

function checkFreshness(config, recorder, id, label, artifact, value) {
  const timestamp = getArtifactTimestamp(artifact.absolutePath, value);
  if (!timestamp) {
    recorder.softFail(config, id, `${label} has no usable timestamp`, artifact.relativePath);
    return;
  }

  const ageMs = Date.now() - timestamp.getTime();
  const futureSkewMs = -5 * 60 * 1000;
  if (ageMs < futureSkewMs) {
    recorder.softFail(config, id, `${label} timestamp is in the future`, timestamp.toISOString());
    return;
  }

  const ageHours = Math.max(0, ageMs / 3_600_000);
  if (ageHours > config.maxAgeHours) {
    recorder.softFail(
      config,
      id,
      `${label} is stale`,
      `${ageHours.toFixed(1)}h old; limit is ${config.maxAgeHours}h`,
    );
    return;
  }

  recorder.pass(id, `${label} is fresh`, `${ageHours.toFixed(1)}h old`);
}

function getArtifactTimestamp(absolutePath, value) {
  const candidates = [
    value?.generatedAt,
    value?.completedAt,
    value?.timestamp,
    value?.createdAt,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  try {
    return statSync(absolutePath).mtime;
  } catch {
    return null;
  }
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
    status: String(line || '').slice(0, 2),
    file: String(line || '').slice(3).trim().replace(/\\/g, '/'),
  };
}

function manifestKey(entry) {
  return `${entry.status}\t${entry.file}`;
}

function normalizeManifest(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      status: String(entry?.status || '').slice(0, 2),
      file: String(entry?.file || '').trim().replace(/\\/g, '/'),
    }))
    .filter((entry) => entry.status.trim() && entry.file)
    .sort((left, right) => manifestKey(left).localeCompare(manifestKey(right)));
}

function diffManifest(sourceManifest, currentManifest) {
  const sourceKeys = new Set(sourceManifest.map(manifestKey));
  const currentKeys = new Set(currentManifest.map(manifestKey));
  return {
    added: currentManifest.filter((entry) => !sourceKeys.has(manifestKey(entry))).slice(0, 8),
    removed: sourceManifest.filter((entry) => !currentKeys.has(manifestKey(entry))).slice(0, 8),
  };
}

function collectCurrentSourceSnapshot(root) {
  const inside = runGit(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.passed || firstLine(inside.stdout) !== 'true') {
    return {
      available: false,
      reasons: ['not_inside_git_worktree'],
      statusManifest: [],
      commands: [{ command: inside.command, exitCode: inside.exitCode, error: inside.error }],
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
  };
}

function compareSourceEvidenceToCurrent(value, root) {
  const current = collectCurrentSourceSnapshot(root);
  const reasons = [...(current.reasons || [])];
  const sourceManifest = normalizeManifest(value.statusManifest);

  if (Number(value.statusEntryCount || 0) > 0 && sourceManifest.length === 0) {
    reasons.push('source_status_manifest_missing');
  }
  if (current.commit && value.commit && current.commit !== value.commit) {
    reasons.push('commit_mismatch');
  }
  if (current.branch && value.branch && current.branch !== value.branch) {
    reasons.push('branch_mismatch');
  }
  if (String(current.upstream || '') !== String(value.upstream || '')) {
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

  const sourceCount = Number(value.statusEntryCount ?? sourceManifest.length);
  const currentCount = currentManifest.length;
  if (sourceCount !== currentCount && !reasons.includes('status_manifest_mismatch')) {
    reasons.push('status_count_mismatch');
  }

  return {
    current: current.available === true && reasons.length === 0,
    reasons,
    source: {
      commit: value.commit || '',
      branch: value.branch || '',
      upstream: value.upstream || '',
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

function sentryTriggerTargets(value) {
  return [
    value?.triggerTarget,
    value?.apiBaseUrl,
    value?.triggeredSmoke?.api?.url,
    value?.triggeredSmoke?.worker?.url,
  ]
    .map((target) => String(target || '').trim())
    .filter(Boolean);
}

function isImmutableImageRef(image) {
  return /@sha256:[0-9a-f]{64}$/i.test(String(image || '').trim());
}

function verifySourceControlEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'source.exists',
    'Source-control',
    config.paths.source,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'source.fresh', 'Source-control', artifact, value);

  const currency = compareSourceEvidenceToCurrent(value, config.root);
  if (currency.current === true) {
    recorder.pass(
      'source.current',
      'Source-control evidence matches current Git state',
      `status=${currency.currentGit.statusEntryCount}`,
    );
  } else if (config.strict) {
    recorder.fail(
      'source.current',
      'Source-control evidence must match current Git state',
      `${currency.reasons.join(', ') || 'unknown'}; artifactStatus=${currency.source.statusEntryCount} currentStatus=${currency.currentGit.statusEntryCount}`,
    );
  } else {
    recorder.warn(
      'source.current',
      'Source-control evidence does not match current Git state',
      `${currency.reasons.join(', ') || 'unknown'}; artifactStatus=${currency.source.statusEntryCount} currentStatus=${currency.currentGit.statusEntryCount}`,
    );
  }

  if (value.passed === true) {
    recorder.pass('source.passed', 'Source-control evidence gate passed');
  } else {
    recorder.softFail(
      config,
      'source.passed',
      'Source-control evidence gate did not pass',
      Array.isArray(value.validationFailures) ? value.validationFailures.join(', ') : 'missing validationFailures',
    );
  }

  const commit = String(value.commit || value.gitCommit || value.sha || '').trim();
  if (/^[0-9a-f]{40}$/i.test(commit)) {
    recorder.pass('source.commit', 'Source-control evidence has a release commit', commit);
  } else {
    recorder.softFail(config, 'source.commit', 'Source-control evidence is missing a full commit SHA');
  }

  const upstream = String(value.upstream || value.trackingBranch || '').trim();
  if (upstream) {
    recorder.pass('source.upstream', 'Source-control evidence has an upstream branch', upstream);
  } else {
    recorder.softFail(config, 'source.upstream', 'Source-control evidence is missing an upstream branch');
  }

  const aheadCount = Number(value.aheadCount ?? value.ahead ?? 0);
  const behindCount = Number(value.behindCount ?? value.behind ?? 0);
  if (value.upstreamSynced === true && aheadCount === 0 && behindCount === 0) {
    recorder.pass('source.upstreamSynced', 'Release branch is synced with upstream');
  } else {
    recorder.softFail(
      config,
      'source.upstreamSynced',
      'Release branch must be synced with upstream',
      `ahead=${Number.isFinite(aheadCount) ? aheadCount : 'unknown'} behind=${Number.isFinite(behindCount) ? behindCount : 'unknown'}`,
    );
  }

  const clean =
    value.clean === true &&
    value.dirty !== true &&
    Number(value.statusEntryCount || 0) === 0 &&
    Number(value.untrackedCount || 0) === 0 &&
    Number(value.trackedDirtyCount || 0) === 0;
  if (clean) {
    recorder.pass('source.clean', 'Git worktree was clean when evidence was generated');
  } else {
    recorder.softFail(
      config,
      'source.clean',
      'Git worktree must be clean for staging/production release evidence',
      `status=${value.statusEntryCount ?? 'unknown'} tracked=${value.trackedDirtyCount ?? 'unknown'} untracked=${value.untrackedCount ?? 'unknown'}`,
    );
  }
}

function verifyOperationalReadinessEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'ops.exists',
    'Operational readiness',
    config.paths.ops,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'ops.fresh', 'Operational readiness', artifact, value);

  if (value.passed === true) {
    recorder.pass('ops.passed', 'Operational readiness gate passed');
  } else {
    recorder.softFail(
      config,
      'ops.passed',
      'Operational readiness gate did not pass',
      Array.isArray(value.validationFailures)
        ? value.validationFailures.join(', ')
        : 'missing validationFailures',
    );
  }

  const environment = String(value.environment || '').trim().toLowerCase();
  if (environment === config.deployEnv) {
    recorder.pass('ops.environment', 'Operational readiness matches deploy environment', environment);
  } else {
    recorder.softFail(
      config,
      'ops.environment',
      'Operational readiness environment does not match deploy target',
      `artifact=${environment || 'missing'} deploy=${config.deployEnv}`,
    );
  }

  requireStringEvidence(
    config,
    recorder,
    value,
    'ops.releaseId',
    'Operational readiness has a release id',
    ['releaseId', 'release.id'],
  );
  requireStringEvidence(
    config,
    recorder,
    value,
    'ops.reviewer',
    'Operational readiness has a reviewer',
    ['reviewer', 'review.reviewer'],
  );
  requireStringEvidence(
    config,
    recorder,
    value,
    'ops.approver',
    'Operational readiness has an approver',
    ['approver', 'approval.approver'],
  );
  requireStringEvidence(
    config,
    recorder,
    value,
    'ops.approvalTicket',
    'Operational readiness has an approval ticket',
    ['approvalTicket', 'approval.ticket', 'approval.approvalTicket'],
  );

  const approvedAt = pickEvidenceValue(value, ['approvedAt', 'approval.approvedAt']);
  if (isIsoTimestamp(approvedAt)) {
    recorder.pass('ops.approvedAt', 'Operational approval has an ISO timestamp', approvedAt);
  } else {
    recorder.softFail(config, 'ops.approvedAt', 'Operational approval needs an ISO timestamp');
  }

  requireBooleanEvidence(
    config,
    recorder,
    value.infrastructure ?? {},
    'ops.bicepBuild',
    'Azure/Bicep build is validated',
    ['bicepBuildPassed'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    value.infrastructure ?? {},
    'ops.whatIf',
    'Azure what-if/plan is validated',
    ['whatIfPassed'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    value.infrastructure ?? {},
    'ops.privateNetworking',
    'Private networking posture is approved',
    ['privateNetworkingApproved'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    value.infrastructure ?? {},
    'ops.storage',
    'Object storage driver is validated',
    ['storageValidated'],
  );

  const database = value.database ?? {};
  requireBooleanEvidence(
    config,
    recorder,
    database,
    'ops.migrationJob',
    'Migration job is validated',
    ['migrationJobValidated'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    database,
    'ops.migrationDeploy',
    'Migration deploy path is validated',
    ['migrationDeployValidated'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    database,
    'ops.backupConfigured',
    'Database backups are configured',
    ['backupConfigured'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    database,
    'ops.geoBackup',
    'Geo-redundant backup is enabled or approved',
    ['geoRedundantBackup'],
  );

  const thresholds = value.thresholds ?? {};
  const minRetention = Number(thresholds.minBackupRetentionDays ?? 30);
  const retention = parseEvidenceNumber(database.backupRetentionDays);
  if (Number.isFinite(retention) && retention >= minRetention) {
    recorder.pass('ops.backupRetention', 'Database backup retention is release-grade', `${retention} days`);
  } else {
    recorder.softFail(
      config,
      'ops.backupRetention',
      'Database backup retention is too low',
      `retention=${Number.isFinite(retention) ? retention : 'missing'} min=${minRetention}`,
    );
  }

  const restoreDrillAt = String(database.restoreDrillAt || '').trim();
  if (isIsoTimestamp(restoreDrillAt)) {
    recorder.pass('ops.restoreDrillAt', 'Restore drill has an ISO timestamp', restoreDrillAt);
  } else {
    recorder.softFail(config, 'ops.restoreDrillAt', 'Restore drill timestamp is missing');
  }

  const maxRto = Number(thresholds.maxRestoreRtoMinutes ?? 240);
  const rto = parseEvidenceNumber(database.restoreRtoMinutes);
  if (Number.isFinite(rto) && rto <= maxRto) {
    recorder.pass('ops.restoreRto', 'Restore RTO is within release threshold', `${rto}m`);
  } else {
    recorder.softFail(
      config,
      'ops.restoreRto',
      'Restore RTO exceeds release threshold',
      `rto=${Number.isFinite(rto) ? rto : 'missing'} max=${maxRto}`,
    );
  }

  const maxRpo = Number(thresholds.maxRestoreRpoMinutes ?? 60);
  const rpo = parseEvidenceNumber(database.restoreRpoMinutes);
  if (Number.isFinite(rpo) && rpo <= maxRpo) {
    recorder.pass('ops.restoreRpo', 'Restore RPO is within release threshold', `${rpo}m`);
  } else {
    recorder.softFail(
      config,
      'ops.restoreRpo',
      'Restore RPO exceeds release threshold',
      `rpo=${Number.isFinite(rpo) ? rpo : 'missing'} max=${maxRpo}`,
    );
  }

  requireBooleanEvidence(
    config,
    recorder,
    value.rollback ?? {},
    'ops.rollbackRunbook',
    'Rollback runbook is reviewed',
    ['runbookReviewed'],
  );
  const rollbackDrillAt = String(value.rollback?.rollbackDrillAt || '').trim();
  if (isIsoTimestamp(rollbackDrillAt)) {
    recorder.pass('ops.rollbackDrillAt', 'Rollback drill has an ISO timestamp', rollbackDrillAt);
  } else {
    recorder.softFail(config, 'ops.rollbackDrillAt', 'Rollback drill timestamp is missing');
  }

  requireBooleanEvidence(
    config,
    recorder,
    value.monitoring ?? {},
    'ops.monitoringAlerts',
    'Monitoring alerts are validated',
    ['alertsValidated'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    value.monitoring ?? {},
    'ops.onCall',
    'On-call escalation is validated',
    ['onCallValidated'],
  );

  if (config.strict) {
    verifyOperationalEvidenceRefs(config, recorder, value);
  }
}

function verifyOperationalEvidenceRefs(config, recorder, value) {
  for (const check of OPS_EVIDENCE_REF_CHECKS) {
    requireStringEvidence(config, recorder, value, check.id, check.label, check.paths);
  }
}

function verifyLoadEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'load.exists',
    'Load certification',
    config.paths.load,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'load.fresh', 'Load certification', artifact, value);

  if (
    value.passed === true &&
    (value.commandExitCode === undefined || value.commandExitCode === 0)
  ) {
    recorder.pass(
      'load.passed',
      'Load command completed successfully',
      `profile=${value.profile ?? 'unknown'}`,
    );
  } else {
    recorder.softFail(
      config,
      'load.passed',
      'Load gate did not pass',
      `exit=${value.commandExitCode ?? 'unknown'}`,
    );
  }

  if (config.strict && value.strictEvidence !== true) {
    recorder.fail(
      'load.strictEvidence',
      'Load artifact must be generated by the strict evidence runner',
      `strictEvidence=${String(value.strictEvidence)}`,
    );
  } else if (value.strictEvidence === true) {
    recorder.pass('load.strictEvidence', 'Load artifact was generated in strict evidence mode');
  } else {
    recorder.warn(
      'load.strictEvidence',
      'Load artifact was not generated in strict evidence mode',
      `strictEvidence=${String(value.strictEvidence)}`,
    );
  }

  if (config.strict && value.profile !== 'certification') {
    recorder.fail(
      'load.profile',
      'Load profile must be certification for staging/production',
      `profile=${value.profile}`,
    );
  } else {
    recorder.pass(
      'load.profile',
      'Load profile is acceptable',
      `profile=${value.profile ?? 'unknown'}`,
    );
  }

  if (value.authenticatedRoutes === true) {
    recorder.pass('load.auth', 'Authenticated routes were exercised');
  } else {
    recorder.softFail(config, 'load.auth', 'Authenticated routes were not exercised');
  }

  if (config.strict && isLocalTarget(value.target)) {
    recorder.fail(
      'load.target',
      'Strict deploy evidence cannot target a local API',
      String(value.target || 'missing'),
    );
  } else if (value.target) {
    recorder.pass('load.target', 'Load target is acceptable', String(value.target));
  } else {
    recorder.softFail(config, 'load.target', 'Load target is missing');
  }

  const evidenceEnvironment = normalizeOptionalEnvironment(
    value.environment || value.deployEnv || value.k6Environment || '',
  );
  if (!config.strict || evidenceEnvironment === config.deployEnv) {
    recorder.pass(
      'load.environment',
      'Load certification environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'load.environment',
      'Load certification environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const rawSummaryPath = resolvePathInsideRoot(
    config.root,
    value.rawSummaryPath || value.k6SummaryPath || value.summaryPath || '',
  );
  if (
    value.rawSummaryFound === true &&
    rawSummaryPath.raw &&
    rawSummaryPath.insideRoot &&
    fileHasValidJson(rawSummaryPath.absolutePath)
  ) {
    recorder.pass('load.rawSummary', 'Load artifact has raw k6 summary proof', rawSummaryPath.raw);
  } else {
    recorder.softFail(
      config,
      'load.rawSummary',
      'Load raw k6 summary proof is missing, invalid, or outside the repo',
      rawSummaryPath.raw || 'missing',
    );
  }

  const thresholds = Array.isArray(value.thresholds) ? value.thresholds : [];
  const failingThresholds = thresholds.filter((threshold) => threshold?.ok !== true);
  if (thresholds.length > 0 && failingThresholds.length === 0) {
    recorder.pass(
      'load.thresholds',
      'All k6 thresholds passed',
      `${thresholds.length} threshold(s)`,
    );
  } else if (thresholds.length === 0) {
    recorder.softFail(config, 'load.thresholds', 'Load evidence has no threshold proof');
  } else {
    recorder.softFail(
      config,
      'load.thresholds',
      'One or more load thresholds failed',
      failingThresholds
        .map((threshold) => `${threshold.metric}:${threshold.expression}`)
        .join(', '),
    );
  }

  const metrics = value.metrics ?? {};
  const requiredMetricKeys = [
    'checksRate',
    'httpReqFailedRate',
    'httpReqDurationP95Ms',
    'httpRequests',
    'vusMax',
  ];
  const missingMetrics = requiredMetricKeys.filter(
    (key) => typeof metrics[key] !== 'number' || !Number.isFinite(metrics[key]),
  );
  if (missingMetrics.length === 0) {
    recorder.pass('load.metrics', 'Load artifact includes required k6 metrics');
  } else {
    recorder.softFail(
      config,
      'load.metrics',
      'Load artifact is missing required k6 metrics',
      missingMetrics.join(', '),
    );
  }

  if (typeof metrics.checksRate === 'number' && metrics.checksRate < 0.99) {
    recorder.softFail(
      config,
      'load.checks',
      'Load checks rate is below 99%',
      String(metrics.checksRate),
    );
  }
  if (typeof metrics.httpReqFailedRate === 'number' && metrics.httpReqFailedRate >= 0.01) {
    recorder.softFail(
      config,
      'load.failures',
      'HTTP failure rate is too high',
      String(metrics.httpReqFailedRate),
    );
  }
  if (typeof metrics.httpReqDurationP95Ms === 'number' && metrics.httpReqDurationP95Ms >= 500) {
    recorder.softFail(
      config,
      'load.p95',
      'p95 latency is above 500ms',
      `${metrics.httpReqDurationP95Ms}ms`,
    );
  }
}

function verifySemgrepEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'semgrep.exists',
    'Semgrep SAST',
    config.paths.semgrep,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'semgrep.fresh', 'Semgrep SAST', artifact, value);

  if (config.strict) {
    const scanner = String(value.scanner || '').trim().toLowerCase();
    if (scanner === 'semgrep') {
      recorder.pass('semgrep.scanner', 'Semgrep artifact identifies the scanner', scanner);
    } else {
      recorder.fail(
        'semgrep.scanner',
        'Strict Semgrep evidence must identify the scanner',
        scanner || 'missing',
      );
    }

    const image = String(value.image || value.semgrepImage || '').trim();
    if (/^semgrep\/semgrep:[^:]+$/i.test(image) && !/:latest$/i.test(image)) {
      recorder.pass('semgrep.image', 'Semgrep evidence uses a pinned Docker image', image);
    } else {
      recorder.fail(
        'semgrep.image',
        'Strict Semgrep evidence must record a pinned Semgrep Docker image',
        image || 'missing',
      );
    }

    const configs = normalizeList(value.configs);
    if (configs.length > 0) {
      recorder.pass('semgrep.configs', 'Semgrep evidence records scan configs', configs.join(', '));
    } else {
      recorder.fail('semgrep.configs', 'Strict Semgrep evidence must record scan configs');
    }

    const severities = normalizeList(value.severities).map((severity) => severity.toUpperCase());
    const blocksConfiguredSeverity = severities.some((severity) =>
      config.semgrepBlockingSeverities.includes(severity),
    );
    if (severities.length > 0 && blocksConfiguredSeverity) {
      recorder.pass(
        'semgrep.severities',
        'Semgrep evidence records blocking severities',
        severities.join(', '),
      );
    } else {
      recorder.fail(
        'semgrep.severities',
        'Strict Semgrep evidence must record blocking severities',
        severities.join(', ') || 'missing',
      );
    }

    const mirroredFileCount = Number(value.mirroredFileCount ?? value.scannedFileCount ?? 0);
    if (Number.isFinite(mirroredFileCount) && mirroredFileCount > 0) {
      recorder.pass(
        'semgrep.coverage',
        'Semgrep evidence records scanned source coverage',
        `${mirroredFileCount} file(s)`,
      );
    } else {
      recorder.fail(
        'semgrep.coverage',
        'Strict Semgrep evidence must record scanned source coverage',
        `mirroredFileCount=${String(value.mirroredFileCount ?? 'missing')}`,
      );
    }

    if (Number(value.commandExitCode) === 0) {
      recorder.pass('semgrep.command', 'Semgrep command exited successfully');
    } else {
      recorder.fail(
        'semgrep.command',
        'Strict Semgrep evidence must record a successful command exit',
        `exit=${String(value.commandExitCode ?? 'missing')}`,
      );
    }

    if (Array.isArray(value.results) && Array.isArray(value.errors)) {
      recorder.pass('semgrep.reportShape', 'Semgrep evidence preserves raw result and error arrays');
    } else {
      recorder.fail(
        'semgrep.reportShape',
        'Strict Semgrep evidence must preserve raw result and error arrays',
      );
    }

    const dockerfileSyntaxCheck =
      value.dockerfileSyntaxCheck && typeof value.dockerfileSyntaxCheck === 'object'
        ? value.dockerfileSyntaxCheck
        : {};
    if (dockerfileSyntaxCheck.checked === true && dockerfileSyntaxCheck.passed === true) {
      recorder.pass('semgrep.dockerfileSyntax', 'Dockerfile syntax check passed with Semgrep evidence');
    } else {
      recorder.fail(
        'semgrep.dockerfileSyntax',
        'Strict Semgrep evidence must include a passing Dockerfile syntax check',
        `checked=${String(dockerfileSyntaxCheck.checked)} passed=${String(dockerfileSyntaxCheck.passed)}`,
      );
    }
  }

  if (value.passed === false) {
    recorder.softFail(
      config,
      'semgrep.passed',
      'Semgrep SAST did not pass',
      `exit=${value.commandExitCode ?? 'unknown'}`,
    );
  }

  const results = Array.isArray(value.results) ? value.results : [];
  const blockingSeverities = new Set(config.semgrepBlockingSeverities);
  const blockingFindings = results.filter((finding) =>
    blockingSeverities.has(
      String(finding?.extra?.severity ?? finding?.severity ?? '').toUpperCase(),
    ),
  );
  const errors = Array.isArray(value.errors) ? value.errors : [];

  if (value.passed === true && Number(value.blockingFindings ?? 0) === 0 && errors.length === 0) {
    recorder.pass('semgrep.findings', 'Semgrep blocking findings are zero');
    return;
  }

  if (errors.length > 0) {
    recorder.softFail(
      config,
      'semgrep.errors',
      'Semgrep report contains scanner errors',
      `${errors.length} error(s)`,
    );
  }

  if (blockingFindings.length === 0) {
    recorder.pass(
      'semgrep.findings',
      'Semgrep blocking findings are zero',
      `${results.length} total result(s)`,
    );
  } else {
    recorder.softFail(
      config,
      'semgrep.findings',
      'Semgrep blocking findings remain',
      `${blockingFindings.length} ${config.semgrepBlockingSeverities.join('/')} finding(s)`,
    );
  }
}

function verifyContainerEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'container.exists',
    'Container scan',
    config.paths.container,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'container.fresh', 'Container scan', artifact, value);

  const reports = Array.isArray(value) ? value : Array.isArray(value.images) ? value.images : [];
  const missingImagesFromArtifact = Array.isArray(value.missingImages)
    ? value.missingImages.map(String).filter(Boolean)
    : [];

  if (value.passed === false) {
    recorder.softFail(
      config,
      'container.passed',
      'Container scan did not pass',
      `exit=${value.commandExitCode ?? 'unknown'}`,
    );
  }

  if (config.strict && value.strictEvidence !== true) {
    recorder.fail(
      'container.strictEvidence',
      'Container artifact must be generated by the strict evidence runner',
      `strictEvidence=${String(value.strictEvidence)}`,
    );
  } else if (value.strictEvidence === true) {
    recorder.pass(
      'container.strictEvidence',
      'Container artifact was generated in strict evidence mode',
    );
  } else {
    recorder.warn(
      'container.strictEvidence',
      'Container artifact was not generated in strict evidence mode',
      `strictEvidence=${String(value.strictEvidence)}`,
    );
  }

  const evidenceEnvironment = normalizeOptionalEnvironment(
    value.environment || value.deployEnv || '',
  );
  if (!config.strict || evidenceEnvironment === config.deployEnv) {
    recorder.pass(
      'container.environment',
      'Container scan environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'container.environment',
      'Container scan environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const requestedImageRefs = normalizeList(value.requestedImages);
  const reportedImageRefs = normalizeList(reports.map((report) => report?.image));
  const scannedImageRefs = requestedImageRefs.length > 0 ? requestedImageRefs : reportedImageRefs;
  const mutableImageRefs = scannedImageRefs.filter((image) => !isImmutableImageRef(image));
  if (config.strict && mutableImageRefs.length > 0) {
    recorder.fail(
      'container.immutableRefs',
      'Strict container scan must use immutable image digest references',
      mutableImageRefs.join(', '),
    );
  } else if (scannedImageRefs.length > 0) {
    recorder.pass(
      'container.immutableRefs',
      'Container image references are immutable',
      `${scannedImageRefs.length} image ref(s)`,
    );
  } else {
    recorder.softFail(config, 'container.immutableRefs', 'Container scan image references are missing');
  }

  if (missingImagesFromArtifact.length > 0) {
    recorder.softFail(
      config,
      'container.missingImages',
      'Container scan could not inspect every requested image',
      missingImagesFromArtifact.join(', '),
    );
  }

  if (config.strict) {
    const missingRawReportImages = reports
      .map((report) => {
        const proofPath = resolvePathInsideRoot(
          config.root,
          report?.rawReportPath || report?.trivyReportPath || report?.sourceReport || '',
        );
        return {
          image: report?.image || 'unknown-image',
          proofPath,
          valid:
            Boolean(proofPath.raw) &&
            proofPath.insideRoot &&
            fileHasValidJson(proofPath.absolutePath),
        };
      })
      .filter((item) => !item.valid)
      .map((item) => item.image);

    if (reports.length === 0 || missingRawReportImages.length > 0) {
      recorder.fail(
        'container.rawReports',
        'Strict container evidence needs raw Trivy JSON reports',
        missingRawReportImages.length > 0 ? missingRawReportImages.join(', ') : 'missing image reports',
      );
    } else {
      recorder.pass(
        'container.rawReports',
        'Container scan has raw Trivy JSON report proof',
        `${reports.length} raw report(s)`,
      );
    }
  }

  if (
    reports.length === 0 &&
    !config.strict &&
    value.passed === true &&
    Number(value.blockingFindings ?? value.findings ?? 0) === 0
  ) {
    recorder.pass('container.findings', 'Container blocking findings are zero');
    return;
  }

  const vulnerabilities = reports.flatMap((report) =>
    Array.isArray(report?.vulnerabilities)
      ? report.vulnerabilities.map((vulnerability) => ({ image: report.image, vulnerability }))
      : [],
  );
  if (config.strict && reports.length === 0) {
    recorder.fail(
      'container.findings',
      'Container scan has no image reports to inspect',
      'strict evidence requires at least one scanned image report',
    );
  } else if (vulnerabilities.length === 0) {
    recorder.pass(
      'container.findings',
      'Container blocking findings are zero',
      `${reports.length} image report(s)`,
    );
  } else {
    recorder.softFail(
      config,
      'container.findings',
      'Container scan still has blocking vulnerabilities',
      `${vulnerabilities.length} finding(s)`,
    );
  }

  if (config.strict) {
    const reportedImages = new Set(reports.map((report) => report?.image).filter(Boolean));
    const missingImages = config.requiredImages.filter((image) => !reportedImages.has(image));
    if (missingImages.length > 0) {
      recorder.fail(
        'container.coverage',
        'Container scan is missing required deploy images',
        missingImages.join(', '),
      );
    } else {
      recorder.pass('container.coverage', 'Container scan covers all required deploy images');
    }
  }
}

function verifySecretEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'secrets.exists',
    'Secret scan disposition',
    config.paths.secrets,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'secrets.fresh', 'Secret scan disposition', artifact, value);

  requireBooleanEvidence(
    config,
    recorder,
    value,
    'secrets.currentTree',
    'Current tree secret scan is clean',
    ['currentTreeClean', 'trackedTreeClean', 'secretScanPassed'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    value,
    'secrets.currentCommit',
    'Current commit gitleaks snapshot is clean',
    ['currentCommitGitleaksClean', 'currentGitleaksClean'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    value,
    'secrets.fullHistoryReviewed',
    'Full-history secret findings were reviewed',
    ['fullHistoryReviewed', 'fullHistoryGitleaksReviewed'],
  );
  if (config.strict) {
    verifySecretRawReports(config, recorder, value);
  }

  const historicalFindingsCount = Number(
    value.historicalFindingsCount ?? value.fullHistoryFindings,
  );
  const historyIsClean =
    value.fullHistoryClean === true ||
    (Number.isFinite(historicalFindingsCount) && historicalFindingsCount === 0);
  if (historyIsClean) {
    recorder.pass(
      'secrets.historyDisposition',
      'Full git history has no unresolved secret findings',
    );
  } else {
    requireBooleanEvidence(
      config,
      recorder,
      value,
      'secrets.historyDisposition',
      'Historical credentials were rotated or revoked',
      ['historicalFindingsRotatedOrRevoked', 'rotatedHistoricalCredentials'],
    );
    requireBooleanEvidence(
      config,
      recorder,
      value,
      'secrets.ownerDisposition',
      'Owner approved the history disposition',
      ['ownerApprovedDisposition', 'securityOwnerApprovedDisposition'],
    );
    const ownerApprover = String(
      value.ownerApprover || value.securityOwnerApprover || value.ownerApprovedBy || '',
    ).trim();
    if (ownerApprover && !hasPlaceholderSignal(ownerApprover)) {
      recorder.pass('secrets.ownerApprover', 'Secret disposition has a named owner approver', ownerApprover);
    } else {
      recorder.softFail(
        config,
        'secrets.ownerApprover',
        'Secret history disposition needs a named owner approver',
        ownerApprover ? 'value looks like a placeholder' : '',
      );
    }

    const approvalTicket = String(
      value.ownerApprovalTicket || value.securityOwnerApprovalTicket || value.approvalTicket || '',
    ).trim();
    if (approvalTicket && !hasPlaceholderSignal(approvalTicket)) {
      recorder.pass('secrets.ownerApprovalTicket', 'Secret disposition has an owner approval ticket', approvalTicket);
    } else {
      recorder.softFail(
        config,
        'secrets.ownerApprovalTicket',
        'Secret history disposition needs an owner approval ticket or reference',
        approvalTicket ? 'value looks like a placeholder' : '',
      );
    }

    const ownerApprovedAt = String(
      value.ownerApprovedAt || value.securityOwnerApprovedAt || value.approvedAt || '',
    ).trim();
    if (isIsoTimestamp(ownerApprovedAt)) {
      recorder.pass('secrets.ownerApprovedAt', 'Secret owner approval has an ISO timestamp', ownerApprovedAt);
    } else {
      recorder.softFail(
        config,
        'secrets.ownerApprovedAt',
        'Secret owner approval needs an ISO ownerApprovedAt timestamp',
      );
    }

    const rotationVerifiedAt = String(
      value.rotationVerifiedAt || value.historicalFindingsRotatedAt || value.rotatedAt || '',
    ).trim();
    if (isIsoTimestamp(rotationVerifiedAt)) {
      recorder.pass('secrets.rotationVerifiedAt', 'Historical secret rotation has an ISO timestamp', rotationVerifiedAt);
    } else {
      recorder.softFail(
        config,
        'secrets.rotationVerifiedAt',
        'Historical secret rotation/revocation needs an ISO rotationVerifiedAt timestamp',
      );
    }
  }

  const reviewer = String(value.reviewer || value.securityReviewer || '').trim();
  if (reviewer && !hasPlaceholderSignal(reviewer)) {
    recorder.pass('secrets.reviewer', 'Secret disposition has a named reviewer', reviewer);
  } else {
    recorder.softFail(
      config,
      'secrets.reviewer',
      'Secret disposition needs a named reviewer',
      reviewer ? 'value looks like a placeholder' : '',
    );
  }
}

function getCommandByScanner(value, scanner) {
  const commands = Array.isArray(value?.commands) ? value.commands : [];
  return commands.find((command) => command?.scanner === scanner) || null;
}

function pickSecretRawReportPath(value, rawKey, scanner, aliases = []) {
  const rawReports = value?.rawReports && typeof value.rawReports === 'object' ? value.rawReports : {};
  const command = getCommandByScanner(value, scanner);
  const candidates = [
    rawReports[rawKey],
    command?.rawReportPath,
    command?.reportPath,
    ...aliases.map((alias) => value?.[alias]),
  ];
  return candidates.find((candidate) => String(candidate || '').trim()) || '';
}

function verifySecretJsonReport(config, recorder, id, label, rawPathValue) {
  const proofPath = resolvePathInsideRoot(config.root, rawPathValue);
  if (proofPath.raw && proofPath.insideRoot && fileHasValidJson(proofPath.absolutePath)) {
    recorder.pass(id, label, proofPath.raw);
    return;
  }
  recorder.fail(
    id,
    label,
    proofPath.raw ? 'raw report path is missing, outside the repo, or invalid JSON' : 'missing raw report path',
  );
}

function verifySecretRawReports(config, recorder, value) {
  verifySecretJsonReport(
    config,
    recorder,
    'secrets.currentCommitRawReport',
    'Current commit Gitleaks scan has raw JSON proof',
    pickSecretRawReportPath(value, 'currentCommit', 'gitleaks-current-commit', [
      'currentCommitRawReportPath',
      'currentGitleaksRawReportPath',
    ]),
  );

  const fullHistoryCommand = getCommandByScanner(value, 'gitleaks-full-history');
  const needsFullHistoryRawReport =
    value.fullHistoryReviewed === true ||
    value.fullHistoryGitleaksReviewed === true ||
    String(value.fullHistoryReviewMethod || '').trim() === 'gitleaks-full-history' ||
    Boolean(fullHistoryCommand);

  if (needsFullHistoryRawReport) {
    verifySecretJsonReport(
      config,
      recorder,
      'secrets.fullHistoryRawReport',
      'Full-history Gitleaks scan has raw JSON proof',
      pickSecretRawReportPath(value, 'fullHistory', 'gitleaks-full-history', [
        'fullHistoryRawReportPath',
        'fullHistoryGitleaksRawReportPath',
      ]),
    );
  }
}

function verifySentryEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'sentry.exists',
    'Sentry smoke',
    config.paths.sentry,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'sentry.fresh', 'Sentry smoke', artifact, value);

  requireBooleanEvidence(config, recorder, value, 'sentry.dsn', 'Sentry DSN is configured', [
    'dsnConfigured',
  ]);
  requireBooleanEvidence(
    config,
    recorder,
    value,
    'sentry.api5xx',
    'API 5xx smoke event was observed',
    ['api5xxSmokeObserved', 'apiErrorSmokeObserved'],
  );
  requireBooleanEvidence(
    config,
    recorder,
    value,
    'sentry.worker',
    'Worker failure smoke event was observed',
    ['workerFailureObserved', 'workerErrorSmokeObserved'],
  );

  const release = String(value.release || '').trim();
  if (release) {
    recorder.pass('sentry.release', 'Sentry smoke is tied to a release', release);
  } else {
    recorder.softFail(config, 'sentry.release', 'Sentry smoke evidence needs a release');
  }

  const evidenceEnvironment = normalizeOptionalEnvironment(
    value.environment || value.sentryEnvironment || '',
  );
  if (!config.strict || evidenceEnvironment === config.deployEnv) {
    recorder.pass(
      'sentry.environment',
      'Sentry smoke environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'sentry.environment',
      'Sentry smoke environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const triggerTargets = sentryTriggerTargets(value);
  const localTriggerTargets = triggerTargets.filter((target) => isLocalTarget(target));
  const placeholderTriggerTargets = triggerTargets.filter((target) => hasPlaceholderSignal(target));
  if (!config.strict) {
    recorder.pass(
      'sentry.target',
      'Sentry smoke trigger target is acceptable',
      triggerTargets.join(', ') || 'unspecified',
    );
  } else if (triggerTargets.length === 0) {
    recorder.fail('sentry.target', 'Sentry smoke trigger target is missing');
  } else if (localTriggerTargets.length > 0) {
    recorder.fail(
      'sentry.target',
      'Strict Sentry smoke evidence cannot target a local API',
      localTriggerTargets.join(', '),
    );
  } else if (placeholderTriggerTargets.length > 0) {
    recorder.fail(
      'sentry.target',
      'Strict Sentry smoke evidence cannot target a placeholder API',
      placeholderTriggerTargets.join(', '),
    );
  } else {
    recorder.pass(
      'sentry.target',
      'Sentry smoke trigger target is acceptable',
      triggerTargets.join(', '),
    );
  }

  if (value.sendDefaultPii === false || value.piiScrubberEnabled === true) {
    recorder.pass('sentry.privacy', 'Sentry privacy controls are enabled');
  } else {
    recorder.softFail(config, 'sentry.privacy', 'Sentry privacy controls are not proven');
  }

  if (value.sessionReplayEnabled === true) {
    requireBooleanEvidence(
      config,
      recorder,
      value,
      'sentry.replayApproval',
      'Session replay has legal approval',
      ['legalApproval', 'sessionReplayApproved'],
    );
  } else {
    recorder.pass('sentry.replayApproval', 'Session replay is disabled or not in scope');
  }
}

function verifyProviderQualityEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'providers.exists',
    'Provider source quality',
    config.paths.providers,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'providers.fresh', 'Provider source quality', artifact, value);

  if (value.passed === true) {
    recorder.pass('providers.passed', 'Provider source quality gate passed');
  } else {
    recorder.softFail(
      config,
      'providers.passed',
      'Provider source quality gate did not pass',
      Array.isArray(value.validationFailures)
        ? value.validationFailures.join(', ')
        : 'missing validationFailures',
    );
  }

  const evidenceEnvironment = normalizeOptionalEnvironment(
    value.environment || value.deployEnv || '',
  );
  if (!config.strict || evidenceEnvironment === config.deployEnv) {
    recorder.pass(
      'providers.environment',
      'Provider source quality environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'providers.environment',
      'Provider source quality environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const command = value.command && typeof value.command === 'object' ? value.command : {};
  if (command.ok === true) {
    recorder.pass('providers.command', 'Provider refresh command succeeded');
  } else {
    recorder.softFail(
      config,
      'providers.command',
      'Provider refresh command did not succeed',
      String(command.error || command.status || 'missing command result'),
    );
  }

  if (config.strict && command.source !== 'live-refresh') {
    recorder.fail(
      'providers.liveRefresh',
      'Strict deploy provider evidence must come from a live refresh',
      `source=${command.source || 'missing'}`,
    );
  } else {
    recorder.pass(
      'providers.liveRefresh',
      'Provider evidence source is acceptable',
      `source=${command.source || 'missing'}`,
    );
  }

  if (config.strict && isLocalTarget(value.target)) {
    recorder.fail(
      'providers.target',
      'Strict deploy provider evidence cannot target a local API',
      String(value.target || 'missing'),
    );
  } else if (config.strict && hasPlaceholderSignal(value.target)) {
    recorder.fail(
      'providers.target',
      'Strict deploy provider evidence cannot target a placeholder API',
      String(value.target || 'missing'),
    );
  } else if (value.target) {
    recorder.pass('providers.target', 'Provider quality target is acceptable', String(value.target));
  } else {
    recorder.softFail(config, 'providers.target', 'Provider quality target is missing');
  }

  const companyKey = String(value.companyKey || '').trim();
  if (companyKey && !hasPlaceholderSignal(companyKey)) {
    recorder.pass('providers.companyKey', 'Provider quality company key is recorded', companyKey);
  } else {
    recorder.softFail(
      config,
      'providers.companyKey',
      'Provider quality company key is missing or placeholder',
      companyKey ? 'value looks like a placeholder' : '',
    );
  }

  const providerChecks = Array.isArray(value.providerChecks) ? value.providerChecks : [];
  const checkById = new Map(providerChecks.map((check) => [String(check?.id || ''), check]));
  const missingProviders = config.requiredProviders.filter((provider) => !checkById.has(provider));
  if (missingProviders.length === 0) {
    recorder.pass(
      'providers.required',
      'Provider quality checks cover required source lanes',
      config.requiredProviders.join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'providers.required',
      'Provider quality checks are missing required source lanes',
      missingProviders.join(', '),
    );
  }

  const failingProviders = config.requiredProviders
    .map((provider) => checkById.get(provider))
    .filter((check) => check && check.passed !== true);
  if (failingProviders.length === 0 && missingProviders.length === 0) {
    recorder.pass('providers.lanes', 'Required provider lanes passed quality checks');
  } else {
    recorder.softFail(
      config,
      'providers.lanes',
      'One or more required provider lanes failed quality checks',
      failingProviders
        .map((check) =>
          `${check.id}: ${
            Array.isArray(check.failures) && check.failures.length > 0
              ? check.failures.join('; ')
              : 'provider check failed'
          }`,
        )
        .concat(missingProviders.map((provider) => `${provider}: missing`))
        .join(', '),
    );
  }

  const responseProviders = new Set(
    (Array.isArray(value.responseSummary?.providers) ? value.responseSummary.providers : [])
      .map((provider) => String(provider?.id || ''))
      .filter(Boolean),
  );
  const missingResponseProviders = config.requiredProviders.filter(
    (provider) => !responseProviders.has(provider),
  );
  if (missingResponseProviders.length === 0) {
    recorder.pass('providers.responseLanes', 'Provider refresh response includes required lanes');
  } else {
    recorder.softFail(
      config,
      'providers.responseLanes',
      'Provider refresh response is missing required lanes',
      missingResponseProviders.join(', '),
    );
  }

  const expectedTechIntelSources =
    config.requiredTechIntelSources.length > 0
      ? config.requiredTechIntelSources
      : normalizeList(value.expectedTechIntelSources);
  if (expectedTechIntelSources.length > 0) {
    const placeholderSources = expectedTechIntelSources.filter((source) =>
      hasPlaceholderSignal(source),
    );
    if (placeholderSources.length > 0) {
      recorder.softFail(
        config,
        'providers.techIntelSources',
        'Provider quality Tech Intel source requirements contain placeholders',
        placeholderSources.join(', '),
      );
      return;
    }
    const observedTechIntelSources = [
      ...(Array.isArray(value.techIntelSources) ? value.techIntelSources : []),
      ...providerChecks.flatMap((check) =>
        check?.id === 'tech_intel' && Array.isArray(check.observedSources)
          ? check.observedSources
          : [],
      ),
    ].flatMap((source) => [source?.label, source?.sourceKey]);
    const missingTechIntelSources = containsAll(
      observedTechIntelSources,
      expectedTechIntelSources,
      normalizeTechIntelSource,
    );
    if (missingTechIntelSources.length === 0) {
      recorder.pass(
        'providers.techIntelSources',
        'Provider quality covers required Tech Intel MCP sources',
        expectedTechIntelSources.join(', '),
      );
    } else {
      recorder.softFail(
        config,
        'providers.techIntelSources',
        'Provider quality is missing required Tech Intel MCP sources',
        missingTechIntelSources.join(', '),
      );
    }
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSpec(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

function containsAll(actualValues, requiredValues, normalizer = (value) => String(value).trim()) {
  const actual = new Set(actualValues.map((value) => normalizer(value)).filter(Boolean));
  return requiredValues.filter((value) => !actual.has(normalizer(value)));
}

function normalizeTechIntelSource(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\btechnologies\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function verifyBrowserEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'browser.exists',
    'Cross-role browser regression',
    config.paths.browser,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(
    config,
    recorder,
    'browser.fresh',
    'Cross-role browser regression',
    artifact,
    value,
  );

  if (
    value.passed === true &&
    (value.commandExitCode === undefined || value.commandExitCode === 0)
  ) {
    recorder.pass(
      'browser.passed',
      'Browser regression gate passed',
      `profile=${value.profile ?? 'unknown'}`,
    );
  } else {
    recorder.softFail(
      config,
      'browser.passed',
      'Browser regression gate did not pass',
      `exit=${value.commandExitCode ?? 'unknown'}`,
    );
  }

  if (config.strict && !ACCEPTED_BROWSER_PROFILES.has(String(value.profile || ''))) {
    recorder.fail(
      'browser.profile',
      'Browser regression profile must be cross-role or release regression',
      `profile=${value.profile ?? 'missing'}`,
    );
  } else {
    recorder.pass(
      'browser.profile',
      'Browser regression profile is acceptable',
      `profile=${value.profile ?? 'unknown'}`,
    );
  }

  if (config.strict && isLocalTarget(value.target || value.baseURL || value.webBaseUrl || '')) {
    recorder.fail(
      'browser.target',
      'Strict deploy browser evidence cannot target a local app',
      String(value.target || value.baseURL || value.webBaseUrl || 'missing'),
    );
  } else if (value.target || value.baseURL || value.webBaseUrl) {
    recorder.pass(
      'browser.target',
      'Browser target is acceptable',
      String(value.target || value.baseURL || value.webBaseUrl),
    );
  } else {
    recorder.softFail(config, 'browser.target', 'Browser target is missing');
  }

  const evidenceEnvironment = normalizeOptionalEnvironment(
    value.environment || value.deployEnv || value.e2eEnvironment || '',
  );
  if (!config.strict || evidenceEnvironment === config.deployEnv) {
    recorder.pass(
      'browser.environment',
      'Browser regression environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'browser.environment',
      'Browser regression environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  if (value.productionBuild === true) {
    recorder.pass('browser.productionBuild', 'Browser regression used a production build');
  } else {
    recorder.softFail(
      config,
      'browser.productionBuild',
      'Browser regression did not prove production build coverage',
    );
  }

  if (value.clerkBackedAuth === true || String(value.authMode || '').toLowerCase() === 'clerk') {
    recorder.pass('browser.auth', 'Browser regression used Clerk-backed auth');
  } else {
    recorder.softFail(config, 'browser.auth', 'Browser regression did not prove Clerk-backed auth');
  }

  const sourceReportPath = resolvePathInsideRoot(
    config.root,
    value.sourceReport || value.playwrightJsonReport || value.reportPath || '',
  );
  if (sourceReportPath.raw && sourceReportPath.insideRoot && fileHasValidJson(sourceReportPath.absolutePath)) {
    recorder.pass('browser.sourceReport', 'Browser regression has a Playwright JSON source report', sourceReportPath.raw);
  } else {
    recorder.softFail(
      config,
      'browser.sourceReport',
      'Browser regression source report is missing, invalid, or outside the repo',
      sourceReportPath.raw || 'missing',
    );
  }

  const playwrightCommand = String(
    value.playwrightCommand || value.command || value.commandText || '',
  ).trim();
  const commandLooksLikePlaywright = /\bplaywright(?:\.cmd)?\b/i.test(playwrightCommand) &&
    /\btest\b/i.test(playwrightCommand);
  if (commandLooksLikePlaywright) {
    recorder.pass('browser.command', 'Browser regression records the Playwright test command', playwrightCommand);
  } else {
    recorder.softFail(
      config,
      'browser.command',
      'Browser regression does not record a Playwright test command',
      playwrightCommand || 'missing',
    );
  }

  const roles = normalizeList(value.roles ?? value.personas ?? value.coveredRoles);
  const missingRoles = containsAll(roles, config.requiredBrowserRoles);
  if (missingRoles.length === 0) {
    recorder.pass('browser.roles', 'Browser regression covers required personas', roles.join(', '));
  } else {
    recorder.softFail(
      config,
      'browser.roles',
      'Browser regression is missing required personas',
      missingRoles.join(', '),
    );
  }

  const projects = normalizeList(value.projects ?? value.browsers ?? value.browserProjects);
  const missingProjects = containsAll(projects, config.requiredBrowserProjects);
  if (missingProjects.length === 0) {
    recorder.pass(
      'browser.projects',
      'Browser regression covers required browser projects',
      projects.join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'browser.projects',
      'Browser regression is missing required browser projects',
      missingProjects.join(', '),
    );
  }

  const specs = normalizeList(value.specs ?? value.testFiles ?? value.files);
  const missingSpecs = containsAll(specs, config.requiredBrowserSpecs, normalizeSpec);
  if (missingSpecs.length === 0) {
    recorder.pass(
      'browser.specs',
      'Browser regression covers required specs',
      specs.map(normalizeSpec).join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'browser.specs',
      'Browser regression is missing required specs',
      missingSpecs.join(', '),
    );
  }

  const tests = value.tests && typeof value.tests === 'object' ? value.tests : {};
  const failed = Number(tests.failed ?? value.failed ?? value.failures ?? 0);
  const unknown = Number(tests.unknown ?? value.unknown ?? value.unknownTests ?? 0);
  const passed = Number(tests.passed ?? value.passedTests ?? value.testsPassed ?? 0);
  if (
    Number.isFinite(failed) &&
    failed === 0 &&
    Number.isFinite(unknown) &&
    unknown === 0 &&
    Number.isFinite(passed) &&
    passed > 0
  ) {
    recorder.pass(
      'browser.tests',
      'Browser regression has passing tests and zero failed or unknown outcomes',
      `${passed} passed`,
    );
  } else {
    recorder.softFail(
      config,
      'browser.tests',
      'Browser regression test counts are not release-clean',
      `passed=${Number.isFinite(passed) ? passed : 'unknown'} failed=${Number.isFinite(failed) ? failed : 'unknown'} unknown=${Number.isFinite(unknown) ? unknown : 'unknown'}`,
    );
  }
}

function pickEvidenceValue(source, keys) {
  for (const key of keys) {
    const value = String(key)
      .split('.')
      .reduce(
        (current, segment) => (current && typeof current === 'object' ? current[segment] : undefined),
        source,
      );
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function parseEvidenceNumber(value) {
  if (value === undefined || value === null || value === '') {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

const PLACEHOLDER_EXACT_VALUES = new Set([
  'abc123',
  'change-me',
  'changeme',
  'dummy',
  'example',
  'fake',
  'ops-123',
  'ops-1234',
  'release-api-token',
  'release-token',
  'sample',
  'sec-123',
  'sec-1234',
  'super-secret',
  'super-secret-token',
  'ticket-123',
  'todo',
]);

function hasPlaceholderSignal(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    PLACEHOLDER_EXACT_VALUES.has(normalized) ||
    /<[^>]+>|\bexample\b|\bplaceholder\b|\breplace[-_ ]?me\b|\bsample\b|\btodo\b|\byour[-_ ]/i.test(normalized)
  );
}

function requireStringEvidence(config, recorder, value, id, label, keys) {
  const evidence = pickEvidenceValue(value, keys);
  if (evidence && !hasPlaceholderSignal(evidence)) {
    recorder.pass(id, label, evidence);
  } else {
    recorder.softFail(
      config,
      id,
      label,
      evidence ? 'value looks like a placeholder' : `expected one of: ${keys.join(', ')}`,
    );
  }
}

function requireBooleanEvidence(config, recorder, value, id, label, keys) {
  const matchedKey = keys.find((key) => value[key] === true);
  if (matchedKey) {
    recorder.pass(id, label, matchedKey);
  } else {
    recorder.softFail(config, id, label, `expected one of: ${keys.join(', ')}`);
  }
}

function findToolCheck(checks, id) {
  return checks.find((check) => check && check.id === id);
}

function checkUsesDocker(check) {
  const text = [check?.label, check?.detail, check?.version]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    text.includes('docker fallback') ||
    text.includes('docker runner') ||
    text.includes('runs in docker') ||
    text.includes('runs through docker') ||
    text.includes('docker evidence')
  );
}

function requiredToolImageProbes(checks) {
  return TOOL_DOCKER_IMAGE_PROBES.filter((probe) => {
    const runner = findToolCheck(checks, probe.runnerId);
    if (!runner || runner.passed !== true) return false;
    return probe.alwaysDocker || checkUsesDocker(runner);
  });
}

function hasExecutedRequiredToolImageProbe(checks, imageId) {
  const probe = findToolCheck(checks, imageId);
  return probe?.required === true && probe.passed === true && probe.skipped !== true;
}

function verifyToolReadinessEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'tools.exists',
    'Release tool readiness',
    config.paths.tools,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'tools.fresh', 'Release tool readiness', artifact, value);

  if (value.passed === true && Array.isArray(value.checks)) {
    recorder.pass('tools.passed', 'Release tool readiness gate passed');
  } else {
    recorder.softFail(
      config,
      'tools.passed',
      'Release tool readiness gate did not pass',
      Array.isArray(value.blockingFailures)
        ? value.blockingFailures.join(', ')
        : 'missing blockingFailures',
    );
  }

  const checks = Array.isArray(value.checks) ? value.checks : [];
  const requiredFailures = checks.filter(
    (check) => check?.required === true && check?.passed !== true,
  );
  if (requiredFailures.length === 0 && checks.length > 0) {
    recorder.pass('tools.required', 'All required release tools are available', `${checks.length} check(s)`);
  } else if (checks.length === 0) {
    recorder.softFail(config, 'tools.required', 'Release tool readiness has no check details');
  } else {
    recorder.softFail(
      config,
      'tools.required',
      'Required release tools are unavailable',
      requiredFailures.map((check) => check.id || check.label || 'unknown').join(', '),
    );
  }

  const requiredProbes = requiredToolImageProbes(checks);
  const missingExecutedProbes = requiredProbes.filter(
    (probe) => !hasExecutedRequiredToolImageProbe(checks, probe.imageId),
  );
  if (requiredProbes.length === 0) {
    recorder.pass('tools.imageProbes', 'No Docker fallback image probes are required');
  } else if (missingExecutedProbes.length === 0) {
    recorder.pass(
      'tools.imageProbes',
      'Docker fallback images have execution proof',
      requiredProbes.map((probe) => probe.imageId).join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'tools.imageProbes',
      'Docker fallback images do not have execution proof',
      missingExecutedProbes.map((probe) => probe.imageId).join(', '),
    );
  }
}

function runVerification(options) {
  const config = makeConfig(options);
  const recorder = createRecorder();

  verifySourceControlEvidence(config, recorder);
  verifyToolReadinessEvidence(config, recorder);
  verifyOperationalReadinessEvidence(config, recorder);
  verifyLoadEvidence(config, recorder);
  verifySemgrepEvidence(config, recorder);
  verifyContainerEvidence(config, recorder);
  verifySecretEvidence(config, recorder);
  verifyProviderQualityEvidence(config, recorder);
  verifySentryEvidence(config, recorder);
  verifyBrowserEvidence(config, recorder);

  const totals = recorder.checks.reduce(
    (accumulator, check) => {
      accumulator[check.status] += 1;
      return accumulator;
    },
    { pass: 0, warn: 0, fail: 0 },
  );

  return { config, checks: recorder.checks, totals, ok: totals.fail === 0 };
}

function printVerification(result) {
  process.stdout.write('BidStack deploy evidence verifier\n');
  process.stdout.write(`Environment: ${result.config.deployEnv}\n`);
  process.stdout.write(`Strict mode: ${result.config.strict ? 'yes' : 'no'}\n`);
  process.stdout.write(`Max evidence age: ${result.config.maxAgeHours}h\n\n`);

  for (const check of result.checks) {
    const prefix = check.status.toUpperCase().padEnd(4);
    const detail = check.detail ? ` - ${check.detail}` : '';
    process.stdout.write(`${prefix} ${check.label}${detail}\n`);
  }

  process.stdout.write(
    `\nSummary: ${result.totals.pass} passed, ${result.totals.warn} warning(s), ${result.totals.fail} failure(s)\n`,
  );

  if (result.config.reportPath) {
    const absolutePath = resolveArtifact(result.config, result.config.reportPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          environment: result.config.deployEnv,
          ok: result.ok,
          totals: result.totals,
          checks: result.checks,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stdout.write(`Report: ${path.relative(result.config.root, absolutePath)}\n`);
  }

  if (result.ok) {
    process.stdout.write('\nDEPLOY EVIDENCE PASSED\n');
  } else {
    process.stderr.write('\nDEPLOY EVIDENCE BLOCKED\n');
  }
}

function writeJson(root, relativePath, value) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fileHasValidJson(absolutePath) {
  if (!absolutePath || !existsSync(absolutePath)) {
    return false;
  }
  try {
    JSON.parse(readFileSync(absolutePath, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

function writeSelftestContainerRawReports(root, images) {
  return images.map((image, index) => {
    const rawReportPath = `${DEFAULT_CONTAINER_RAW_REPORT_DIR}/selftest-${index + 1}.json`;
    writeJson(root, rawReportPath, {
      SchemaVersion: 2,
      Results: [],
      ArtifactName: image,
    });
    return { image, rawReportPath, vulnerabilities: [] };
  });
}

function writeSelftestSecretRawReports(root) {
  const currentCommit = `${DEFAULT_SECRET_RAW_REPORT_DIR}/selftest-current-commit.json`;
  const fullHistory = `${DEFAULT_SECRET_RAW_REPORT_DIR}/selftest-full-history.json`;
  writeJson(root, currentCommit, []);
  writeJson(root, fullHistory, [
    {
      RuleID: 'selftest-redacted-historical-secret',
      Description: 'Synthetic redacted historical secret finding for release-gate selftest',
      File: 'docs/fixtures/redacted-history.txt',
      StartLine: 1,
    },
  ]);
  return { currentCommit, fullHistory };
}

function initializeSelftestGitRepo(root) {
  const init = runGit(root, ['init', '-b', 'main']);
  if (!init.passed) {
    runGit(root, ['init']);
    runGit(root, ['checkout', '-B', 'main']);
  }
  runGit(root, ['config', 'user.email', 'release@example.com']);
  runGit(root, ['config', 'user.name', 'Release Bot']);
  writeFileSync(
    path.join(root, '.gitignore'),
    ['deploy-evidence/', 'load-test-report/', ''].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(root, 'README.md'), '# Release fixture\n', 'utf8');
  runGit(root, ['add', '.gitignore', 'README.md']);
  runGit(root, ['commit', '-m', 'initial']);
  runGit(root, ['remote', 'add', 'origin', 'https://example.invalid/bidcrm.git']);
  const commit = firstLine(runGit(root, ['rev-parse', '--verify', 'HEAD']).stdout);
  runGit(root, ['update-ref', 'refs/remotes/origin/main', commit]);
  runGit(root, ['branch', '--set-upstream-to=origin/main', 'main']);
}

function createSelftestFixtures(root) {
  const now = new Date().toISOString();
  const releaseApiTarget = 'https://api.staging.bidstack360.com';
  const sourceSnapshot = collectCurrentSourceSnapshot(root);
  writeJson(root, DEFAULT_PATHS.source, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'source-control-evidence',
    commit: sourceSnapshot.commit || '0123456789abcdef0123456789abcdef01234567',
    branch: sourceSnapshot.branch || 'main',
    upstream: sourceSnapshot.upstream || 'origin/main',
    upstreamSynced: true,
    aheadCount: 0,
    behindCount: 0,
    clean: true,
    dirty: false,
    statusEntryCount: 0,
    stagedCount: 0,
    trackedDirtyCount: 0,
    untrackedCount: 0,
    statusManifest: sourceSnapshot.statusManifest || [],
    passed: true,
    validationFailures: [],
  });
  writeJson(root, DEFAULT_LOAD_RAW_SUMMARY, {
    metrics: {},
  });
  writeJson(root, DEFAULT_PATHS.load, {
    schemaVersion: 1,
    generatedAt: now,
    strictEvidence: true,
    environment: 'staging',
    profile: 'certification',
    target: releaseApiTarget,
    authenticatedRoutes: true,
    commandExitCode: 0,
    rawSummaryPath: DEFAULT_LOAD_RAW_SUMMARY,
    rawSummaryFound: true,
    passed: true,
    thresholds: [
      { metric: 'checks', expression: 'rate>0.99', actual: 1, expected: 0.99, ok: true },
      { metric: 'http_req_failed', expression: 'rate<0.01', actual: 0, expected: 0.01, ok: true },
    ],
    metrics: {
      checksRate: 1,
      httpReqFailedRate: 0,
      httpReqDurationP95Ms: 120,
      httpRequests: 3_000,
      vusMax: 500,
    },
  });
  writeJson(root, DEFAULT_PATHS.semgrep, {
    schemaVersion: 1,
    generatedAt: now,
    scanner: 'semgrep',
    image: 'semgrep/semgrep:1.165.0',
    configs: ['p/owasp-top-ten', 'p/javascript', 'p/typescript'],
    severities: ['ERROR'],
    mirroredFileCount: 1444,
    dockerfileSyntaxCheck: {
      checked: true,
      command: 'docker build --check .',
      exitCode: 0,
      passed: true,
    },
    commandExitCode: 0,
    passed: true,
    blockingFindings: 0,
    results: [],
    errors: [],
  });
  const selftestContainerImages = normalizeList(
    process.env.BIDSTACK_DEPLOY_REQUIRED_IMAGES || DEFAULT_CONTAINER_IMAGES.join(','),
  );
  const selftestContainerReports = writeSelftestContainerRawReports(root, selftestContainerImages);
  const selftestSecretRawReports = writeSelftestSecretRawReports(root);
  writeJson(root, DEFAULT_PATHS.container, {
    schemaVersion: 1,
    generatedAt: now,
    scanner: 'trivy',
    environment: 'staging',
    strictEvidence: true,
    requestedImages: selftestContainerImages,
    commandExitCode: 0,
    passed: true,
    blockingFindings: 0,
    missingImages: [],
    images: selftestContainerReports,
  });
  writeJson(root, DEFAULT_PATHS.secrets, {
    schemaVersion: 1,
    generatedAt: now,
    currentTreeClean: true,
    trackedTreeClean: true,
    untrackedSecretScanClean: true,
    currentCommitGitleaksClean: true,
    fullHistoryReviewed: true,
    fullHistoryClean: false,
    historicalFindingsCount: 11,
    historicalFindingsRotatedOrRevoked: true,
    ownerApprovedDisposition: true,
    reviewer: 'release-security@bidstack360.com',
    ownerApprover: 'security-owner@bidstack360.com',
    ownerApprovalTicket: 'MANTU-SEC-92741',
    ownerApprovedAt: '2026-06-18T10:00:00.000Z',
    rotationVerifiedAt: '2026-06-18T09:30:00.000Z',
    fullHistoryReviewMethod: 'gitleaks-full-history',
    rawReports: selftestSecretRawReports,
    commands: [
      {
        command: 'bash scripts/check-secrets.sh --full',
        exitCode: 0,
        passed: true,
        scanner: 'scripts/check-secrets.sh --full',
      },
      {
        command: 'git ls-files --others --exclude-standard -z + node secret regex',
        exitCode: 0,
        passed: true,
        scanner: 'untracked-file-secret-regex',
        filesScanned: 1,
        hitCount: 0,
        hitFiles: [],
      },
      {
        command: 'gitleaks current selftest',
        exitCode: 0,
        passed: true,
        scanner: 'gitleaks-current-commit',
        findingsCount: 0,
        rawReportPath: selftestSecretRawReports.currentCommit,
      },
      {
        command: 'gitleaks full-history selftest',
        exitCode: 1,
        passed: false,
        scanner: 'gitleaks-full-history',
        findingsCount: 11,
        rawReportPath: selftestSecretRawReports.fullHistory,
      },
    ],
  });
  writeJson(root, DEFAULT_PATHS.ops, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'operational-readiness-evidence',
    environment: 'staging',
    platform: 'azure',
    releaseId: 'release-2026-06-18-01234567',
    reviewer: 'release-ops@bidstack360.com',
    approver: 'platform-owner@bidstack360.com',
    approvalTicket: 'MANTU-OPS-92741',
    approvedAt: '2026-06-18T10:00:00.000Z',
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
      bicepBuild: 'az://deployment/build/release-2026-06-18-01234567',
      whatIf: 'az://deployment/what-if/release-2026-06-18-01234567',
      privateNetworking: 'docs://ops/private-networking/review-2026-06-18',
      storage: 'docs://ops/storage-driver/validation-2026-06-18',
      migrationJob: 'az://jobs/migration/release-2026-06-18-01234567',
      migrationDeploy: 'az://db/migration/deploy/release-2026-06-18-01234567',
      backupConfig: 'az://postgres/backups/policy-35d-geo',
      restoreDrill: 'az://postgres/restore-drill/2026-06-18T11:00:00.000Z',
      rollbackRunbook: 'docs://runbooks/rollback/review-2026-06-18',
      rollbackDrill: 'docs://runbooks/rollback/drill-2026-06-18T12:00:00.000Z',
      monitoringAlerts: 'sentry://alerts/release-2026-06-18-01234567',
      onCall: 'pagerduty://service/bidstack/release-2026-06-18',
    },
    thresholds: {
      minBackupRetentionDays: 30,
      maxRestoreRtoMinutes: 240,
      maxRestoreRpoMinutes: 60,
    },
    passed: true,
    validationFailures: [],
  });
  writeJson(root, DEFAULT_PATHS.providers, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'provider-quality-evidence',
    environment: 'staging',
    target: releaseApiTarget,
    companyKey: 'ci-financial',
    requiredProviders: ['apollo', 'seamless', 'tech_intel'],
    expectedTechIntelSources: ['BuiltWith MCP', 'Wappalyzer MCP'],
    allowApolloQueued: true,
    strict: true,
    command: {
      source: 'live-refresh',
      url: `${releaseApiTarget}/api/v1/crm/companies/ci-financial/technical-stack/refresh`,
      status: 200,
      ok: true,
      startedAt: now,
      completedAt: now,
      error: '',
    },
    providerChecks: [
      {
        id: 'apollo',
        label: 'Apollo',
        status: 'queued',
        transport: 'mcp',
        signalCount: 1,
        passed: true,
        failures: [],
      },
      {
        id: 'seamless',
        label: 'Seamless.AI',
        status: 'synced',
        transport: 'mcp',
        signalCount: 1,
        passed: true,
        failures: [],
      },
      {
        id: 'tech_intel',
        label: 'Tech Intel MCP',
        status: 'synced',
        transport: 'mcp',
        signalCount: 2,
        passed: true,
        failures: [],
        observedSources: [
          { label: 'BuiltWith MCP', sourceKey: 'builtwith_mcp', signalCount: 1 },
          { label: 'Wappalyzer MCP', sourceKey: 'wappalyzer_mcp', signalCount: 1 },
        ],
      },
    ],
    sourceSignalCounts: { apollo: 1, seamless: 1, tech_intel: 2, open_data: 0 },
    techIntelSources: [
      {
        label: 'BuiltWith MCP',
        sourceKey: 'builtwith_mcp',
        signalCount: 1,
        technologies: ['Okta'],
      },
      {
        label: 'Wappalyzer MCP',
        sourceKey: 'wappalyzer_mcp',
        signalCount: 1,
        technologies: ['Datadog'],
      },
    ],
    responseSummary: {
      providers: [
        { id: 'apollo', status: 'queued', transport: 'mcp', label: 'Apollo' },
        { id: 'seamless', status: 'synced', transport: 'mcp', label: 'Seamless.AI' },
        { id: 'tech_intel', status: 'synced', transport: 'mcp', label: 'Tech Intel MCP' },
      ],
      suggestionCount: 3,
      providerCategoryCount: 3,
      effectiveCategoryCount: 3,
    },
    passed: true,
    validationFailures: [],
  });
  writeJson(root, DEFAULT_PATHS.sentry, {
    generatedAt: now,
    environment: 'staging',
    triggerTarget: releaseApiTarget,
    dsnConfigured: true,
    release: 'bidstack-web@0.1.0+abc123',
    api5xxSmokeObserved: true,
    workerFailureObserved: true,
    sendDefaultPii: false,
    sessionReplayEnabled: false,
  });
  writeJson(root, DEFAULT_BROWSER_SOURCE_REPORT, {
    suites: [],
  });
  writeJson(root, DEFAULT_PATHS.browser, {
    generatedAt: now,
    environment: 'staging',
    profile: 'cross-role-regression',
    target: 'https://staging.bidstack.example',
    productionBuild: true,
    clerkBackedAuth: true,
    commandExitCode: 0,
    passed: true,
    roles: DEFAULT_BROWSER_ROLES,
    projects: DEFAULT_BROWSER_PROJECTS,
    specs: DEFAULT_BROWSER_SPECS,
    tests: { passed: 18, failed: 0, skipped: 2 },
    sourceReport: DEFAULT_BROWSER_SOURCE_REPORT,
    playwrightCommand:
      'pnpm --filter @bidstack/web exec playwright test e2e/flows/rbac.spec.ts --project chromium-desktop --project firefox-desktop --project webkit-desktop --reporter=json',
  });
  writeJson(root, DEFAULT_PATHS.tools, {
    generatedAt: now,
    executeImageProbes: true,
    passed: true,
    checks: [
      { id: 'node.version', label: 'Node.js 24 runtime', required: true, passed: true },
      { id: 'docker.daemon', label: 'Docker daemon reachable', required: true, passed: true },
      {
        id: 'gitleaks.runner',
        label: 'Gitleaks available natively or through Docker fallback',
        required: true,
        passed: true,
        detail: 'docker fallback',
        version: 'docker fallback ghcr.io/gitleaks/gitleaks:v8.30.1',
      },
      {
        id: 'k6.runner',
        label: 'k6 load runner available locally or through Docker fallback',
        required: true,
        passed: true,
        detail: 'Docker fallback is required',
        version: 'docker fallback grafana/k6:2.0.0',
      },
      {
        id: 'semgrep.runner',
        label: 'Semgrep Docker runner available',
        required: true,
        passed: true,
        detail: 'Semgrep release evidence runs in Docker',
      },
      {
        id: 'trivy.runner',
        label: 'Trivy Docker runner available',
        required: true,
        passed: true,
        detail: 'Container vulnerability evidence runs in Docker',
      },
      { id: 'gitleaks.image', label: 'Gitleaks image executes', required: true, passed: true },
      { id: 'k6.image', label: 'k6 image executes', required: true, passed: true },
      { id: 'semgrep.image', label: 'Semgrep image executes', required: true, passed: true },
      { id: 'trivy.image', label: 'Trivy image executes', required: true, passed: true },
    ],
  });
}

function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidcrm-deploy-evidence-'));
  const originalEnv = {};
  for (const key of [
    'BIDSTACK_SOURCE_CONTROL_EVIDENCE',
    'BIDSTACK_LOAD_CERT_PATH',
    'BIDSTACK_SEMGREP_REPORT',
    'BIDSTACK_CONTAINER_SCAN_REPORT',
    'BIDSTACK_SECRET_SCAN_EVIDENCE',
    'BIDSTACK_PROVIDER_QUALITY_EVIDENCE',
    'BIDSTACK_SENTRY_EVIDENCE_PATH',
    'BIDSTACK_DEPLOY_EVIDENCE_REPORT',
    'BIDSTACK_DEPLOY_ENV',
    'BIDSTACK_DEPLOY_REQUIRED_PROVIDERS',
    'BIDSTACK_DEPLOY_REQUIRED_IMAGES',
  ]) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }

  try {
    const digest = (char) => char.repeat(64);
    const releaseContainerImages = [
      `registry.example.com/bidcrm-api@sha256:${digest('a')}`,
      `registry.example.com/bidcrm-web@sha256:${digest('b')}`,
      `registry.example.com/bidcrm-worker@sha256:${digest('c')}`,
      `registry.example.com/bidcrm-mcp@sha256:${digest('d')}`,
      `registry.example.com/bidcrm-migrate@sha256:${digest('e')}`,
    ];
    process.env.BIDSTACK_DEPLOY_REQUIRED_IMAGES = releaseContainerImages.join(',');

    initializeSelftestGitRepo(root);
    createSelftestFixtures(root);
    const good = runVerification({ root, deployEnv: 'staging' });
    assert.equal(good.config.reportPath, 'deploy-evidence/strict-staging-latest.json');
    assert.equal(
      good.ok,
      true,
      `expected clean fixture to pass: ${JSON.stringify(good.checks, null, 2)}`,
    );

    const productionConfig = makeConfig({ root, deployEnv: 'production' });
    assert.equal(productionConfig.reportPath, 'deploy-evidence/strict-production-latest.json');

    mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true });
    const staleSourceProbePath = path.join(root, 'apps', 'web', 'src', 'new-current-change.tsx');
    writeFileSync(staleSourceProbePath, 'export const currentOnly = true;\n', 'utf8');
    const staleSourceEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      staleSourceEvidence.ok,
      false,
      'expected stale source-control evidence to fail staging gate',
    );
    assert.equal(
      staleSourceEvidence.checks.some(
        (check) => check.id === 'source.current' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require current source-control evidence',
    );
    rmSync(staleSourceProbePath, { force: true });

    writeJson(root, DEFAULT_PATHS.browser, {
      generatedAt: new Date().toISOString(),
      environment: 'staging',
      profile: 'cross-role-regression',
      target: 'https://staging.bidstack.example',
      productionBuild: true,
      clerkBackedAuth: true,
      commandExitCode: 0,
      passed: true,
      roles: ['admin', 'manager', 'read-only'],
      projects: DEFAULT_BROWSER_PROJECTS,
      specs: DEFAULT_BROWSER_SPECS,
      tests: { passed: 14, failed: 0 },
      sourceReport: DEFAULT_BROWSER_SOURCE_REPORT,
      playwrightCommand:
        'pnpm --filter @bidstack/web exec playwright test e2e/flows/rbac.spec.ts --project chromium-desktop --project firefox-desktop --project webkit-desktop --reporter=json',
    });
    const missingViewerPersona = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingViewerPersona.ok,
      false,
      'expected missing viewer persona to fail staging gate',
    );
    assert.equal(
      missingViewerPersona.checks.some(
        (check) => check.id === 'browser.roles' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require viewer browser persona',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.browser, {
      generatedAt: new Date().toISOString(),
      environment: 'production',
      profile: 'cross-role-regression',
      target: 'https://staging.bidstack.example',
      productionBuild: true,
      clerkBackedAuth: true,
      commandExitCode: 0,
      passed: true,
      roles: DEFAULT_BROWSER_ROLES,
      projects: DEFAULT_BROWSER_PROJECTS,
      specs: DEFAULT_BROWSER_SPECS,
      tests: { passed: 18, failed: 0 },
      sourceReport: DEFAULT_BROWSER_SOURCE_REPORT,
      playwrightCommand:
        'pnpm --filter @bidstack/web exec playwright test e2e/flows/rbac.spec.ts --project chromium-desktop --project firefox-desktop --project webkit-desktop --reporter=json',
    });
    const mismatchedBrowserEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedBrowserEnvironment.ok,
      false,
      'expected mismatched browser environment to fail staging gate',
    );
    assert.equal(
      mismatchedBrowserEnvironment.checks.some(
        (check) => check.id === 'browser.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production browser evidence',
    );

    createSelftestFixtures(root);
    const browserArtifactPath = path.join(root, DEFAULT_PATHS.browser);
    const syntheticBrowser = JSON.parse(readFileSync(browserArtifactPath, 'utf8'));
    delete syntheticBrowser.sourceReport;
    delete syntheticBrowser.playwrightCommand;
    writeJson(root, DEFAULT_PATHS.browser, syntheticBrowser);
    const syntheticBrowserEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      syntheticBrowserEvidence.ok,
      false,
      'expected synthetic browser evidence without source proof to fail staging gate',
    );
    for (const checkId of ['browser.sourceReport', 'browser.command']) {
      assert.equal(
        syntheticBrowserEvidence.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to reject synthetic browser evidence`,
      );
    }

    createSelftestFixtures(root);
    const invalidBrowserSource = JSON.parse(readFileSync(browserArtifactPath, 'utf8'));
    writeFileSync(path.join(root, DEFAULT_BROWSER_SOURCE_REPORT), 'not valid json\n', 'utf8');
    writeJson(root, DEFAULT_PATHS.browser, invalidBrowserSource);
    const invalidBrowserSourceEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      invalidBrowserSourceEvidence.ok,
      false,
      'expected invalid Playwright source report to fail staging gate',
    );
    assert.equal(
      invalidBrowserSourceEvidence.checks.some(
        (check) => check.id === 'browser.sourceReport' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require parseable Playwright source report JSON',
    );

    createSelftestFixtures(root);
    const unknownBrowser = JSON.parse(readFileSync(browserArtifactPath, 'utf8'));
    unknownBrowser.tests = { passed: 18, failed: 0, unknown: 1 };
    unknownBrowser.passed = true;
    writeJson(root, DEFAULT_PATHS.browser, unknownBrowser);
    const unknownBrowserEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      unknownBrowserEvidence.ok,
      false,
      'expected browser evidence with unknown test outcomes to fail staging gate',
    );
    assert.equal(
      unknownBrowserEvidence.checks.some(
        (check) => check.id === 'browser.tests' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject unknown browser test outcomes',
    );

    createSelftestFixtures(root);
    const loadArtifactPath = path.join(root, DEFAULT_PATHS.load);
    const mismatchedLoad = JSON.parse(readFileSync(loadArtifactPath, 'utf8'));
    mismatchedLoad.environment = 'production';
    writeJson(root, DEFAULT_PATHS.load, mismatchedLoad);
    const mismatchedLoadEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedLoadEnvironment.ok,
      false,
      'expected mismatched load environment to fail staging gate',
    );
    assert.equal(
      mismatchedLoadEnvironment.checks.some(
        (check) => check.id === 'load.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production load evidence',
    );

    createSelftestFixtures(root);
    const nonStrictLoad = JSON.parse(readFileSync(loadArtifactPath, 'utf8'));
    delete nonStrictLoad.strictEvidence;
    writeJson(root, DEFAULT_PATHS.load, nonStrictLoad);
    const nonStrictLoadEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      nonStrictLoadEvidence.ok,
      false,
      'expected non-strict load evidence to fail staging gate',
    );
    assert.equal(
      nonStrictLoadEvidence.checks.some(
        (check) => check.id === 'load.strictEvidence' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require strict load evidence',
    );

    createSelftestFixtures(root);
    const missingLoadMetrics = JSON.parse(readFileSync(loadArtifactPath, 'utf8'));
    missingLoadMetrics.metrics = {};
    writeJson(root, DEFAULT_PATHS.load, missingLoadMetrics);
    const missingLoadMetricsEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingLoadMetricsEvidence.ok,
      false,
      'expected missing load metrics to fail staging gate',
    );
    assert.equal(
      missingLoadMetricsEvidence.checks.some(
        (check) => check.id === 'load.metrics' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require core k6 metrics',
    );

    createSelftestFixtures(root);
    const missingLoadRawSummary = JSON.parse(readFileSync(loadArtifactPath, 'utf8'));
    missingLoadRawSummary.rawSummaryFound = false;
    rmSync(path.join(root, DEFAULT_LOAD_RAW_SUMMARY), { force: true });
    writeJson(root, DEFAULT_PATHS.load, missingLoadRawSummary);
    const missingLoadRawSummaryEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingLoadRawSummaryEvidence.ok,
      false,
      'expected missing raw k6 summary to fail staging gate',
    );
    assert.equal(
      missingLoadRawSummaryEvidence.checks.some(
        (check) => check.id === 'load.rawSummary' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require raw k6 summary proof',
    );

    createSelftestFixtures(root);
    const invalidLoadRawSummary = JSON.parse(readFileSync(loadArtifactPath, 'utf8'));
    writeFileSync(path.join(root, DEFAULT_LOAD_RAW_SUMMARY), 'not valid json\n', 'utf8');
    writeJson(root, DEFAULT_PATHS.load, invalidLoadRawSummary);
    const invalidLoadRawSummaryEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      invalidLoadRawSummaryEvidence.ok,
      false,
      'expected invalid raw k6 summary to fail staging gate',
    );
    assert.equal(
      invalidLoadRawSummaryEvidence.checks.some(
        (check) => check.id === 'load.rawSummary' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require parseable raw k6 summary JSON',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.load, {
      generatedAt: new Date().toISOString(),
      profile: 'smoke',
      target: 'http://127.0.0.1:4000',
      authenticatedRoutes: true,
      commandExitCode: 0,
      passed: true,
      thresholds: [
        { metric: 'checks', expression: 'rate>0.99', actual: 1, expected: 0.99, ok: true },
      ],
    });
    const weakLoad = runVerification({ root, deployEnv: 'production' });
    assert.equal(weakLoad.ok, false, 'expected local smoke load proof to fail production gate');
    assert.equal(
      weakLoad.checks.some((check) => check.id === 'load.profile' && check.status === 'fail'),
      true,
      'expected production gate to require certification profile',
    );
    assert.equal(
      weakLoad.checks.some((check) => check.id === 'load.target' && check.status === 'fail'),
      true,
      'expected production gate to reject local load target',
    );

    rmSync(path.join(root, DEFAULT_PATHS.sentry), { force: true });
    const missingSentry = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingSentry.ok,
      false,
      'expected missing Sentry smoke proof to fail production gate',
    );
    assert.equal(
      missingSentry.checks.some((check) => check.id === 'sentry.exists' && check.status === 'fail'),
      true,
      'expected missing Sentry proof to be a hard failure',
    );

    createSelftestFixtures(root);
    const sentryArtifactPath = path.join(root, DEFAULT_PATHS.sentry);
    const missingSentryTriggerTarget = JSON.parse(readFileSync(sentryArtifactPath, 'utf8'));
    delete missingSentryTriggerTarget.triggerTarget;
    writeJson(root, DEFAULT_PATHS.sentry, missingSentryTriggerTarget);
    const missingSentryTriggerTargetEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingSentryTriggerTargetEvidence.ok,
      false,
      'expected missing Sentry trigger target to fail staging gate',
    );
    assert.equal(
      missingSentryTriggerTargetEvidence.checks.some(
        (check) => check.id === 'sentry.target' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require Sentry trigger target',
    );

    createSelftestFixtures(root);
    const localSentryTriggerTarget = JSON.parse(readFileSync(sentryArtifactPath, 'utf8'));
    localSentryTriggerTarget.triggerTarget = 'http://127.0.0.1:4000';
    writeJson(root, DEFAULT_PATHS.sentry, localSentryTriggerTarget);
    const localSentryTriggerTargetEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      localSentryTriggerTargetEvidence.ok,
      false,
      'expected local Sentry trigger target to fail staging gate',
    );
    assert.equal(
      localSentryTriggerTargetEvidence.checks.some(
        (check) => check.id === 'sentry.target' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject local Sentry trigger target',
    );

    createSelftestFixtures(root);
    const providerArtifactPath = path.join(root, DEFAULT_PATHS.providers);
    const mismatchedProvider = JSON.parse(readFileSync(providerArtifactPath, 'utf8'));
    mismatchedProvider.environment = 'production';
    writeJson(root, DEFAULT_PATHS.providers, mismatchedProvider);
    const mismatchedProviderEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedProviderEnvironment.ok,
      false,
      'expected mismatched provider environment to fail staging gate',
    );
    assert.equal(
      mismatchedProviderEnvironment.checks.some(
        (check) => check.id === 'providers.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production provider evidence',
    );

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.providers), { force: true });
    const missingProviderQuality = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingProviderQuality.ok,
      false,
      'expected missing provider quality proof to fail production gate',
    );
    assert.equal(
      missingProviderQuality.checks.some(
        (check) => check.id === 'providers.exists' && check.status === 'fail',
      ),
      true,
      'expected missing provider quality proof to be a hard failure',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.providers, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runner: 'provider-quality-evidence',
      environment: 'staging',
      target: 'https://api.staging.bidstack360.com',
      companyKey: 'ci-financial',
      requiredProviders: ['apollo', 'seamless', 'tech_intel'],
      expectedTechIntelSources: ['BuiltWith MCP', 'Wappalyzer MCP'],
      allowApolloQueued: true,
      strict: true,
      command: {
        source: 'live-refresh',
        url: 'https://api.staging.bidstack360.com/api/v1/crm/companies/ci-financial/technical-stack/refresh',
        status: 200,
        ok: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: '',
      },
      providerChecks: [
        { id: 'apollo', status: 'queued', transport: 'mcp', signalCount: 1, passed: true, failures: [] },
        { id: 'seamless', status: 'synced', transport: 'mcp', signalCount: 1, passed: true, failures: [] },
        {
          id: 'tech_intel',
          status: 'synced',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
          observedSources: [
            { label: 'BuiltWith MCP', sourceKey: 'builtwith_mcp', signalCount: 1 },
          ],
        },
      ],
      techIntelSources: [
        {
          label: 'BuiltWith MCP',
          sourceKey: 'builtwith_mcp',
          signalCount: 1,
          technologies: ['Okta'],
        },
      ],
      responseSummary: {
        providers: [
          { id: 'apollo', status: 'queued', transport: 'mcp' },
          { id: 'seamless', status: 'synced', transport: 'mcp' },
          { id: 'tech_intel', status: 'synced', transport: 'mcp' },
        ],
      },
      passed: true,
      validationFailures: [],
    });
    const missingTechIntelSource = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingTechIntelSource.ok,
      false,
      'expected missing named Tech Intel MCP source to fail production gate',
    );
    assert.equal(
      missingTechIntelSource.checks.some(
        (check) => check.id === 'providers.techIntelSources' && check.status === 'fail',
      ),
      true,
      'expected production gate to require every named Tech Intel MCP source',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.providers, {
      generatedAt: new Date().toISOString(),
      target: 'https://api.staging.bidstack360.com',
      companyKey: 'ci-financial',
      command: { source: 'response-file', ok: true, status: 200 },
      providerChecks: [
        { id: 'apollo', status: 'queued', transport: 'mcp', signalCount: 1, passed: true, failures: [] },
        {
          id: 'seamless',
          status: 'unavailable',
          transport: 'mcp',
          signalCount: 0,
          passed: false,
          failures: ['Seamless must be synced for release evidence'],
        },
        { id: 'tech_intel', status: 'synced', transport: 'mcp', signalCount: 1, passed: true, failures: [] },
      ],
      responseSummary: {
        providers: [
          { id: 'apollo', status: 'queued', transport: 'mcp' },
          { id: 'seamless', status: 'unavailable', transport: 'mcp' },
          { id: 'tech_intel', status: 'synced', transport: 'mcp' },
        ],
      },
      passed: false,
      validationFailures: ['seamless: Seamless must be synced for release evidence'],
    });
    const weakProviderQuality = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      weakProviderQuality.ok,
      false,
      'expected weak provider quality proof to fail production gate',
    );
    assert.equal(
      weakProviderQuality.checks.some(
        (check) => check.id === 'providers.liveRefresh' && check.status === 'fail',
      ),
      true,
      'expected production gate to require live provider refresh evidence',
    );
    assert.equal(
      weakProviderQuality.checks.some(
        (check) => check.id === 'providers.lanes' && check.status === 'fail',
      ),
      true,
      'expected failed provider lane to block production gate',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.providers, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runner: 'provider-quality-evidence',
      environment: 'staging',
      target: 'https://staging-api.bidstack.example',
      companyKey: '<company-key>',
      requiredProviders: ['apollo', 'seamless', 'tech_intel'],
      expectedTechIntelSources: ['<builtwith-mcp>'],
      allowApolloQueued: true,
      strict: true,
      command: {
        source: 'live-refresh',
        url: 'https://staging-api.bidstack.example/api/v1/crm/companies/%3Ccompany-key%3E/technical-stack/refresh',
        status: 200,
        ok: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: '',
      },
      providerChecks: [
        { id: 'apollo', status: 'queued', transport: 'mcp', signalCount: 1, passed: true, failures: [] },
        { id: 'seamless', status: 'synced', transport: 'mcp', signalCount: 1, passed: true, failures: [] },
        {
          id: 'tech_intel',
          status: 'synced',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
          observedSources: [
            { label: 'BuiltWith MCP', sourceKey: 'builtwith_mcp', signalCount: 1 },
          ],
        },
      ],
      techIntelSources: [
        {
          label: 'BuiltWith MCP',
          sourceKey: 'builtwith_mcp',
          signalCount: 1,
          technologies: ['Okta'],
        },
      ],
      responseSummary: {
        providers: [
          { id: 'apollo', status: 'queued', transport: 'mcp' },
          { id: 'seamless', status: 'synced', transport: 'mcp' },
          { id: 'tech_intel', status: 'synced', transport: 'mcp' },
        ],
      },
      passed: true,
      validationFailures: [],
    });
    const placeholderProviderQuality = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      placeholderProviderQuality.ok,
      false,
      'expected placeholder provider identity evidence to fail production gate',
    );
    for (const checkId of ['providers.target', 'providers.companyKey', 'providers.techIntelSources']) {
      assert.equal(
        placeholderProviderQuality.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to reject placeholder provider evidence`,
      );
    }

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.secrets, {
      generatedAt: new Date().toISOString(),
      currentTreeClean: true,
      currentCommitGitleaksClean: true,
      fullHistoryReviewed: true,
      historicalFindingsCount: 11,
      historicalFindingsRotatedOrRevoked: true,
      ownerApprovedDisposition: true,
      reviewer: 'release-security@bidstack360.com',
    });
    const missingSecretOwnerApprover = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingSecretOwnerApprover.ok,
      false,
      'expected owner-approved historical secret disposition without approver identity to fail',
    );
    assert.equal(
      missingSecretOwnerApprover.checks.some(
        (check) => check.id === 'secrets.ownerApprover' && check.status === 'fail',
      ),
      true,
      'expected production gate to require a named secret owner approver',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.secrets, {
      generatedAt: new Date().toISOString(),
      currentTreeClean: true,
      currentCommitGitleaksClean: true,
      fullHistoryReviewed: true,
      historicalFindingsCount: 11,
      historicalFindingsRotatedOrRevoked: true,
      ownerApprovedDisposition: true,
      reviewer: 'release-security@bidstack360.com',
      ownerApprover: 'security-owner@bidstack360.com',
      ownerApprovedAt: '2026-06-18T10:00:00.000Z',
      rotationVerifiedAt: '2026-06-18T09:30:00.000Z',
    });
    const missingSecretApprovalTicket = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingSecretApprovalTicket.ok,
      false,
      'expected owner-approved historical secret disposition without ticket to fail',
    );
    assert.equal(
      missingSecretApprovalTicket.checks.some(
        (check) => check.id === 'secrets.ownerApprovalTicket' && check.status === 'fail',
      ),
      true,
      'expected production gate to require an owner approval ticket',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.secrets, {
      generatedAt: new Date().toISOString(),
      currentTreeClean: true,
      currentCommitGitleaksClean: true,
      fullHistoryReviewed: true,
      historicalFindingsCount: 11,
      historicalFindingsRotatedOrRevoked: true,
      ownerApprovedDisposition: true,
      reviewer: 'release-security@bidstack360.com',
      ownerApprover: 'security-owner@bidstack360.com',
      ownerApprovalTicket: 'MANTU-SEC-92741',
      ownerApprovedAt: '2026-06-18T10:00:00.000Z',
    });
    const missingSecretRotationTimestamp = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingSecretRotationTimestamp.ok,
      false,
      'expected owner-approved historical secret disposition without rotation timestamp to fail',
    );
    assert.equal(
      missingSecretRotationTimestamp.checks.some(
        (check) => check.id === 'secrets.rotationVerifiedAt' && check.status === 'fail',
      ),
      true,
      'expected production gate to require a rotation verification timestamp',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.secrets, {
      generatedAt: new Date().toISOString(),
      currentTreeClean: true,
      currentCommitGitleaksClean: true,
      fullHistoryReviewed: true,
      historicalFindingsCount: 11,
      historicalFindingsRotatedOrRevoked: true,
      ownerApprovedDisposition: true,
      reviewer: 'release-security@example.com',
      ownerApprover: 'security-owner@example.com',
      ownerApprovalTicket: 'SEC-123',
      ownerApprovedAt: '2026-06-18T10:00:00.000Z',
      rotationVerifiedAt: '2026-06-18T09:30:00.000Z',
    });
    const placeholderSecretDisposition = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      placeholderSecretDisposition.ok,
      false,
      'expected placeholder historical secret disposition evidence to fail',
    );
    for (const checkId of ['secrets.ownerApprover', 'secrets.ownerApprovalTicket', 'secrets.reviewer']) {
      assert.equal(
        placeholderSecretDisposition.checks.some((check) => check.id === checkId && check.status === 'fail'),
        true,
        `expected ${checkId} to reject placeholder evidence`,
      );
    }

    createSelftestFixtures(root);
    const summaryOnlySecret = JSON.parse(readFileSync(path.join(root, DEFAULT_PATHS.secrets), 'utf8'));
    delete summaryOnlySecret.rawReports;
    summaryOnlySecret.commands = summaryOnlySecret.commands.map((command) =>
      Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'rawReportPath')),
    );
    writeJson(root, DEFAULT_PATHS.secrets, summaryOnlySecret);
    const summaryOnlySecretEvidence = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      summaryOnlySecretEvidence.ok,
      false,
      'expected summary-only secret evidence to fail production gate',
    );
    for (const checkId of ['secrets.currentCommitRawReport', 'secrets.fullHistoryRawReport']) {
      assert.equal(
        summaryOnlySecretEvidence.checks.some((check) => check.id === checkId && check.status === 'fail'),
        true,
        `expected ${checkId} to require raw Gitleaks JSON proof`,
      );
    }

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.source, {
      generatedAt: new Date().toISOString(),
      runner: 'source-control-evidence',
      commit: '0123456789abcdef0123456789abcdef01234567',
      branch: 'main',
      upstream: 'origin/main',
      upstreamSynced: true,
      aheadCount: 0,
      behindCount: 0,
      clean: false,
      dirty: true,
      statusEntryCount: 2,
      trackedDirtyCount: 1,
      untrackedCount: 1,
      passed: false,
      validationFailures: ['git worktree must be clean for release evidence'],
    });
    const dirtySource = runVerification({ root, deployEnv: 'production' });
    assert.equal(dirtySource.ok, false, 'expected dirty source-control evidence to fail production gate');
    assert.equal(
      dirtySource.checks.some((check) => check.id === 'source.clean' && check.status === 'fail'),
      true,
      'expected production gate to require a clean git worktree',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.source, {
      generatedAt: new Date().toISOString(),
      runner: 'source-control-evidence',
      commit: '0123456789abcdef0123456789abcdef01234567',
      branch: 'main',
      upstream: 'origin/main',
      upstreamSynced: false,
      aheadCount: 1,
      behindCount: 0,
      clean: true,
      dirty: false,
      statusEntryCount: 0,
      trackedDirtyCount: 0,
      untrackedCount: 0,
      passed: false,
      validationFailures: ['release branch must be synced with its upstream tracking branch'],
    });
    const unpushedSource = runVerification({ root, deployEnv: 'production' });
    assert.equal(unpushedSource.ok, false, 'expected unpushed source-control evidence to fail production gate');
    assert.equal(
      unpushedSource.checks.some((check) => check.id === 'source.upstreamSynced' && check.status === 'fail'),
      true,
      'expected production gate to require upstream-synced source',
    );

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.tools), { force: true });
    const missingToolReadiness = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingToolReadiness.ok,
      false,
      'expected missing release tool readiness proof to fail production gate',
    );
    assert.equal(
      missingToolReadiness.checks.some((check) => check.id === 'tools.exists' && check.status === 'fail'),
      true,
      'expected missing tool readiness proof to be a hard failure',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.tools, {
      generatedAt: new Date().toISOString(),
      executeImageProbes: false,
      passed: true,
      blockingFailures: [],
      checks: [
        { id: 'docker.daemon', label: 'Docker daemon reachable', required: true, passed: true },
        {
          id: 'gitleaks.runner',
          label: 'Gitleaks available natively or through Docker fallback',
          required: true,
          passed: true,
          detail: 'docker fallback',
          version: 'docker fallback ghcr.io/gitleaks/gitleaks:v8.30.1',
        },
        {
          id: 'k6.runner',
          label: 'k6 load runner available locally or through Docker fallback',
          required: true,
          passed: true,
          detail: 'Docker fallback is required',
          version: 'docker fallback grafana/k6:2.0.0',
        },
        {
          id: 'semgrep.runner',
          label: 'Semgrep Docker runner available',
          required: true,
          passed: true,
          detail: 'Semgrep release evidence runs in Docker',
        },
        {
          id: 'trivy.runner',
          label: 'Trivy Docker runner available',
          required: true,
          passed: true,
          detail: 'Container vulnerability evidence runs in Docker',
        },
        { id: 'gitleaks.image', label: 'Gitleaks image executes', required: false, passed: true, skipped: true },
        { id: 'k6.image', label: 'k6 image executes', required: false, passed: true, skipped: true },
        { id: 'semgrep.image', label: 'Semgrep image executes', required: false, passed: true, skipped: true },
        { id: 'trivy.image', label: 'Trivy image executes', required: false, passed: true, skipped: true },
      ],
    });
    const skippedToolImageProbes = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      skippedToolImageProbes.ok,
      false,
      'expected skipped Docker fallback image probes to fail strict deploy evidence',
    );
    assert.equal(
      skippedToolImageProbes.checks.some(
        (check) => check.id === 'tools.imageProbes' && check.status === 'fail',
      ),
      true,
      'expected strict deploy gate to require executed Docker image probes',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.semgrep, {
      generatedAt: new Date().toISOString(),
      passed: true,
      blockingFindings: 0,
    });
    const compactSemgrepEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      compactSemgrepEvidence.ok,
      false,
      'expected compact Semgrep summary to fail strict deploy evidence',
    );
    for (const checkId of [
      'semgrep.scanner',
      'semgrep.configs',
      'semgrep.coverage',
      'semgrep.command',
      'semgrep.reportShape',
      'semgrep.dockerfileSyntax',
    ]) {
      assert.equal(
        compactSemgrepEvidence.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to reject compact Semgrep evidence`,
      );
    }

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.ops), { force: true });
    const missingOperationalReadiness = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingOperationalReadiness.ok,
      false,
      'expected missing operational readiness proof to fail production gate',
    );
    assert.equal(
      missingOperationalReadiness.checks.some((check) => check.id === 'ops.exists' && check.status === 'fail'),
      true,
      'expected missing operational readiness proof to be a hard failure',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.ops, {
      generatedAt: new Date().toISOString(),
      passed: true,
      environment: 'production',
      platform: 'azure',
      releaseId: 'release-2026-06-18-01234567',
      reviewer: 'release-ops@bidstack360.com',
      approver: 'platform-owner@bidstack360.com',
      approvalTicket: 'OPS-1234',
      approvedAt: '2026-06-18T10:00:00.000Z',
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
    });
    const placeholderOpsApprovalTicket = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      placeholderOpsApprovalTicket.ok,
      false,
      'expected placeholder operational approval ticket to fail production gate',
    );
    assert.equal(
      placeholderOpsApprovalTicket.checks.some(
        (check) => check.id === 'ops.approvalTicket' && check.status === 'fail',
      ),
      true,
      'expected ops approval ticket to reject sample ticket values',
    );

    createSelftestFixtures(root);
    const summaryOnlyOps = JSON.parse(readFileSync(path.join(root, DEFAULT_PATHS.ops), 'utf8'));
    summaryOnlyOps.environment = 'production';
    delete summaryOnlyOps.evidenceRefs;
    writeJson(root, DEFAULT_PATHS.ops, summaryOnlyOps);
    const summaryOnlyOperationalReadiness = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      summaryOnlyOperationalReadiness.ok,
      false,
      'expected summary-only operational readiness proof to fail production gate',
    );
    for (const checkId of ['ops.evidence.approval', 'ops.evidence.whatIf', 'ops.evidence.restoreDrill']) {
      assert.equal(
        summaryOnlyOperationalReadiness.checks.some((check) => check.id === checkId && check.status === 'fail'),
        true,
        `expected ${checkId} to require reviewable evidence`,
      );
    }

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.ops, {
      generatedAt: new Date().toISOString(),
      environment: 'production',
      platform: 'azure',
      releaseId: 'release-2026-06-18-01234567',
      reviewer: 'release-ops@bidstack360.com',
      approver: 'platform-owner@bidstack360.com',
      approvalTicket: 'MANTU-OPS-92741',
      approvedAt: '2026-06-18T10:00:00.000Z',
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
        restoreRpoMinutes: 180,
      },
      rollback: {
        runbookReviewed: true,
        rollbackDrillAt: '2026-06-18T12:00:00.000Z',
      },
      monitoring: {
        alertsValidated: true,
        onCallValidated: true,
      },
      thresholds: {
        minBackupRetentionDays: 30,
        maxRestoreRtoMinutes: 240,
        maxRestoreRpoMinutes: 60,
      },
      passed: false,
      validationFailures: ['restore RPO must be <= 60 minutes'],
    });
    const weakOperationalReadiness = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      weakOperationalReadiness.ok,
      false,
      'expected weak operational readiness proof to fail production gate',
    );
    assert.equal(
      weakOperationalReadiness.checks.some((check) => check.id === 'ops.restoreRpo' && check.status === 'fail'),
      true,
      'expected production gate to require release-grade restore RPO',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.ops, {
      generatedAt: new Date().toISOString(),
      environment: 'production',
      platform: 'azure',
      releaseId: 'release-2026-06-18-01234567',
      reviewer: 'release-ops@bidstack360.com',
      approver: 'platform-owner@bidstack360.com',
      approvalTicket: 'MANTU-OPS-92741',
      approvedAt: '2026-06-18T10:00:00.000Z',
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
        restoreRtoMinutes: null,
        restoreRpoMinutes: null,
      },
      rollback: {
        runbookReviewed: true,
        rollbackDrillAt: '2026-06-18T12:00:00.000Z',
      },
      monitoring: {
        alertsValidated: true,
        onCallValidated: true,
      },
      thresholds: {
        minBackupRetentionDays: 30,
        maxRestoreRtoMinutes: 240,
        maxRestoreRpoMinutes: 60,
      },
      passed: false,
      validationFailures: ['restore RTO must be <= 240 minutes', 'restore RPO must be <= 60 minutes'],
    });
    const missingRestoreTargets = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingRestoreTargets.checks.some((check) => check.id === 'ops.restoreRto' && check.status === 'fail'),
      true,
      'expected missing restore RTO to fail instead of passing as 0m',
    );
    assert.equal(
      missingRestoreTargets.checks.some((check) => check.id === 'ops.restoreRpo' && check.status === 'fail'),
      true,
      'expected missing restore RPO to fail instead of passing as 0m',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.tools, {
      generatedAt: new Date().toISOString(),
      passed: false,
      blockingFailures: ['docker.daemon'],
      checks: [
        { id: 'node.version', label: 'Node.js 24 runtime', required: true, passed: true },
        { id: 'docker.daemon', label: 'Docker daemon reachable', required: true, passed: false },
      ],
    });
    const failedToolReadiness = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      failedToolReadiness.ok,
      false,
      'expected failed release tool readiness proof to fail production gate',
    );
    assert.equal(
      failedToolReadiness.checks.some((check) => check.id === 'tools.passed' && check.status === 'fail'),
      true,
      'expected failed tool readiness artifact to be a hard failure',
    );

    createSelftestFixtures(root);
    const containerArtifactPath = path.join(root, DEFAULT_PATHS.container);
    const mismatchedContainer = JSON.parse(readFileSync(containerArtifactPath, 'utf8'));
    mismatchedContainer.environment = 'production';
    writeJson(root, DEFAULT_PATHS.container, mismatchedContainer);
    const mismatchedContainerEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedContainerEnvironment.ok,
      false,
      'expected mismatched container environment to fail staging gate',
    );
    assert.equal(
      mismatchedContainerEnvironment.checks.some(
        (check) => check.id === 'container.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production container evidence',
    );

    createSelftestFixtures(root);
    const compactOnlyContainer = JSON.parse(readFileSync(containerArtifactPath, 'utf8'));
    compactOnlyContainer.images = compactOnlyContainer.images.map(({ image, vulnerabilities }) => ({
      image,
      vulnerabilities,
    }));
    writeJson(root, DEFAULT_PATHS.container, compactOnlyContainer);
    const compactOnlyContainerEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      compactOnlyContainerEvidence.ok,
      false,
      'expected compact-only container evidence to fail staging gate',
    );
    assert.equal(
      compactOnlyContainerEvidence.checks.some(
        (check) => check.id === 'container.rawReports' && check.status === 'fail',
      ),
      true,
      'expected strict deploy gate to require raw Trivy report proof',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.container, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanner: 'trivy',
      environment: 'staging',
      strictEvidence: true,
      requestedImages: DEFAULT_CONTAINER_IMAGES,
      commandExitCode: 0,
      passed: true,
      blockingFindings: 0,
      missingImages: [],
      images: DEFAULT_CONTAINER_IMAGES.map((image) => ({ image, vulnerabilities: [] })),
    });
    const mutableContainerImages = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mutableContainerImages.ok,
      false,
      'expected mutable local image refs to fail staging gate',
    );
    assert.equal(
      mutableContainerImages.checks.some(
        (check) => check.id === 'container.immutableRefs' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require immutable image digest refs',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.container, {
      generatedAt: new Date().toISOString(),
      passed: true,
      blockingFindings: 0,
      images: [],
    });
    const missingContainerCoverage = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingContainerCoverage.ok,
      false,
      'expected missing container image coverage to fail',
    );
    assert.equal(
      missingContainerCoverage.checks.some(
        (check) => check.id === 'container.coverage' && check.status === 'fail',
      ),
      true,
      'expected production gate to require all deploy images in container scan evidence',
    );

    createSelftestFixtures(root);
    writeJson(root, DEFAULT_PATHS.container, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanner: 'trivy',
      environment: 'production',
      strictEvidence: true,
      requestedImages: DEFAULT_CONTAINER_IMAGES,
      commandExitCode: 1,
      passed: false,
      blockingFindings: 0,
      missingImages: [],
      images: [],
      validationFailures: ['Strict container evidence requires immutable image digest references.'],
    });
    const strictEmptyContainerEvidence = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      strictEmptyContainerEvidence.ok,
      false,
      'expected strict empty container scan evidence to fail',
    );
    assert.equal(
      strictEmptyContainerEvidence.checks.some(
        (check) => check.id === 'container.findings' && check.status === 'fail',
      ),
      true,
      'expected strict container evidence with zero scanned reports to fail findings',
    );

    process.stdout.write('deploy evidence selftest passed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) {
    runSelftest();
  } else {
    const result = runVerification(args);
    printVerification(result);
    process.exit(result.ok ? 0 : 1);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
