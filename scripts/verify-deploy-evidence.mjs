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
  ci: 'deploy-evidence/ci-repeat-latest.json',
  load: 'load-test-report/production-load-latest.json',
  semgrep: 'deploy-evidence/semgrep-latest.json',
  container: 'deploy-evidence/container-scan-latest.json',
  secrets: 'deploy-evidence/secret-scan-latest.json',
  api: 'deploy-evidence/api-connectivity-latest.json',
  pii: 'deploy-evidence/pii-ciphertext-latest.json',
  webhooks: 'deploy-evidence/webhook-secret-ciphertext-latest.json',
  providers: 'deploy-evidence/provider-quality-latest.json',
  mcp: 'deploy-evidence/mcp-connectivity-latest.json',
  sentry: 'deploy-evidence/sentry-smoke-latest.json',
  a11y: 'deploy-evidence/a11y-latest.json',
  browser: 'deploy-evidence/browser-regression-latest.json',
  tools: 'deploy-evidence/tool-readiness-latest.json',
  ops: 'deploy-evidence/operational-readiness-latest.json',
};
const DEFAULT_LOAD_RAW_SUMMARY = 'load-test-report/k6-summary-latest.json';
const DEFAULT_A11Y_SOURCE_REPORT = 'deploy-evidence/playwright-a11y.json';
const DEFAULT_BROWSER_SOURCE_REPORT = 'deploy-evidence/playwright-browser-regression.json';
const DEFAULT_CONTAINER_RAW_REPORT_DIR = 'deploy-evidence/container-scan-reports';
const DEFAULT_CONTAINER_SBOM_REPORT_DIR = 'deploy-evidence/container-sboms';
const DEFAULT_SECRET_RAW_REPORT_DIR = 'deploy-evidence/secret-scan-reports';
const DEFAULT_CONTAINER_IMAGES = [
  'bidcrm-api:root-api-user-probe',
  'bidcrm-web:root-web-probe',
  'bidcrm-worker:root-current-osd',
  'bidcrm-mcp:root-mcp-user-probe',
  'bidcrm-migrate:nonroot-probe',
];
const DEFAULT_BROWSER_ROLES = ['admin', 'manager', 'read-only', 'viewer'];
const DEFAULT_A11Y_PROJECTS = ['chromium-desktop'];
const DEFAULT_A11Y_SPECS = [
  'e2e/a11y/axe.spec.ts',
  'e2e/a11y/color-contrast.spec.ts',
  'e2e/a11y/keyboard-nav.spec.ts',
];
const DEFAULT_BROWSER_PROJECTS = ['chromium-desktop', 'firefox-desktop', 'webkit-desktop'];
const DEFAULT_BROWSER_SPECS = ['e2e/flows/rbac.spec.ts'];
const DEFAULT_MCP_REQUIRED_TOOLS = [
  'opportunities.list',
  'contacts.list',
  'tasks.list',
  'crm_search_companies',
];
const USER_EMAIL_STORAGE_ONLY_DECISION = 'storage-encryption-only';
const PLAINTEXT_PII_STORAGE_ONLY_DECISION = 'storage-encryption-only';
const REQUIRED_PLAINTEXT_PII_FIELDS = [
  'SmsMessage.fromNumber',
  'SmsMessage.toNumber',
  'SmsMessage.body',
  'SmsConsent.phoneNumber',
  'ActivityAttendee.email',
  'CalendarEvent.attendees',
  'KamSession.transcriptText',
  'KamSession.attendees',
];
const ACCEPTED_BROWSER_PROFILES = new Set(['cross-role-regression', 'release-regression']);
const ACCEPTED_A11Y_PROFILES = new Set(['wcag-keyboard-regression', 'release-a11y']);
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
    paths: [
      'evidenceRefs.bicepBuild',
      'infrastructure.bicepBuildEvidenceRef',
      'infra.bicepBuildEvidenceRef',
    ],
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
    paths: [
      'evidenceRefs.storage',
      'infrastructure.storageEvidenceRef',
      'infra.storageEvidenceRef',
    ],
  },
  {
    id: 'ops.evidence.migrationJob',
    label: 'Migration job validation has reviewable evidence',
    paths: [
      'evidenceRefs.migrationJob',
      'database.migrationJobEvidenceRef',
      'migrations.jobEvidenceRef',
    ],
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
    paths: [
      'evidenceRefs.backupConfig',
      'database.backupConfigEvidenceRef',
      'backup.configEvidenceRef',
    ],
  },
  {
    id: 'ops.evidence.restoreDrill',
    label: 'Restore drill has reviewable evidence',
    paths: [
      'evidenceRefs.restoreDrill',
      'database.restoreDrillEvidenceRef',
      'backup.restoreDrillEvidenceRef',
    ],
  },
  {
    id: 'ops.evidence.rollbackRunbook',
    label: 'Rollback runbook review has reviewable evidence',
    paths: ['evidenceRefs.rollbackRunbook', 'rollback.runbookEvidenceRef'],
  },
  {
    id: 'ops.evidence.rollbackDrill',
    label: 'Rollback drill has reviewable evidence',
    paths: [
      'evidenceRefs.rollbackDrill',
      'rollback.rollbackDrillEvidenceRef',
      'rollback.drillEvidenceRef',
    ],
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
  BIDSTACK_CI_REPEAT_EVIDENCE
  BIDSTACK_LOAD_CERT_PATH
  BIDSTACK_SEMGREP_REPORT
  BIDSTACK_CONTAINER_SCAN_REPORT
  BIDSTACK_SECRET_SCAN_EVIDENCE
  BIDSTACK_API_CONNECTIVITY_EVIDENCE
  BIDSTACK_WEBHOOK_SECRET_EVIDENCE
  BIDSTACK_PROVIDER_QUALITY_EVIDENCE
  BIDSTACK_MCP_CONNECTIVITY_EVIDENCE
  BIDSTACK_SENTRY_EVIDENCE_PATH
  BIDSTACK_A11Y_EVIDENCE
  BIDSTACK_BROWSER_REGRESSION_EVIDENCE
  BIDSTACK_TOOL_READINESS_EVIDENCE
  BIDSTACK_OPS_READINESS_EVIDENCE
  BIDSTACK_DEPLOY_REQUIRED_PROVIDERS
  BIDSTACK_DEPLOY_REQUIRED_TECH_INTEL_SOURCES
  BIDSTACK_DEPLOY_REQUIRED_MCP_TOOLS
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
  const requiredA11yProjects = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_A11Y_PROJECTS || DEFAULT_A11Y_PROJECTS.join(',')
  )
    .split(',')
    .map((project) => project.trim())
    .filter(Boolean);
  const requiredA11ySpecs = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_A11Y_SPECS || DEFAULT_A11Y_SPECS.join(',')
  )
    .split(',')
    .map((spec) => spec.trim())
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
  const requiredMcpTools = (
    process.env.BIDSTACK_DEPLOY_REQUIRED_MCP_TOOLS ||
    process.env.BIDSTACK_MCP_CONNECTIVITY_REQUIRED_TOOLS ||
    DEFAULT_MCP_REQUIRED_TOOLS.join(',')
  )
    .split(',')
    .map((toolName) => toolName.trim())
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
    requiredA11yProjects,
    requiredA11ySpecs,
    requiredBrowserProjects,
    requiredBrowserSpecs,
    requiredProviders,
    requiredTechIntelSources,
    requiredMcpTools,
    paths: {
      source: process.env.BIDSTACK_SOURCE_CONTROL_EVIDENCE || DEFAULT_PATHS.source,
      ci: process.env.BIDSTACK_CI_REPEAT_EVIDENCE || DEFAULT_PATHS.ci,
      load: process.env.BIDSTACK_LOAD_CERT_PATH || DEFAULT_PATHS.load,
      semgrep: process.env.BIDSTACK_SEMGREP_REPORT || DEFAULT_PATHS.semgrep,
      container: process.env.BIDSTACK_CONTAINER_SCAN_REPORT || DEFAULT_PATHS.container,
      secrets: process.env.BIDSTACK_SECRET_SCAN_EVIDENCE || DEFAULT_PATHS.secrets,
      api: process.env.BIDSTACK_API_CONNECTIVITY_EVIDENCE || DEFAULT_PATHS.api,
      pii: process.env.BIDSTACK_PII_CIPHERTEXT_EVIDENCE || DEFAULT_PATHS.pii,
      webhooks: process.env.BIDSTACK_WEBHOOK_SECRET_EVIDENCE || DEFAULT_PATHS.webhooks,
      providers: process.env.BIDSTACK_PROVIDER_QUALITY_EVIDENCE || DEFAULT_PATHS.providers,
      mcp: process.env.BIDSTACK_MCP_CONNECTIVITY_EVIDENCE || DEFAULT_PATHS.mcp,
      sentry: process.env.BIDSTACK_SENTRY_EVIDENCE_PATH || DEFAULT_PATHS.sentry,
      a11y: process.env.BIDSTACK_A11Y_EVIDENCE || DEFAULT_PATHS.a11y,
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
  return (
    String(value || '')
      .split(/\r?\n/)
      .find(Boolean)
      ?.trim() || ''
  );
}

function normalizeStatusEntry(line) {
  return {
    status: String(line || '').slice(0, 2),
    file: String(line || '')
      .slice(3)
      .trim()
      .replace(/\\/g, '/'),
  };
}

function manifestKey(entry) {
  return `${entry.status}\t${entry.file}`;
}

function normalizeManifest(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      status: String(entry?.status || '').slice(0, 2),
      file: String(entry?.file || '')
        .trim()
        .replace(/\\/g, '/'),
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
    sourceManifest.every(
      (entry, index) => manifestKey(entry) === manifestKey(currentManifest[index]),
    );
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

function isHttpsEvidenceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && !hasPlaceholderSignal(url.hostname);
  } catch {
    return false;
  }
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
      Array.isArray(value.validationFailures)
        ? value.validationFailures.join(', ')
        : 'missing validationFailures',
    );
  }

  const commit = String(value.commit || value.gitCommit || value.sha || '').trim();
  if (/^[0-9a-f]{40}$/i.test(commit)) {
    recorder.pass('source.commit', 'Source-control evidence has a release commit', commit);
  } else {
    recorder.softFail(
      config,
      'source.commit',
      'Source-control evidence is missing a full commit SHA',
    );
  }

  const upstream = String(value.upstream || value.trackingBranch || '').trim();
  if (upstream) {
    recorder.pass('source.upstream', 'Source-control evidence has an upstream branch', upstream);
  } else {
    recorder.softFail(
      config,
      'source.upstream',
      'Source-control evidence is missing an upstream branch',
    );
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

function readSourceEvidence(config) {
  const absolutePath = resolveArtifact(config, config.paths.source);
  if (!existsSync(absolutePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch {
    return null;
  }
}

function readSourceEvidenceForCi(config) {
  return readSourceEvidence(config);
}

function isFullCommitSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || '').trim());
}

function verifyRuntimeReleaseIdentity(config, recorder, prefix, label, value, checkNames) {
  const release = value.release && typeof value.release === 'object' ? value.release : {};
  const expectedCommit = String(
    release.expectedCommit || release.commit || value.releaseCommit || '',
  ).trim();
  const expectedBranch = String(
    release.expectedBranch || release.branch || value.releaseBranch || '',
  ).trim();
  const sourceEvidence = readSourceEvidence(config);
  const sourceCommit = String(sourceEvidence?.commit || '').trim();
  const sourceBranch = String(sourceEvidence?.branch || '').trim();

  if (isFullCommitSha(expectedCommit)) {
    recorder.pass(
      `${prefix}.releaseCommit`,
      `${label} evidence has a release commit`,
      expectedCommit,
    );
  } else {
    recorder.softFail(
      config,
      `${prefix}.releaseCommit`,
      `${label} evidence is missing a full release commit`,
      expectedCommit || 'missing',
    );
  }

  if (sourceCommit && expectedCommit === sourceCommit) {
    recorder.pass(
      `${prefix}.sourceCommit`,
      `${label} release commit matches source-control evidence`,
    );
  } else {
    recorder.softFail(
      config,
      `${prefix}.sourceCommit`,
      `${label} release commit must match source-control evidence`,
      `runtime=${expectedCommit || 'missing'} source=${sourceCommit || 'missing'}`,
    );
  }

  if (
    expectedBranch &&
    !hasPlaceholderSignal(expectedBranch) &&
    (!sourceBranch || expectedBranch === sourceBranch)
  ) {
    recorder.pass(
      `${prefix}.releaseBranch`,
      `${label} release branch matches source-control evidence`,
      expectedBranch,
    );
  } else {
    recorder.softFail(
      config,
      `${prefix}.releaseBranch`,
      `${label} release branch must match source-control evidence`,
      `runtime=${expectedBranch || 'missing'} source=${sourceBranch || 'missing'}`,
    );
  }

  const checks = value.checks && typeof value.checks === 'object' ? value.checks : {};
  const mismatchedChecks = checkNames.filter((checkName) => {
    const observedRelease = checks[checkName]?.release ?? {};
    const observedCommit = String(observedRelease.commit || '').trim();
    const observedBranch = String(observedRelease.branch || '').trim();
    return observedCommit !== expectedCommit || observedBranch !== expectedBranch;
  });

  if (mismatchedChecks.length === 0) {
    recorder.pass(
      `${prefix}.runtimeRelease`,
      `${label} runtime checks all report the approved release identity`,
    );
  } else {
    recorder.softFail(
      config,
      `${prefix}.runtimeRelease`,
      `${label} runtime checks must report the approved release identity`,
      mismatchedChecks.join(', '),
    );
  }
}

function ciCheckPassed(value) {
  if (value && typeof value === 'object') {
    return (
      value.passed === true ||
      value.ok === true ||
      ['success', 'succeeded', 'passed'].includes(
        String(value.conclusion || value.status || '')
          .trim()
          .toLowerCase(),
      )
    );
  }
  if (value === true) return true;
  return ['success', 'succeeded', 'passed', 'true', '1'].includes(
    String(value || '')
      .trim()
      .toLowerCase(),
  );
}

function ciRunPassed(run, requiredChecks) {
  const conclusion = String(run?.conclusion || run?.status || '')
    .trim()
    .toLowerCase();
  const statusPassed = ['success', 'succeeded', 'passed', 'true'].includes(conclusion);
  const checks = run?.checks && typeof run.checks === 'object' ? run.checks : {};
  return (
    statusPassed &&
    Number(run?.failedSuites || 0) === 0 &&
    Number(run?.skippedSuites || 0) === 0 &&
    requiredChecks.every((check) => ciCheckPassed(checks[check]))
  );
}

function verifyCiRepeatEvidence(config, recorder) {
  const artifact = readJsonArtifact(config, recorder, 'ci.exists', 'CI repeat', config.paths.ci);
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'ci.fresh', 'CI repeat', artifact, value);

  if (
    value.passed === true &&
    Array.isArray(value.validationFailures) &&
    value.validationFailures.length === 0
  ) {
    recorder.pass('ci.passed', 'CI repeat evidence gate passed');
  } else {
    recorder.softFail(
      config,
      'ci.passed',
      'CI repeat evidence gate did not pass',
      Array.isArray(value.validationFailures)
        ? value.validationFailures.join(', ')
        : 'missing validationFailures',
    );
  }

  const provider = String(value.provider || '').trim();
  const workflow = String(value.workflow || '').trim();
  if (provider && !hasPlaceholderSignal(provider) && workflow && !hasPlaceholderSignal(workflow)) {
    recorder.pass(
      'ci.identity',
      'CI provider and workflow are identified',
      `${provider}/${workflow}`,
    );
  } else {
    recorder.softFail(
      config,
      'ci.identity',
      'CI provider and workflow must be non-placeholder values',
      `provider=${provider || 'missing'} workflow=${workflow || 'missing'}`,
    );
  }

  const sourceEvidence = readSourceEvidenceForCi(config);
  const sourceCommit = String(sourceEvidence?.commit || '').trim();
  const sourceBranch = String(sourceEvidence?.branch || '').trim();
  const releaseCommit = String(value.releaseCommit || value.commit || value.sha || '').trim();
  const branch = String(value.branch || value.ref || '').trim();

  if (/^[0-9a-f]{40}$/i.test(releaseCommit)) {
    recorder.pass('ci.commit', 'CI repeat evidence has a full release commit', releaseCommit);
  } else {
    recorder.softFail(config, 'ci.commit', 'CI repeat evidence is missing a full commit SHA');
  }

  if (sourceCommit && releaseCommit === sourceCommit) {
    recorder.pass('ci.sourceCommit', 'CI repeat evidence matches source-control commit');
  } else {
    recorder.softFail(
      config,
      'ci.sourceCommit',
      'CI repeat evidence must match the source-control commit',
      `ci=${releaseCommit || 'missing'} source=${sourceCommit || 'missing'}`,
    );
  }

  if (branch && !hasPlaceholderSignal(branch) && (!sourceBranch || branch === sourceBranch)) {
    recorder.pass('ci.branch', 'CI repeat evidence branch matches release source', branch);
  } else {
    recorder.softFail(
      config,
      'ci.branch',
      'CI repeat evidence branch must match release source',
      `ci=${branch || 'missing'} source=${sourceBranch || 'missing'}`,
    );
  }

  const evidenceUrl = String(value.evidenceUrl || value.url || '').trim();
  if (isHttpsEvidenceUrl(evidenceUrl)) {
    recorder.pass('ci.evidenceUrl', 'CI repeat evidence has a reviewable HTTPS URL', evidenceUrl);
  } else {
    recorder.softFail(
      config,
      'ci.evidenceUrl',
      'CI repeat evidence must link to a non-placeholder HTTPS CI URL',
      evidenceUrl || 'missing',
    );
  }

  const requiredRunCount = Number(value.requiredRunCount || 0);
  const passedRunCount = Number(value.passedRunCount || 0);
  const failedRunCount = Number(value.failedRunCount || 0);
  if (requiredRunCount >= 10 && passedRunCount >= requiredRunCount && failedRunCount === 0) {
    recorder.pass(
      'ci.runCount',
      'CI repeat evidence has at least 10 passing runs',
      `${passedRunCount}/${requiredRunCount}`,
    );
  } else {
    recorder.softFail(
      config,
      'ci.runCount',
      'CI repeat evidence must prove at least 10 passing runs and zero failed runs',
      `passed=${passedRunCount} required=${requiredRunCount} failed=${failedRunCount}`,
    );
  }

  if (value.consecutivePassed === true) {
    recorder.pass('ci.consecutive', 'CI repeat evidence is consecutive');
  } else {
    recorder.softFail(config, 'ci.consecutive', 'CI repeat evidence must be consecutive');
  }

  if (
    value.isolatedInfrastructure === true &&
    value.database?.isolated === true &&
    value.database?.pgvectorEnabled === true
  ) {
    recorder.pass('ci.isolatedDb', 'CI repeat evidence used isolated pgvector Postgres');
  } else {
    recorder.softFail(
      config,
      'ci.isolatedDb',
      'CI repeat evidence must use isolated pgvector-enabled Postgres',
    );
  }

  const skippedSuites = Number(value.skippedSuiteCount || 0);
  const failedSuites = Number(value.failedSuiteCount || 0);
  if (skippedSuites === 0 && failedSuites === 0) {
    recorder.pass('ci.suites', 'CI repeat evidence has zero skipped or failed suites');
  } else {
    recorder.softFail(
      config,
      'ci.suites',
      'CI repeat evidence must have zero skipped or failed suites',
      `skipped=${skippedSuites} failed=${failedSuites}`,
    );
  }

  const privacy = value.privacy && typeof value.privacy === 'object' ? value.privacy : {};
  const unsafePrivacy = [
    'rawLogsIncluded',
    'rawRunPayloadsIncluded',
    'commandStdoutIncluded',
    'commandStderrIncluded',
    'secretsIncluded',
  ].filter((flag) => privacy[flag] === true);
  if (privacy.compactRunMetadataIncluded === true && unsafePrivacy.length === 0) {
    recorder.pass('ci.privacy', 'CI repeat evidence stores compact metadata only');
  } else {
    recorder.softFail(
      config,
      'ci.privacy',
      'CI repeat evidence must exclude raw logs, command output, and secrets',
      unsafePrivacy.join(', ') || 'compactRunMetadataIncluded missing',
    );
  }

  const requiredChecks = normalizeList(value.requiredChecks);
  const runs = Array.isArray(value.runs) ? value.runs : [];
  const badRuns = runs.filter(
    (run) =>
      run.commit !== releaseCommit ||
      run.branch !== branch ||
      !isHttpsEvidenceUrl(run.url) ||
      !isIsoTimestamp(run.completedAt) ||
      !ciRunPassed(run, requiredChecks),
  );
  if (runs.length >= requiredRunCount && badRuns.length === 0 && requiredChecks.length > 0) {
    recorder.pass(
      'ci.runs',
      'Every CI run summary is tied to the release and required checks',
      `${runs.length} run(s), ${requiredChecks.length} check(s)`,
    );
  } else {
    recorder.softFail(
      config,
      'ci.runs',
      'CI run summaries must all match release commit, branch, URL, timestamp, and checks',
      `runs=${runs.length} bad=${badRuns.length} requiredChecks=${requiredChecks.length}`,
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

  const environment = String(value.environment || '')
    .trim()
    .toLowerCase();
  if (environment === config.deployEnv) {
    recorder.pass(
      'ops.environment',
      'Operational readiness matches deploy environment',
      environment,
    );
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
    recorder.pass(
      'ops.backupRetention',
      'Database backup retention is release-grade',
      `${retention} days`,
    );
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

function verifyApiConnectivityEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'api.exists',
    'API connectivity',
    config.paths.api,
  );
  if (!artifact) {
    return;
  }

  const value = artifact.value;
  checkFreshness(config, recorder, 'api.fresh', 'API connectivity', artifact, value);

  if (value.passed === true) {
    recorder.pass('api.passed', 'API connectivity gate passed');
  } else {
    recorder.softFail(
      config,
      'api.passed',
      'API connectivity gate did not pass',
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
      'api.environment',
      'API connectivity environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'api.environment',
      'API connectivity environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const command = value.command && typeof value.command === 'object' ? value.command : {};
  if (command.ok === true) {
    recorder.pass('api.command', 'API live smoke command succeeded');
  } else {
    recorder.softFail(
      config,
      'api.command',
      'API live smoke command did not succeed',
      String(command.error || command.status || 'missing command result'),
    );
  }

  if (config.strict && command.source !== 'live-api-smoke') {
    recorder.fail(
      'api.liveSmoke',
      'Strict deploy API evidence must come from a live API smoke',
      `source=${command.source || 'missing'}`,
    );
  } else {
    recorder.pass(
      'api.liveSmoke',
      'API evidence source is acceptable',
      `source=${command.source || 'missing'}`,
    );
  }

  const target = String(value.target || value.apiUrl || '').trim();
  if (!target) {
    recorder.softFail(config, 'api.target', 'API connectivity target is missing');
  } else if (config.strict && isLocalTarget(target)) {
    recorder.fail('api.target', 'Strict deploy API evidence cannot target a local API', target);
  } else if (config.strict && hasPlaceholderSignal(target)) {
    recorder.fail(
      'api.target',
      'Strict deploy API evidence cannot target a placeholder API',
      target,
    );
  } else {
    recorder.pass('api.target', 'API connectivity target is acceptable', target);
  }

  verifyRuntimeReleaseIdentity(config, recorder, 'api', 'API connectivity', value, [
    'livez',
    'readyz',
    'health',
  ]);

  const authScheme = String(value.authScheme || '').trim();
  if (authScheme === 'api-key' || authScheme === 'bearer') {
    recorder.pass('api.authScheme', 'API auth scheme is supported', authScheme);
  } else {
    recorder.softFail(
      config,
      'api.authScheme',
      'API auth scheme is missing or unsupported',
      authScheme || 'missing',
    );
  }

  const checks = value.checks && typeof value.checks === 'object' ? value.checks : {};
  for (const [checkName, label] of [
    ['livez', 'API liveness check passed'],
    ['readyz', 'API readiness check passed'],
    ['health', 'API core health check passed'],
    ['capabilities', 'API authenticated capabilities check passed'],
    ['domainRead', 'API authenticated domain read smoke passed'],
  ]) {
    if (checks[checkName]?.ok === true) {
      recorder.pass(`api.${checkName}`, label);
    } else {
      recorder.softFail(
        config,
        `api.${checkName}`,
        label.replace(' passed', ' failed'),
        String(checks[checkName]?.error || checks[checkName]?.status || 'missing check result'),
      );
    }
  }

  const domainRead = checks.domainRead ?? {};
  if (domainRead.ok === true) {
    recorder.pass(
      'api.domainReadShape',
      'API domain read smoke proves a privacy-safe no-match list shape',
      `path=${domainRead.path || 'missing'} itemCount=${domainRead.itemCount ?? 'missing'}`,
    );
  } else {
    recorder.softFail(
      config,
      'api.domainReadShape',
      'API domain read smoke does not prove a privacy-safe no-match list shape',
      String(domainRead.error || domainRead.status || 'missing check result'),
    );
  }

  if (!String(domainRead.path || '').startsWith('/api/')) {
    recorder.softFail(
      config,
      'api.domainReadPath',
      'API domain read smoke path must start with /api/',
      String(domainRead.path || 'missing'),
    );
  } else {
    recorder.pass('api.domainReadPath', 'API domain read smoke path is API-scoped');
  }

  if (
    domainRead.responseShape === 'paginated-list' &&
    domainRead.noMatchProbe === true &&
    domainRead.itemCount === 0
  ) {
    recorder.pass('api.domainReadNoMatch', 'API domain read smoke returned zero no-match items');
  } else {
    recorder.softFail(
      config,
      'api.domainReadNoMatch',
      'API domain read smoke must use a no-match probe and return zero items',
      `shape=${domainRead.responseShape || 'missing'} noMatch=${domainRead.noMatchProbe ?? 'missing'} itemCount=${domainRead.itemCount ?? 'missing'}`,
    );
  }

  if (
    domainRead.rawItemsIncluded === false &&
    domainRead.rawBodyIncluded === false &&
    !('items' in domainRead) &&
    !('body' in domainRead) &&
    !('rawBody' in domainRead)
  ) {
    recorder.pass('api.domainReadPrivacy', 'API domain read smoke omits raw API data');
  } else {
    recorder.fail(
      'api.domainReadPrivacy',
      'API domain read smoke evidence must not include raw API response data',
    );
  }

  const readyz = checks.readyz ?? {};
  const missingReadyServices = ['db', 'redis', 'storage'].filter(
    (serviceName) => readyz[serviceName] !== true,
  );
  if (missingReadyServices.length === 0) {
    recorder.pass('api.readyServices', 'API readiness proves db, redis, and storage');
  } else {
    recorder.softFail(
      config,
      'api.readyServices',
      'API readiness is missing required service proof',
      missingReadyServices.join(', '),
    );
  }

  const health = checks.health ?? {};
  const missingCoreServices = ['db', 'redis'].filter((serviceName) => health[serviceName] !== true);
  if (missingCoreServices.length === 0) {
    recorder.pass('api.coreServices', 'API health proves db and redis');
  } else {
    recorder.softFail(
      config,
      'api.coreServices',
      'API health is missing required service proof',
      missingCoreServices.join(', '),
    );
  }

  const capabilities = checks.capabilities ?? {};
  const orgId = String(capabilities.orgId || value.tenant?.orgId || '').trim();
  const userId = String(capabilities.userId || value.tenant?.userId || '').trim();
  if (orgId && userId && !hasPlaceholderSignal(orgId) && !hasPlaceholderSignal(userId)) {
    recorder.pass(
      'api.capabilitiesContext',
      'API capabilities include user and org context',
      orgId,
    );
  } else {
    recorder.softFail(
      config,
      'api.capabilitiesContext',
      'API capabilities do not prove authenticated tenant context',
      `orgId=${orgId || 'missing'} userId=${userId || 'missing'}`,
    );
  }

  const expectedOrgId = String(value.expectedOrgId || capabilities.expectedOrgId || '').trim();
  if (expectedOrgId && hasPlaceholderSignal(expectedOrgId)) {
    recorder.fail(
      'api.expectedOrg',
      'API expected org id cannot be placeholder-like',
      expectedOrgId,
    );
  } else if (expectedOrgId && orgId !== expectedOrgId) {
    recorder.fail(
      'api.expectedOrg',
      'API capabilities org does not match expected release org',
      `expected=${expectedOrgId} actual=${orgId || 'missing'}`,
    );
  } else if (expectedOrgId) {
    recorder.pass('api.expectedOrg', 'API capabilities org matches expected release org', orgId);
  } else {
    recorder.pass('api.expectedOrg', 'API expected org check is not configured');
  }
}

function verifyPiiCiphertextEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'pii.exists',
    'PII ciphertext',
    config.paths.pii,
  );
  if (!artifact) {
    return;
  }

  const value = artifact.value;
  checkFreshness(config, recorder, 'pii.fresh', 'PII ciphertext', artifact, value);

  if (value.passed === true) {
    recorder.pass('pii.passed', 'PII ciphertext gate passed');
  } else {
    recorder.softFail(
      config,
      'pii.passed',
      'PII ciphertext gate did not pass',
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
      'pii.environment',
      'PII ciphertext environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'pii.environment',
      'PII ciphertext environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const command = value.command && typeof value.command === 'object' ? value.command : {};
  if (command.ok === true) {
    recorder.pass('pii.command', 'PII raw database scan succeeded');
  } else {
    recorder.softFail(
      config,
      'pii.command',
      'PII raw database scan did not succeed',
      String(command.error || command.status || 'missing command result'),
    );
  }

  if (config.strict && command.source !== 'raw-db-pii-ciphertext-scan') {
    recorder.fail(
      'pii.rawScan',
      'Strict deploy PII evidence must come from the raw database ciphertext scan',
      `source=${command.source || 'missing'}`,
    );
  } else {
    recorder.pass(
      'pii.rawScan',
      'PII evidence source is acceptable',
      `source=${command.source || 'missing'}`,
    );
  }

  const database = value.database && typeof value.database === 'object' ? value.database : {};
  if (database.configured === true && database.queryMode === 'raw-counts-only') {
    recorder.pass(
      'pii.database',
      'PII ciphertext evidence uses raw database count proof',
      String(database.source || 'DATABASE_URL'),
    );
  } else {
    recorder.softFail(
      config,
      'pii.database',
      'PII ciphertext evidence is missing raw database count proof',
      `configured=${database.configured === true} queryMode=${database.queryMode || 'missing'}`,
    );
  }

  const privacy = value.privacy && typeof value.privacy === 'object' ? value.privacy : {};
  const unsafePrivacyFlags = [
    ['piiValuesIncluded', 'raw PII values'],
    ['ciphertextSamplesIncluded', 'ciphertext samples'],
    ['hashesIncluded', 'email hashes'],
    ['rowIdsIncluded', 'row identifiers'],
  ].filter(([key]) => privacy[key] !== false);
  if (unsafePrivacyFlags.length === 0) {
    recorder.pass('pii.privacy', 'PII evidence omits raw values, ciphertext, hashes, and row ids');
  } else {
    recorder.fail(
      'pii.privacy',
      'PII evidence includes unsafe detail',
      unsafePrivacyFlags.map(([, label]) => label).join(', '),
    );
  }

  verifyPiiAtRestControls(config, recorder, value.atRestControls);

  const policy = value.policy && typeof value.policy === 'object' ? value.policy : {};
  const requiredModels = Array.isArray(policy.requiredModels) ? policy.requiredModels : [];
  const supportedModels = new Set(
    Array.isArray(policy.supportedModels) ? policy.supportedModels : [],
  );
  const expectedModels = ['contact', 'lead', 'kamConsultant'];
  const missingSupportedModels = expectedModels.filter((modelId) => !supportedModels.has(modelId));
  if (missingSupportedModels.length === 0) {
    recorder.pass('pii.supportedModels', 'PII evidence covers supported CRM/KAM models');
  } else {
    recorder.fail(
      'pii.supportedModels',
      'PII evidence is missing supported model coverage',
      missingSupportedModels.join(', '),
    );
  }

  const models = value.models && typeof value.models === 'object' ? value.models : {};
  for (const modelId of expectedModels) {
    const model = models[modelId] && typeof models[modelId] === 'object' ? models[modelId] : null;
    if (!model) {
      recorder.fail(`pii.${modelId}.exists`, `${modelId} PII ciphertext proof is missing`);
      continue;
    }

    if (model.passed === true) {
      recorder.pass(`pii.${modelId}.passed`, `${modelId} PII ciphertext proof passed`);
    } else {
      recorder.softFail(
        config,
        `pii.${modelId}.passed`,
        `${modelId} PII ciphertext proof did not pass`,
        Array.isArray(model.validationFailures)
          ? model.validationFailures.join(', ')
          : 'missing validationFailures',
      );
    }

    const fields = model.fields && typeof model.fields === 'object' ? model.fields : {};
    const email = fields.email && typeof fields.email === 'object' ? fields.email : null;
    if (!email) {
      recorder.fail(`pii.${modelId}.email`, `${modelId} email ciphertext counts are missing`);
    } else {
      verifyPiiFieldCounts(config, recorder, `pii.${modelId}.email`, `${modelId}.email`, email, {
        requiresHash: true,
      });
    }

    const phone = fields.phone && typeof fields.phone === 'object' ? fields.phone : null;
    if (phone) {
      verifyPiiFieldCounts(config, recorder, `pii.${modelId}.phone`, `${modelId}.phone`, phone, {
        requiresHash: false,
      });
    }
  }

  for (const modelId of requiredModels) {
    const emailRows = Number(models[modelId]?.fields?.email?.nonNull ?? 0);
    if (!expectedModels.includes(modelId)) {
      recorder.fail(
        'pii.requiredModels',
        'PII evidence names an unsupported required model',
        modelId,
      );
    } else if (config.strict && emailRows <= 0) {
      recorder.fail(
        `pii.${modelId}.requiredRows`,
        `Strict PII evidence requires non-empty ${modelId}.email coverage`,
        String(emailRows),
      );
    } else {
      recorder.pass(
        `pii.${modelId}.requiredRows`,
        `${modelId} required PII coverage is acceptable`,
        String(emailRows),
      );
    }
  }

  const totals = value.totals && typeof value.totals === 'object' ? value.totals : {};
  if (Number(totals.plaintextValues ?? 0) === 0) {
    recorder.pass('pii.totals.plaintext', 'PII totals report zero plaintext values');
  } else {
    recorder.fail(
      'pii.totals.plaintext',
      'PII totals include plaintext values',
      String(totals.plaintextValues),
    );
  }

  if (!config.strict || Number(totals.emailRows ?? 0) > 0) {
    recorder.pass('pii.totals.emailRows', 'PII totals include release email coverage');
  } else {
    recorder.fail(
      'pii.totals.emailRows',
      'Strict PII evidence requires at least one email row',
      String(totals.emailRows ?? 'missing'),
    );
  }
}

function evidenceValueIsReviewable(value) {
  const normalized = String(value || '').trim();
  return normalized.length >= 12 && !hasPlaceholderSignal(normalized);
}

function verifyPiiAtRestControls(config, recorder, controls) {
  const posture = controls && typeof controls === 'object' ? controls : {};
  const storage =
    posture.storageEncryption && typeof posture.storageEncryption === 'object'
      ? posture.storageEncryption
      : {};
  const userEmail =
    posture.userEmail && typeof posture.userEmail === 'object' ? posture.userEmail : {};
  const plaintextPii =
    posture.plaintextPii && typeof posture.plaintextPii === 'object' ? posture.plaintextPii : {};

  if (storage.enabled === true) {
    recorder.pass('pii.storageEncryption.enabled', 'PII storage encryption is explicitly enabled');
  } else {
    recorder.softFail(
      config,
      'pii.storageEncryption.enabled',
      'PII storage encryption must be explicitly enabled',
      `enabled=${storage.enabled ?? 'missing'}`,
    );
  }

  if (evidenceValueIsReviewable(storage.provider)) {
    recorder.pass(
      'pii.storageEncryption.provider',
      'PII storage encryption provider/control is reviewable',
      String(storage.provider),
    );
  } else {
    recorder.softFail(
      config,
      'pii.storageEncryption.provider',
      'PII storage encryption provider/control is missing or placeholder',
      String(storage.provider || 'missing'),
    );
  }

  if (evidenceValueIsReviewable(storage.evidenceRef)) {
    recorder.pass(
      'pii.storageEncryption.evidence',
      'PII storage encryption has reviewable evidence',
      String(storage.evidenceRef),
    );
  } else {
    recorder.softFail(
      config,
      'pii.storageEncryption.evidence',
      'PII storage encryption evidence is missing or placeholder',
      String(storage.evidenceRef || 'missing'),
    );
  }

  if (storage.rawConfigIncluded === false) {
    recorder.pass(
      'pii.storageEncryption.privacy',
      'PII storage encryption evidence omits raw config',
    );
  } else {
    recorder.fail(
      'pii.storageEncryption.privacy',
      'PII storage encryption evidence includes unsafe raw config',
      `rawConfigIncluded=${storage.rawConfigIncluded ?? 'missing'}`,
    );
  }

  if (userEmail.fieldEncryptedByPiiMiddleware === false) {
    recorder.pass(
      'pii.userEmail.posture',
      'User.email field-encryption posture is explicit',
      'storage-level-only in current schema',
    );
  } else {
    recorder.softFail(
      config,
      'pii.userEmail.posture',
      'User.email field-encryption posture is missing or unsupported',
      `fieldEncryptedByPiiMiddleware=${userEmail.fieldEncryptedByPiiMiddleware ?? 'missing'}`,
    );
  }

  if (userEmail.decision === USER_EMAIL_STORAGE_ONLY_DECISION) {
    recorder.pass(
      'pii.userEmail.decision',
      'User.email at-rest decision is accepted for this schema',
      userEmail.decision,
    );
  } else {
    recorder.softFail(
      config,
      'pii.userEmail.decision',
      'User.email at-rest decision is missing or unsupported',
      `expected=${USER_EMAIL_STORAGE_ONLY_DECISION} actual=${userEmail.decision || 'missing'}`,
    );
  }

  if (evidenceValueIsReviewable(userEmail.decisionRef)) {
    recorder.pass(
      'pii.userEmail.decisionRef',
      'User.email at-rest decision has reviewable evidence',
      String(userEmail.decisionRef),
    );
  } else {
    recorder.softFail(
      config,
      'pii.userEmail.decisionRef',
      'User.email at-rest decision evidence is missing or placeholder',
      String(userEmail.decisionRef || 'missing'),
    );
  }

  if (evidenceValueIsReviewable(userEmail.owner)) {
    recorder.pass(
      'pii.userEmail.owner',
      'User.email at-rest decision owner is reviewable',
      String(userEmail.owner),
    );
  } else {
    recorder.softFail(
      config,
      'pii.userEmail.owner',
      'User.email at-rest decision owner is missing or placeholder',
      String(userEmail.owner || 'missing'),
    );
  }

  if (userEmail.rawEmailsIncluded === false) {
    recorder.pass('pii.userEmail.privacy', 'PII evidence omits raw User.email values');
  } else {
    recorder.fail(
      'pii.userEmail.privacy',
      'PII evidence includes raw User.email values',
      `rawEmailsIncluded=${userEmail.rawEmailsIncluded ?? 'missing'}`,
    );
  }

  if (plaintextPii.fieldEncryptedByPiiMiddleware === false) {
    recorder.pass(
      'pii.plaintextPii.posture',
      'Plaintext-PII field-encryption posture is explicit',
      'storage-level-only in current schema',
    );
  } else {
    recorder.softFail(
      config,
      'pii.plaintextPii.posture',
      'Plaintext-PII field-encryption posture is missing or unsupported',
      `fieldEncryptedByPiiMiddleware=${plaintextPii.fieldEncryptedByPiiMiddleware ?? 'missing'}`,
    );
  }

  if (plaintextPii.decision === PLAINTEXT_PII_STORAGE_ONLY_DECISION) {
    recorder.pass(
      'pii.plaintextPii.decision',
      'Plaintext-PII at-rest decision is accepted for this schema',
      plaintextPii.decision,
    );
  } else {
    recorder.softFail(
      config,
      'pii.plaintextPii.decision',
      'Plaintext-PII at-rest decision is missing or unsupported',
      `expected=${PLAINTEXT_PII_STORAGE_ONLY_DECISION} actual=${
        plaintextPii.decision || 'missing'
      }`,
    );
  }

  if (evidenceValueIsReviewable(plaintextPii.decisionRef)) {
    recorder.pass(
      'pii.plaintextPii.decisionRef',
      'Plaintext-PII at-rest decision has reviewable evidence',
      String(plaintextPii.decisionRef),
    );
  } else {
    recorder.softFail(
      config,
      'pii.plaintextPii.decisionRef',
      'Plaintext-PII at-rest decision evidence is missing or placeholder',
      String(plaintextPii.decisionRef || 'missing'),
    );
  }

  if (evidenceValueIsReviewable(plaintextPii.owner)) {
    recorder.pass(
      'pii.plaintextPii.owner',
      'Plaintext-PII at-rest decision owner is reviewable',
      String(plaintextPii.owner),
    );
  } else {
    recorder.softFail(
      config,
      'pii.plaintextPii.owner',
      'Plaintext-PII at-rest decision owner is missing or placeholder',
      String(plaintextPii.owner || 'missing'),
    );
  }

  const acceptedFields = Array.isArray(plaintextPii.acceptedFields)
    ? plaintextPii.acceptedFields
    : [];
  const missingFields = REQUIRED_PLAINTEXT_PII_FIELDS.filter(
    (field) => !acceptedFields.includes(field),
  );
  const unsupportedFields = acceptedFields.filter(
    (field) => !REQUIRED_PLAINTEXT_PII_FIELDS.includes(field),
  );
  if (missingFields.length === 0 && unsupportedFields.length === 0) {
    recorder.pass(
      'pii.plaintextPii.scope',
      'Plaintext-PII at-rest decision covers every required field',
      `${acceptedFields.length} field(s)`,
    );
  } else {
    recorder.softFail(
      config,
      'pii.plaintextPii.scope',
      'Plaintext-PII at-rest decision field scope is incomplete or invalid',
      [
        missingFields.length ? `missing=${missingFields.join(',')}` : '',
        unsupportedFields.length ? `unsupported=${unsupportedFields.join(',')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  if (plaintextPii.rawValuesIncluded === false) {
    recorder.pass('pii.plaintextPii.privacy', 'PII evidence omits raw plaintext-PII values');
  } else {
    recorder.fail(
      'pii.plaintextPii.privacy',
      'PII evidence includes raw plaintext-PII values',
      `rawValuesIncluded=${plaintextPii.rawValuesIncluded ?? 'missing'}`,
    );
  }
}

function verifyPiiFieldCounts(config, recorder, id, label, field, options) {
  const nonNull = Number(field.nonNull ?? 0);
  const encrypted = Number(field.encrypted ?? 0);
  const plaintext = Number(field.plaintext ?? 0);

  if (plaintext === 0) {
    recorder.pass(`${id}.plaintext`, `${label} has zero plaintext rows`);
  } else {
    recorder.fail(`${id}.plaintext`, `${label} has plaintext rows`, String(plaintext));
  }

  if (encrypted === nonNull) {
    recorder.pass(`${id}.encrypted`, `${label} encrypted count matches non-null count`);
  } else {
    recorder.fail(
      `${id}.encrypted`,
      `${label} encrypted count does not match non-null count`,
      `encrypted=${encrypted} nonNull=${nonNull}`,
    );
  }

  if (options.requiresHash) {
    const hashValid = Number(field.hashValid ?? 0);
    const hashInvalid = Number(field.hashInvalid ?? 0);
    if (hashInvalid === 0 && hashValid === nonNull) {
      recorder.pass(`${id}.hash`, `${label} email hashes match encrypted lookup contract`);
    } else {
      recorder.softFail(
        config,
        `${id}.hash`,
        `${label} email hashes do not match encrypted lookup contract`,
        `hashValid=${hashValid} hashInvalid=${hashInvalid} nonNull=${nonNull}`,
      );
    }
  }
}

function verifyWebhookSecretCiphertextEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'webhooks.exists',
    'Webhook secret ciphertext',
    config.paths.webhooks,
  );
  if (!artifact) {
    return;
  }

  const value = artifact.value;
  checkFreshness(config, recorder, 'webhooks.fresh', 'Webhook secret ciphertext', artifact, value);

  if (value.passed === true) {
    recorder.pass('webhooks.passed', 'Webhook secret ciphertext gate passed');
  } else {
    recorder.softFail(
      config,
      'webhooks.passed',
      'Webhook secret ciphertext gate did not pass',
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
      'webhooks.environment',
      'Webhook secret ciphertext environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'webhooks.environment',
      'Webhook secret ciphertext environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const command = value.command && typeof value.command === 'object' ? value.command : {};
  if (command.ok === true) {
    recorder.pass('webhooks.command', 'Webhook raw database scan succeeded');
  } else {
    recorder.softFail(
      config,
      'webhooks.command',
      'Webhook raw database scan did not succeed',
      String(command.error || command.status || 'missing command result'),
    );
  }

  if (config.strict && command.source !== 'raw-db-webhook-secret-scan') {
    recorder.fail(
      'webhooks.rawScan',
      'Strict deploy webhook evidence must come from the raw database secret scan',
      `source=${command.source || 'missing'}`,
    );
  } else {
    recorder.pass(
      'webhooks.rawScan',
      'Webhook evidence source is acceptable',
      `source=${command.source || 'missing'}`,
    );
  }

  const database = value.database && typeof value.database === 'object' ? value.database : {};
  if (database.configured === true && database.queryMode === 'raw-secret-decrypt-counts') {
    recorder.pass(
      'webhooks.database',
      'Webhook secret evidence uses raw decrypt count proof',
      String(database.source || 'DATABASE_URL'),
    );
  } else {
    recorder.softFail(
      config,
      'webhooks.database',
      'Webhook secret evidence is missing raw decrypt count proof',
      `configured=${database.configured === true} queryMode=${database.queryMode || 'missing'}`,
    );
  }

  const privacy = value.privacy && typeof value.privacy === 'object' ? value.privacy : {};
  const unsafePrivacyFlags = [
    ['secretValuesIncluded', 'raw secret values'],
    ['ciphertextSamplesIncluded', 'ciphertext samples'],
    ['rowIdsIncluded', 'row identifiers'],
    ['urlsIncluded', 'webhook URLs'],
    ['eventListsIncluded', 'event lists'],
    ['secretHashesIncluded', 'secret hashes'],
  ].filter(([key]) => privacy[key] !== false);
  if (unsafePrivacyFlags.length === 0) {
    recorder.pass(
      'webhooks.privacy',
      'Webhook evidence omits raw secrets, ciphertext, row ids, URLs, event lists, and secret hashes',
    );
  } else {
    recorder.fail(
      'webhooks.privacy',
      'Webhook evidence includes unsafe detail',
      unsafePrivacyFlags.map(([, label]) => label).join(', '),
    );
  }

  const policy = value.policy && typeof value.policy === 'object' ? value.policy : {};
  if (policy.plaintextFallbackAllowed === false) {
    recorder.pass('webhooks.fallback', 'Webhook plaintext fallback is not certified as enabled');
  } else {
    recorder.fail(
      'webhooks.fallback',
      'Webhook plaintext fallback must not be enabled in release evidence',
      String(policy.plaintextFallbackAllowed ?? 'missing'),
    );
  }

  const totals = value.totals && typeof value.totals === 'object' ? value.totals : {};
  const totalRows = Number(totals.totalRows ?? 0);
  const decryptable = Number(totals.encryptedDecryptableRows ?? 0);
  const legacy = Number(totals.legacyPlaintextRows ?? 0);
  const unreadable = Number(totals.unreadableRows ?? 0);
  const empty = Number(totals.emptySecretRows ?? 0);
  const hashPresent = Number(totals.secretHashPresentRows ?? 0);
  const hashMissing = Number(totals.secretHashMissingRows ?? 0);
  const hashInvalid = Number(totals.secretHashInvalidRows ?? 0);

  if (legacy === 0) {
    recorder.pass(
      'webhooks.totals.legacyPlaintext',
      'Webhook totals report zero legacy plaintext rows',
    );
  } else {
    recorder.fail(
      'webhooks.totals.legacyPlaintext',
      'Webhook totals include legacy plaintext rows',
      String(legacy),
    );
  }

  if (unreadable === 0) {
    recorder.pass('webhooks.totals.unreadable', 'Webhook totals report zero unreadable rows');
  } else {
    recorder.fail(
      'webhooks.totals.unreadable',
      'Webhook totals include unreadable rows',
      String(unreadable),
    );
  }

  if (empty === 0) {
    recorder.pass('webhooks.totals.empty', 'Webhook totals report zero empty secret rows');
  } else {
    recorder.fail(
      'webhooks.totals.empty',
      'Webhook totals include empty secret rows',
      String(empty),
    );
  }

  if (decryptable === totalRows) {
    recorder.pass(
      'webhooks.totals.decryptable',
      'Webhook decryptable count matches total row count',
      String(totalRows),
    );
  } else {
    recorder.fail(
      'webhooks.totals.decryptable',
      'Webhook decryptable count does not match total row count',
      `decryptable=${decryptable} total=${totalRows}`,
    );
  }

  if (hashMissing === 0) {
    recorder.pass(
      'webhooks.totals.hashMissing',
      'Webhook totals report zero missing secret hashes',
    );
  } else {
    recorder.fail(
      'webhooks.totals.hashMissing',
      'Webhook totals include rows missing secret hashes',
      String(hashMissing),
    );
  }

  if (hashInvalid === 0) {
    recorder.pass(
      'webhooks.totals.hashInvalid',
      'Webhook totals report zero invalid secret hashes',
    );
  } else {
    recorder.fail(
      'webhooks.totals.hashInvalid',
      'Webhook totals include invalid secret hashes',
      String(hashInvalid),
    );
  }

  if (hashPresent === decryptable) {
    recorder.pass(
      'webhooks.totals.hashPresent',
      'Webhook secret hash count matches decryptable row count',
      String(hashPresent),
    );
  } else {
    recorder.fail(
      'webhooks.totals.hashPresent',
      'Webhook secret hash count does not match decryptable row count',
      `hashPresent=${hashPresent} decryptable=${decryptable}`,
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
    const scanner = String(value.scanner || '')
      .trim()
      .toLowerCase();
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
      recorder.pass(
        'semgrep.reportShape',
        'Semgrep evidence preserves raw result and error arrays',
      );
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
      recorder.pass(
        'semgrep.dockerfileSyntax',
        'Dockerfile syntax check passed with Semgrep evidence',
      );
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
    recorder.softFail(
      config,
      'container.immutableRefs',
      'Container scan image references are missing',
    );
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
        missingRawReportImages.length > 0
          ? missingRawReportImages.join(', ')
          : 'missing image reports',
      );
    } else {
      recorder.pass(
        'container.rawReports',
        'Container scan has raw Trivy JSON report proof',
        `${reports.length} raw report(s)`,
      );
    }

    const missingSbomReportImages = reports
      .map((report) => {
        const proofPath = resolvePathInsideRoot(
          config.root,
          report?.sbomReportPath || report?.cycloneDxSbomPath || report?.sbomPath || '',
        );
        return {
          image: report?.image || 'unknown-image',
          proofPath,
          valid:
            Boolean(proofPath.raw) &&
            proofPath.insideRoot &&
            fileHasCycloneDxSbom(proofPath.absolutePath),
        };
      })
      .filter((item) => !item.valid)
      .map((item) => item.image);

    if (reports.length === 0 || missingSbomReportImages.length > 0) {
      recorder.fail(
        'container.sbomReports',
        'Strict container evidence needs CycloneDX SBOM JSON reports',
        missingSbomReportImages.length > 0
          ? missingSbomReportImages.join(', ')
          : 'missing image reports',
      );
    } else {
      recorder.pass(
        'container.sbomReports',
        'Container scan has CycloneDX SBOM proof',
        `${reports.length} SBOM report(s)`,
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
      recorder.pass(
        'secrets.ownerApprover',
        'Secret disposition has a named owner approver',
        ownerApprover,
      );
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
      recorder.pass(
        'secrets.ownerApprovalTicket',
        'Secret disposition has an owner approval ticket',
        approvalTicket,
      );
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
      recorder.pass(
        'secrets.ownerApprovedAt',
        'Secret owner approval has an ISO timestamp',
        ownerApprovedAt,
      );
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
      recorder.pass(
        'secrets.rotationVerifiedAt',
        'Historical secret rotation has an ISO timestamp',
        rotationVerifiedAt,
      );
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
  const rawReports =
    value?.rawReports && typeof value.rawReports === 'object' ? value.rawReports : {};
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
    proofPath.raw
      ? 'raw report path is missing, outside the repo, or invalid JSON'
      : 'missing raw report path',
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

  if (value.passed === true) {
    recorder.pass('sentry.passed', 'Sentry smoke evidence gate passed');
  } else {
    recorder.softFail(
      config,
      'sentry.passed',
      'Sentry smoke evidence gate did not pass',
      Array.isArray(value.validationFailures)
        ? value.validationFailures.join(', ')
        : 'missing validationFailures',
    );
  }

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
  if (release && !hasPlaceholderSignal(release)) {
    recorder.pass('sentry.release', 'Sentry smoke is tied to a release', release);
  } else {
    recorder.softFail(
      config,
      'sentry.release',
      'Sentry smoke evidence needs a non-placeholder release',
      release || 'missing',
    );
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

  verifySentryProjectEvidence(config, recorder, value);
  verifySentryObservation(config, recorder, 'api', 'API', value.apiEvidence, {
    project: value.projects?.api,
    marker: value.markers?.api || 'bidstack-api-sentry-smoke',
    release,
    environment: evidenceEnvironment,
  });
  verifySentryObservation(config, recorder, 'worker', 'Worker', value.workerEvidence, {
    project: value.projects?.worker,
    marker: value.markers?.worker || 'bidstack-worker-sentry-smoke',
    release,
    environment: evidenceEnvironment,
  });
  verifySentryRawPrivacy(recorder, value);

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

function verifySentryProjectEvidence(config, recorder, value) {
  const organization = String(value.organization || value.org || '').trim();
  if (organization && !hasPlaceholderSignal(organization)) {
    recorder.pass('sentry.organization', 'Sentry organization is reviewable', organization);
  } else {
    recorder.softFail(
      config,
      'sentry.organization',
      'Sentry organization is missing or placeholder',
      organization || 'missing',
    );
  }

  const projects = value.projects && typeof value.projects === 'object' ? value.projects : {};
  const missingProjects = ['api', 'worker'].filter((key) => {
    const project = String(projects[key] || '').trim();
    return !project || hasPlaceholderSignal(project);
  });
  if (missingProjects.length === 0) {
    recorder.pass(
      'sentry.projects',
      'Sentry API and worker projects are reviewable',
      `api=${projects.api} worker=${projects.worker}`,
    );
  } else {
    recorder.softFail(
      config,
      'sentry.projects',
      'Sentry project evidence is missing or placeholder',
      missingProjects.join(', '),
    );
  }
}

function verifySentryObservation(config, recorder, id, label, observation, expected) {
  const value = observation && typeof observation === 'object' ? observation : {};
  const target = String(value.target || '').trim();
  const query = String(value.query || '').trim();
  const project = String(expected.project || '').trim();
  const marker = String(expected.marker || '').trim();
  const release = String(expected.release || '').trim();
  const environment = String(expected.environment || '').trim();
  const issues = Array.isArray(value.issues) ? value.issues : [];

  if (value.command?.passed === true) {
    recorder.pass(`sentry.${id}.command`, `${label} Sentry issue query succeeded`);
  } else {
    recorder.softFail(
      config,
      `sentry.${id}.command`,
      `${label} Sentry issue query did not succeed`,
      String(value.command?.error || value.command?.exitCode || 'missing command proof'),
    );
  }

  if (!target) {
    recorder.softFail(config, `sentry.${id}.target`, `${label} Sentry target is missing`);
  } else if (hasPlaceholderSignal(target)) {
    recorder.softFail(
      config,
      `sentry.${id}.target`,
      `${label} Sentry target is placeholder-like`,
      target,
    );
  } else if (project && !target.includes(project)) {
    recorder.softFail(
      config,
      `sentry.${id}.target`,
      `${label} Sentry target does not include expected project`,
      `target=${target} project=${project}`,
    );
  } else {
    recorder.pass(`sentry.${id}.target`, `${label} Sentry target is reviewable`, target);
  }

  const missingQueryParts = [
    marker && !query.includes(marker) ? `marker=${marker}` : '',
    release && !query.includes(release) ? `release=${release}` : '',
    environment && !query.includes(environment) ? `environment=${environment}` : '',
  ].filter(Boolean);
  if (query && missingQueryParts.length === 0) {
    recorder.pass(`sentry.${id}.query`, `${label} Sentry query is release-scoped`, query);
  } else {
    recorder.softFail(
      config,
      `sentry.${id}.query`,
      `${label} Sentry query is missing release scope`,
      missingQueryParts.join(' ') || 'missing query',
    );
  }

  if (value.observed === true && Number(value.issueCount ?? 0) > 0) {
    recorder.pass(`sentry.${id}.observed`, `${label} Sentry smoke issue was observed`);
  } else {
    recorder.softFail(
      config,
      `sentry.${id}.observed`,
      `${label} Sentry smoke issue was not observed`,
      `issueCount=${value.issueCount ?? 'missing'}`,
    );
  }

  if (issues.length > 0 && (!project || issues.some((issue) => issue?.project === project))) {
    recorder.pass(
      `sentry.${id}.project`,
      `${label} Sentry issue metadata includes expected project`,
      project || 'not configured',
    );
  } else {
    recorder.softFail(
      config,
      `sentry.${id}.project`,
      `${label} Sentry issue metadata does not include expected project`,
      project || 'missing project',
    );
  }
}

function verifySentryRawPrivacy(recorder, artifact) {
  const value = artifact && typeof artifact === 'object' ? artifact : {};
  const privacy = value.privacy && typeof value.privacy === 'object' ? value.privacy : {};
  const unsafeFlags = [
    ['rawEventPayloadsIncluded', 'raw event payloads'],
    ['stackTracesIncluded', 'stack traces'],
    ['requestBodiesIncluded', 'request bodies'],
    ['userEmailsIncluded', 'user emails'],
    ['commandStdoutIncluded', 'raw command stdout'],
    ['commandStderrIncluded', 'raw command stderr'],
  ].filter(([key]) => privacy[key] !== false);

  // The flags above are self-reported by the writer and can drift from reality (that was
  // the bug: they claimed `false` while raw CLI stderr / response bodies were actually
  // embedded elsewhere in the artifact). Independently walk the serialized artifact for the
  // concrete forbidden shapes so a future regression fails this gate instead of silently
  // passing on stale flags.
  const rawContentLeaks = [];
  const scanForRawContent = (node, keyPath) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => scanForRawContent(item, `${keyPath}[${index}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = keyPath ? `${keyPath}.${key}` : key;
      if (key === 'bodyPreview') {
        rawContentLeaks.push(`${childPath} persists a raw response body preview`);
        continue;
      }
      if (key === 'error' && typeof child === 'string' && /[\r\n]/.test(child)) {
        rawContentLeaks.push(`${childPath} persists newline-joined raw command output`);
        continue;
      }
      scanForRawContent(child, childPath);
    }
  };
  scanForRawContent(value, '');

  if (unsafeFlags.length === 0 && rawContentLeaks.length === 0) {
    recorder.pass(
      'sentry.rawPrivacy',
      'Sentry evidence omits raw events, stack traces, bodies, users, and command output',
    );
  } else {
    recorder.fail(
      'sentry.rawPrivacy',
      'Sentry evidence includes unsafe raw detail',
      [...unsafeFlags.map(([, label]) => label), ...rawContentLeaks].join(', '),
    );
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
    recorder.pass(
      'providers.target',
      'Provider quality target is acceptable',
      String(value.target),
    );
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
        .map(
          (check) =>
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

function verifyMcpConnectivityEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'mcp.exists',
    'MCP connectivity',
    config.paths.mcp,
  );
  if (!artifact) {
    return;
  }

  const value = artifact.value;
  checkFreshness(config, recorder, 'mcp.fresh', 'MCP connectivity', artifact, value);

  if (value.passed === true) {
    recorder.pass('mcp.passed', 'MCP connectivity gate passed');
  } else {
    recorder.softFail(
      config,
      'mcp.passed',
      'MCP connectivity gate did not pass',
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
      'mcp.environment',
      'MCP connectivity environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'mcp.environment',
      'MCP connectivity environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  const command = value.command && typeof value.command === 'object' ? value.command : {};
  if (command.ok === true) {
    recorder.pass('mcp.command', 'MCP live smoke command succeeded');
  } else {
    recorder.softFail(
      config,
      'mcp.command',
      'MCP live smoke command did not succeed',
      String(command.error || command.status || 'missing command result'),
    );
  }

  if (config.strict && command.source !== 'live-mcp-smoke') {
    recorder.fail(
      'mcp.liveSmoke',
      'Strict deploy MCP evidence must come from a live MCP smoke',
      `source=${command.source || 'missing'}`,
    );
  } else {
    recorder.pass(
      'mcp.liveSmoke',
      'MCP evidence source is acceptable',
      `source=${command.source || 'missing'}`,
    );
  }

  const target = String(value.mcpUrl || value.target || '').trim();
  if (!target) {
    recorder.softFail(config, 'mcp.target', 'MCP connectivity target is missing');
  } else if (config.strict && isLocalTarget(target)) {
    recorder.fail(
      'mcp.target',
      'Strict deploy MCP evidence cannot target a local MCP server',
      target,
    );
  } else if (config.strict && hasPlaceholderSignal(target)) {
    recorder.fail(
      'mcp.target',
      'Strict deploy MCP evidence cannot target a placeholder MCP server',
      target,
    );
  } else {
    recorder.pass('mcp.target', 'MCP connectivity target is acceptable', target);
  }

  verifyRuntimeReleaseIdentity(config, recorder, 'mcp', 'MCP connectivity', value, [
    'discovery',
    'health',
  ]);

  const checks = value.checks && typeof value.checks === 'object' ? value.checks : {};
  for (const [checkName, label] of [
    ['discovery', 'MCP discovery check passed'],
    ['health', 'MCP health check passed'],
    ['initialize', 'MCP initialize check passed'],
    ['initialized', 'MCP initialized notification check passed'],
    ['toolsList', 'MCP tools/list check passed'],
    ['toolCall', 'MCP tools/call smoke passed'],
  ]) {
    if (checks[checkName]?.ok === true) {
      recorder.pass(`mcp.${checkName}`, label);
    } else {
      recorder.softFail(
        config,
        `mcp.${checkName}`,
        label.replace(' passed', ' failed'),
        String(checks[checkName]?.error || checks[checkName]?.status || 'missing check result'),
      );
    }
  }

  const toolNames = normalizeList(value.tools);
  const toolCount =
    Number.isFinite(Number(value.toolCount)) && Number(value.toolCount) >= 0
      ? Number(value.toolCount)
      : toolNames.length;
  if (toolCount > 0 && toolNames.length > 0) {
    recorder.pass('mcp.toolCount', 'MCP tools/list returned tools', `${toolCount} tool(s)`);
  } else {
    recorder.softFail(config, 'mcp.toolCount', 'MCP tools/list returned no tools');
  }

  const placeholderRequiredTools = config.requiredMcpTools.filter((toolName) =>
    hasPlaceholderSignal(toolName),
  );
  if (placeholderRequiredTools.length > 0) {
    recorder.fail(
      'mcp.requiredTools',
      'MCP required tool list contains placeholders',
      placeholderRequiredTools.join(', '),
    );
    return;
  }

  const observedTools = new Set(toolNames);
  const missingRequiredTools = config.requiredMcpTools.filter(
    (toolName) => !observedTools.has(toolName),
  );
  const artifactMissingRequiredTools = normalizeList(checks.toolsList?.missingRequiredTools);
  const combinedMissing = [...new Set([...missingRequiredTools, ...artifactMissingRequiredTools])];
  if (combinedMissing.length === 0) {
    recorder.pass(
      'mcp.requiredTools',
      'MCP tools/list covers required release tools',
      config.requiredMcpTools.join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'mcp.requiredTools',
      'MCP tools/list is missing required release tools',
      combinedMissing.join(', '),
    );
  }

  const toolCall = checks.toolCall && typeof checks.toolCall === 'object' ? checks.toolCall : {};
  const smokeToolName = String(toolCall.toolName || '').trim();
  if (!smokeToolName) {
    recorder.softFail(config, 'mcp.toolCallName', 'MCP tools/call smoke tool name is missing');
  } else if (config.strict && hasPlaceholderSignal(smokeToolName)) {
    recorder.fail(
      'mcp.toolCallName',
      'MCP tools/call smoke tool name cannot be a placeholder',
      smokeToolName,
    );
  } else if (toolNames.length > 0 && !observedTools.has(smokeToolName)) {
    recorder.softFail(
      config,
      'mcp.toolCallName',
      'MCP tools/call smoke tool was not present in tools/list',
      smokeToolName,
    );
  } else {
    recorder.pass('mcp.toolCallName', 'MCP tools/call smoke tool is listed', smokeToolName);
  }

  const contentItemCount = Number(toolCall.contentItemCount ?? 0);
  if (contentItemCount > 0 || toolCall.structuredContentPresent === true) {
    recorder.pass(
      'mcp.toolCallResultShape',
      'MCP tools/call smoke returned a result shape',
      contentItemCount > 0 ? `${contentItemCount} content item(s)` : 'structuredContent present',
    );
  } else {
    recorder.softFail(
      config,
      'mcp.toolCallResultShape',
      'MCP tools/call smoke did not return a result shape',
      String(toolCall.status || toolCall.jsonRpcErrorCode || 'missing result shape'),
    );
  }

  const rawOutputFields = ['content', 'result', 'rawOutput', 'body', 'records'].filter((field) =>
    Object.prototype.hasOwnProperty.call(toolCall, field),
  );
  if (
    toolCall.rawOutputIncluded === false &&
    toolCall.rawArgumentsIncluded === false &&
    rawOutputFields.length === 0
  ) {
    recorder.pass('mcp.toolCallPrivacy', 'MCP tools/call evidence omits raw args and output');
  } else {
    recorder.fail(
      'mcp.toolCallPrivacy',
      'MCP tools/call evidence must not include raw args or output',
      rawOutputFields.length > 0 ? rawOutputFields.join(', ') : 'privacy flag mismatch',
    );
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

function verifyA11yEvidence(config, recorder) {
  const artifact = readJsonArtifact(
    config,
    recorder,
    'a11y.exists',
    'Accessibility regression',
    config.paths.a11y,
  );
  if (!artifact) {
    return;
  }
  const value = artifact.value;
  checkFreshness(config, recorder, 'a11y.fresh', 'Accessibility regression', artifact, value);

  if (
    value.passed === true &&
    (value.commandExitCode === undefined || value.commandExitCode === 0)
  ) {
    recorder.pass(
      'a11y.passed',
      'Accessibility regression gate passed',
      `profile=${value.profile ?? 'unknown'}`,
    );
  } else {
    recorder.softFail(
      config,
      'a11y.passed',
      'Accessibility regression gate did not pass',
      `exit=${value.commandExitCode ?? 'unknown'}`,
    );
  }

  if (config.strict && !ACCEPTED_A11Y_PROFILES.has(String(value.profile || ''))) {
    recorder.fail(
      'a11y.profile',
      'Accessibility profile must be WCAG keyboard or release a11y',
      `profile=${value.profile ?? 'missing'}`,
    );
  } else {
    recorder.pass(
      'a11y.profile',
      'Accessibility profile is acceptable',
      `profile=${value.profile ?? 'unknown'}`,
    );
  }

  if (config.strict && isLocalTarget(value.target || value.baseURL || value.webBaseUrl || '')) {
    recorder.fail(
      'a11y.target',
      'Strict deploy accessibility evidence cannot target a local app',
      String(value.target || value.baseURL || value.webBaseUrl || 'missing'),
    );
  } else if (value.target || value.baseURL || value.webBaseUrl) {
    recorder.pass(
      'a11y.target',
      'Accessibility target is acceptable',
      String(value.target || value.baseURL || value.webBaseUrl),
    );
  } else {
    recorder.softFail(config, 'a11y.target', 'Accessibility target is missing');
  }

  const evidenceEnvironment = normalizeOptionalEnvironment(
    value.environment || value.deployEnv || value.e2eEnvironment || '',
  );
  if (!config.strict || evidenceEnvironment === config.deployEnv) {
    recorder.pass(
      'a11y.environment',
      'Accessibility environment is acceptable',
      evidenceEnvironment || 'unspecified',
    );
  } else {
    recorder.fail(
      'a11y.environment',
      'Accessibility environment does not match deploy target',
      `expected=${config.deployEnv} actual=${evidenceEnvironment || 'missing'}`,
    );
  }

  if (value.productionBuild === true) {
    recorder.pass('a11y.productionBuild', 'Accessibility evidence used a production build');
  } else {
    recorder.softFail(
      config,
      'a11y.productionBuild',
      'Accessibility evidence did not prove production build coverage',
    );
  }

  if (value.clerkBackedAuth === true || String(value.authMode || '').toLowerCase() === 'clerk') {
    recorder.pass('a11y.auth', 'Accessibility evidence used Clerk-backed auth');
  } else {
    recorder.softFail(
      config,
      'a11y.auth',
      'Accessibility evidence did not prove Clerk-backed auth',
    );
  }

  const sourceReportPath = resolvePathInsideRoot(
    config.root,
    value.sourceReport || value.playwrightJsonReport || value.reportPath || '',
  );
  if (
    sourceReportPath.raw &&
    sourceReportPath.insideRoot &&
    fileHasValidJson(sourceReportPath.absolutePath)
  ) {
    recorder.pass(
      'a11y.sourceReport',
      'Accessibility evidence has a Playwright JSON source report',
      sourceReportPath.raw,
    );
  } else {
    recorder.softFail(
      config,
      'a11y.sourceReport',
      'Accessibility source report is missing, invalid, or outside the repo',
      sourceReportPath.raw || 'missing',
    );
  }

  const playwrightCommand = String(
    value.playwrightCommand || value.command || value.commandText || '',
  ).trim();
  const commandLooksLikePlaywright =
    /\bplaywright(?:\.cmd)?\b/i.test(playwrightCommand) && /\btest\b/i.test(playwrightCommand);
  if (commandLooksLikePlaywright) {
    recorder.pass(
      'a11y.command',
      'Accessibility evidence records the Playwright test command',
      playwrightCommand,
    );
  } else {
    recorder.softFail(
      config,
      'a11y.command',
      'Accessibility evidence does not record a Playwright test command',
      playwrightCommand || 'missing',
    );
  }

  const projects = normalizeList(value.projects ?? value.browsers ?? value.browserProjects);
  const missingProjects = containsAll(projects, config.requiredA11yProjects);
  if (missingProjects.length === 0) {
    recorder.pass(
      'a11y.projects',
      'Accessibility evidence covers required browser projects',
      projects.join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'a11y.projects',
      'Accessibility evidence is missing required browser projects',
      missingProjects.join(', '),
    );
  }

  const specs = normalizeList(value.specs ?? value.testFiles ?? value.files);
  const missingSpecs = containsAll(specs, config.requiredA11ySpecs, normalizeSpec);
  if (missingSpecs.length === 0) {
    recorder.pass(
      'a11y.specs',
      'Accessibility evidence covers required specs',
      specs.map(normalizeSpec).join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'a11y.specs',
      'Accessibility evidence is missing required specs',
      missingSpecs.join(', '),
    );
  }

  const tests = value.tests && typeof value.tests === 'object' ? value.tests : {};
  const failed = Number(tests.failed ?? value.failed ?? value.failures ?? 0);
  const skipped = Number(tests.skipped ?? value.skipped ?? 0);
  const unknown = Number(tests.unknown ?? value.unknown ?? value.unknownTests ?? 0);
  const passed = Number(tests.passed ?? value.passedTests ?? value.testsPassed ?? 0);
  if (
    Number.isFinite(failed) &&
    failed === 0 &&
    Number.isFinite(skipped) &&
    skipped === 0 &&
    Number.isFinite(unknown) &&
    unknown === 0 &&
    Number.isFinite(passed) &&
    passed > 0
  ) {
    recorder.pass(
      'a11y.tests',
      'Accessibility evidence has passing tests and zero failed, skipped, or unknown outcomes',
      `${passed} passed`,
    );
  } else {
    recorder.softFail(
      config,
      'a11y.tests',
      'Accessibility test counts are not release-clean',
      `passed=${Number.isFinite(passed) ? passed : 'unknown'} failed=${Number.isFinite(failed) ? failed : 'unknown'} skipped=${Number.isFinite(skipped) ? skipped : 'unknown'} unknown=${Number.isFinite(unknown) ? unknown : 'unknown'}`,
    );
  }

  const controls = value.controls && typeof value.controls === 'object' ? value.controls : {};
  const requiredControls = ['axeCriticalSerious', 'colorContrast', 'keyboardNavigation'];
  const failedControls = requiredControls.filter(
    (controlName) => controls[controlName]?.ok !== true,
  );
  if (failedControls.length === 0) {
    recorder.pass(
      'a11y.controls',
      'Accessibility evidence covers axe, contrast, and keyboard controls',
      requiredControls.join(', '),
    );
  } else {
    recorder.softFail(
      config,
      'a11y.controls',
      'Accessibility evidence is missing or failing required controls',
      failedControls.join(', '),
    );
  }
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
  if (
    sourceReportPath.raw &&
    sourceReportPath.insideRoot &&
    fileHasValidJson(sourceReportPath.absolutePath)
  ) {
    recorder.pass(
      'browser.sourceReport',
      'Browser regression has a Playwright JSON source report',
      sourceReportPath.raw,
    );
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
  const commandLooksLikePlaywright =
    /\bplaywright(?:\.cmd)?\b/i.test(playwrightCommand) && /\btest\b/i.test(playwrightCommand);
  if (commandLooksLikePlaywright) {
    recorder.pass(
      'browser.command',
      'Browser regression records the Playwright test command',
      playwrightCommand,
    );
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
        (current, segment) =>
          current && typeof current === 'object' ? current[segment] : undefined,
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
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return (
    PLACEHOLDER_EXACT_VALUES.has(normalized) ||
    /<[^>]+>|\bexample\b|\bplaceholder\b|\breplace[-_ ]?me\b|\bsample\b|\btodo\b|\byour[-_ ]/i.test(
      normalized,
    )
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
    recorder.pass(
      'tools.required',
      'All required release tools are available',
      `${checks.length} check(s)`,
    );
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
  verifyCiRepeatEvidence(config, recorder);
  verifyToolReadinessEvidence(config, recorder);
  verifyOperationalReadinessEvidence(config, recorder);
  verifyLoadEvidence(config, recorder);
  verifyApiConnectivityEvidence(config, recorder);
  verifyPiiCiphertextEvidence(config, recorder);
  verifyWebhookSecretCiphertextEvidence(config, recorder);
  verifySemgrepEvidence(config, recorder);
  verifyContainerEvidence(config, recorder);
  verifySecretEvidence(config, recorder);
  verifyProviderQualityEvidence(config, recorder);
  verifyMcpConnectivityEvidence(config, recorder);
  verifySentryEvidence(config, recorder);
  verifyA11yEvidence(config, recorder);
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

function readJsonFileIfValid(absolutePath) {
  if (!absolutePath || !existsSync(absolutePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileHasValidJson(absolutePath) {
  return readJsonFileIfValid(absolutePath) !== null;
}

function fileHasCycloneDxSbom(absolutePath) {
  const value = readJsonFileIfValid(absolutePath);
  return value?.bomFormat === 'CycloneDX';
}

function writeSelftestContainerReports(root, images) {
  return images.map((image, index) => {
    const rawReportPath = `${DEFAULT_CONTAINER_RAW_REPORT_DIR}/selftest-${index + 1}.json`;
    const sbomReportPath = `${DEFAULT_CONTAINER_SBOM_REPORT_DIR}/selftest-${index + 1}.cdx.json`;
    writeJson(root, rawReportPath, {
      SchemaVersion: 2,
      Results: [],
      ArtifactName: image,
    });
    writeJson(root, sbomReportPath, {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      serialNumber: `urn:uuid:00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      version: 1,
      metadata: {
        component: {
          type: 'container',
          name: image,
        },
      },
      components: [],
    });
    return {
      image,
      rawReportPath,
      sbomReportPath,
      sbomFormat: 'CycloneDX',
      sbomComponentCount: 0,
      vulnerabilities: [],
    };
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
  const ciRequiredChecks = [
    'install',
    'audit',
    'db:generate',
    'lint',
    'typecheck',
    'test',
    'build',
  ];
  const ciChecks = Object.fromEntries(ciRequiredChecks.map((check) => [check, true]));
  const sourceCommit = sourceSnapshot.commit || '0123456789abcdef0123456789abcdef01234567';
  const sourceBranch = sourceSnapshot.branch || 'main';
  writeJson(root, DEFAULT_PATHS.ci, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'ci-repeat-evidence',
    provider: 'github-actions',
    repository: 'mantu/bidstack-360',
    workflow: 'ci.yml',
    environment: 'staging',
    releaseCommit: sourceCommit,
    branch: sourceBranch,
    requiredRunCount: 10,
    requiredChecks: ciRequiredChecks,
    consecutivePassed: true,
    passedRunCount: 10,
    failedRunCount: 0,
    failedSuiteCount: 0,
    skippedSuiteCount: 0,
    isolatedInfrastructure: true,
    database: {
      kind: 'postgres',
      isolated: true,
      pgvectorEnabled: true,
    },
    evidenceUrl: 'https://github.com/mantu/bidstack-360/actions?query=branch%3Amain',
    privacy: {
      compactRunMetadataIncluded: true,
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
      commit: sourceCommit,
      branch: sourceBranch,
      status: 'success',
      conclusion: 'success',
      startedAt: `2026-06-18T10:${String(index).padStart(2, '0')}:00.000Z`,
      completedAt: `2026-06-18T10:${String(index + 1).padStart(2, '0')}:00.000Z`,
      failedSuites: 0,
      skippedSuites: 0,
      checks: ciChecks,
    })),
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
  writeJson(root, DEFAULT_PATHS.api, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'write-api-connectivity-evidence',
    environment: 'staging',
    strict: true,
    target: releaseApiTarget,
    authScheme: 'api-key',
    expectedOrgId: 'org_staging_release',
    release: {
      source: 'source-control-evidence',
      expectedCommit: sourceCommit,
      expectedBranch: sourceBranch,
    },
    command: {
      source: 'live-api-smoke',
      ok: true,
      startedAt: now,
      completedAt: now,
      error: null,
    },
    checks: {
      livez: {
        ok: true,
        status: 200,
        apiOk: true,
        release: {
          commit: sourceCommit,
          branch: sourceBranch,
        },
      },
      readyz: {
        ok: true,
        status: 200,
        apiOk: true,
        db: true,
        redis: true,
        storage: true,
        release: {
          commit: sourceCommit,
          branch: sourceBranch,
        },
      },
      health: {
        ok: true,
        status: 200,
        apiOk: true,
        db: true,
        redis: true,
        release: {
          commit: sourceCommit,
          branch: sourceBranch,
        },
      },
      capabilities: {
        ok: true,
        status: 200,
        userId: 'apikey:selftest-release-key',
        orgId: 'org_staging_release',
        expectedOrgId: 'org_staging_release',
        legacyRole: 'api',
        rolesCount: 0,
        permissionsCount: 2,
        isAdmin: false,
      },
      domainRead: {
        ok: true,
        status: 200,
        path: '/api/companies?search=__bidstack_release_probe_no_match__&limit=1',
        responseShape: 'paginated-list',
        itemCount: 0,
        nextCursorPresent: false,
        noMatchProbe: true,
        rawItemsIncluded: false,
        rawBodyIncluded: false,
      },
    },
    tenant: {
      orgId: 'org_staging_release',
      userId: 'apikey:selftest-release-key',
    },
    passed: true,
    validationFailures: [],
  });
  writeJson(root, DEFAULT_PATHS.pii, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'write-pii-ciphertext-evidence',
    environment: 'staging',
    strict: true,
    database: {
      configured: true,
      source: 'DATABASE_URL',
      queryMode: 'raw-counts-only',
      rawValuesIncluded: false,
    },
    policy: {
      encryptedPrefix: 'enc:v1:',
      emailHashPattern: '^[0-9a-f]{64}$',
      requiredModels: ['contact', 'lead', 'kamConsultant'],
      supportedModels: ['contact', 'lead', 'kamConsultant'],
    },
    privacy: {
      piiValuesIncluded: false,
      ciphertextSamplesIncluded: false,
      hashesIncluded: false,
      rowIdsIncluded: false,
    },
    atRestControls: {
      storageEncryption: {
        enabled: true,
        provider: 'azure-postgresql-customer-managed-key',
        evidenceRef: 'MANTU-SEC-48291 storage encryption validation',
        rawConfigIncluded: false,
      },
      userEmail: {
        fieldEncryptedByPiiMiddleware: false,
        decision: USER_EMAIL_STORAGE_ONLY_DECISION,
        decisionRef: 'MANTU-DPIA-48292 User.email storage-only approval',
        owner: 'platform-security@bidstack360.com',
        rawEmailsIncluded: false,
      },
      plaintextPii: {
        fieldEncryptedByPiiMiddleware: false,
        decision: PLAINTEXT_PII_STORAGE_ONLY_DECISION,
        decisionRef: 'MANTU-DPIA-48293 plaintext PII storage-only approval',
        owner: 'privacy-security@bidstack360.com',
        requiredFields: REQUIRED_PLAINTEXT_PII_FIELDS,
        acceptedFields: REQUIRED_PLAINTEXT_PII_FIELDS,
        missingAcceptedFields: [],
        rawValuesIncluded: false,
      },
    },
    command: {
      source: 'raw-db-pii-ciphertext-scan',
      ok: true,
      startedAt: now,
      completedAt: now,
      error: null,
    },
    models: {
      contact: {
        id: 'contact',
        label: 'Contact',
        table: 'contacts',
        fields: {
          email: { nonNull: 2, encrypted: 2, plaintext: 0, hashValid: 2, hashInvalid: 0 },
          phone: { nonNull: 1, encrypted: 1, plaintext: 0 },
        },
        passed: true,
        validationFailures: [],
      },
      lead: {
        id: 'lead',
        label: 'Lead',
        table: 'leads',
        fields: {
          email: { nonNull: 2, encrypted: 2, plaintext: 0, hashValid: 2, hashInvalid: 0 },
          phone: { nonNull: 1, encrypted: 1, plaintext: 0 },
        },
        passed: true,
        validationFailures: [],
      },
      kamConsultant: {
        id: 'kamConsultant',
        label: 'KAM consultant',
        table: 'kam_consultants',
        fields: {
          email: { nonNull: 1, encrypted: 1, plaintext: 0, hashValid: 1, hashInvalid: 0 },
        },
        passed: true,
        validationFailures: [],
      },
    },
    totals: {
      piiValues: 7,
      encryptedValues: 7,
      plaintextValues: 0,
      emailRows: 5,
      emailHashInvalidRows: 0,
    },
    passed: true,
    validationFailures: [],
  });
  writeJson(root, DEFAULT_PATHS.webhooks, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'write-webhook-secret-ciphertext-evidence',
    environment: 'staging',
    strict: true,
    database: {
      configured: true,
      source: 'DATABASE_URL',
      queryMode: 'raw-secret-decrypt-counts',
      rawValuesIncluded: false,
    },
    policy: {
      encryptionEnvelope: 'aes-256-gcm-v1-base64url',
      legacyPlaintextPrefix: 'whsec_',
      plaintextFallbackAllowed: false,
    },
    privacy: {
      secretValuesIncluded: false,
      ciphertextSamplesIncluded: false,
      rowIdsIncluded: false,
      urlsIncluded: false,
      eventListsIncluded: false,
      secretHashesIncluded: false,
    },
    command: {
      source: 'raw-db-webhook-secret-scan',
      ok: true,
      startedAt: now,
      completedAt: now,
      error: null,
    },
    totals: {
      totalRows: 3,
      activeRows: 2,
      deletedRows: 1,
      encryptedDecryptableRows: 3,
      legacyPlaintextRows: 0,
      unreadableRows: 0,
      emptySecretRows: 0,
      secretHashPresentRows: 3,
      secretHashMissingRows: 0,
      secretHashInvalidRows: 0,
    },
    passed: true,
    validationFailures: [],
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
  const selftestContainerReports = writeSelftestContainerReports(root, selftestContainerImages);
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
  writeJson(root, DEFAULT_PATHS.mcp, {
    schemaVersion: 1,
    generatedAt: now,
    runner: 'write-mcp-connectivity-evidence',
    environment: 'staging',
    strict: true,
    target: 'https://mcp.staging.bidstack360.com',
    mcpUrl: 'https://mcp.staging.bidstack360.com/mcp',
    requiredTools: DEFAULT_MCP_REQUIRED_TOOLS,
    release: {
      source: 'source-control-evidence',
      expectedCommit: sourceCommit,
      expectedBranch: sourceBranch,
    },
    command: {
      source: 'live-mcp-smoke',
      ok: true,
      startedAt: now,
      completedAt: now,
      error: null,
    },
    checks: {
      discovery: {
        ok: true,
        status: 200,
        endpoints: [{ type: 'streamable-http', url: '/mcp' }],
        server: 'BidStack 360 MCP',
        release: {
          commit: sourceCommit,
          branch: sourceBranch,
        },
      },
      health: {
        ok: true,
        status: 200,
        name: 'bidstack-mcp',
        db: 'up',
        redis: 'up',
        release: {
          commit: sourceCommit,
          branch: sourceBranch,
        },
      },
      initialize: {
        ok: true,
        status: 200,
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'BidStack 360 MCP' },
        sessionEstablished: true,
      },
      initialized: {
        ok: true,
        status: 202,
      },
      toolsList: {
        ok: true,
        status: 200,
        toolCount: DEFAULT_MCP_REQUIRED_TOOLS.length,
        tools: DEFAULT_MCP_REQUIRED_TOOLS,
        missingRequiredTools: [],
      },
      toolCall: {
        ok: true,
        status: 200,
        toolName: 'crm_search_companies',
        argumentKeys: ['limit', 'query'],
        contentItemCount: 1,
        structuredContentPresent: false,
        resultIsError: false,
        jsonRpcErrorCode: null,
        rawArgumentsIncluded: false,
        rawOutputIncluded: false,
      },
      closeSession: {
        ok: true,
        status: 200,
        skipped: false,
      },
    },
    tools: DEFAULT_MCP_REQUIRED_TOOLS,
    toolCount: DEFAULT_MCP_REQUIRED_TOOLS.length,
    passed: true,
    validationFailures: [],
  });
  writeJson(root, DEFAULT_PATHS.sentry, {
    schemaVersion: 1,
    generatedAt: now,
    environment: 'staging',
    organization: 'bidstack',
    projects: {
      api: 'bidstack-api',
      worker: 'bidstack-worker',
    },
    markers: {
      api: 'bidstack-api-sentry-smoke',
      worker: 'bidstack-worker-sentry-smoke',
    },
    triggerTarget: releaseApiTarget,
    dsnConfigured: true,
    release: 'bidstack-web@0.1.0+abc123',
    privacy: {
      compactIssueMetadataIncluded: true,
      rawEventPayloadsIncluded: false,
      stackTracesIncluded: false,
      requestBodiesIncluded: false,
      userEmailsIncluded: false,
      commandStdoutIncluded: false,
      commandStderrIncluded: false,
    },
    api5xxSmokeObserved: true,
    workerFailureObserved: true,
    apiEvidence: {
      label: 'api-5xx-smoke',
      target: 'bidstack/bidstack-api',
      query:
        'release:bidstack-web@0.1.0+abc123 environment:staging level:error *bidstack-api-sentry-smoke*',
      observed: true,
      issueCount: 1,
      issues: [{ id: '123', shortId: 'BID-123', level: 'error', project: 'bidstack-api' }],
      command: { command: 'sentry issue list --json', exitCode: 0, passed: true },
    },
    workerEvidence: {
      label: 'worker-failure-smoke',
      target: 'bidstack/bidstack-worker',
      query:
        'release:bidstack-web@0.1.0+abc123 environment:staging level:error *bidstack-worker-sentry-smoke*',
      observed: true,
      issueCount: 1,
      issues: [{ id: '124', shortId: 'BID-124', level: 'error', project: 'bidstack-worker' }],
      command: { command: 'sentry issue list --json', exitCode: 0, passed: true },
    },
    sendDefaultPii: false,
    piiScrubberEnabled: true,
    sessionReplayEnabled: false,
    passed: true,
    validationFailures: [],
  });
  writeJson(root, DEFAULT_A11Y_SOURCE_REPORT, {
    suites: [],
  });
  writeJson(root, DEFAULT_PATHS.a11y, {
    generatedAt: now,
    environment: 'staging',
    profile: 'wcag-keyboard-regression',
    target: 'https://staging.bidstack.example',
    productionBuild: true,
    clerkBackedAuth: true,
    commandExitCode: 0,
    passed: true,
    projects: DEFAULT_A11Y_PROJECTS,
    specs: DEFAULT_A11Y_SPECS,
    tests: { passed: 43, failed: 0, skipped: 0, unknown: 0 },
    controls: {
      axeCriticalSerious: { passed: 19, failed: 0, skipped: 0, unknown: 0, ok: true },
      colorContrast: { passed: 13, failed: 0, skipped: 0, unknown: 0, ok: true },
      keyboardNavigation: { passed: 11, failed: 0, skipped: 0, unknown: 0, ok: true },
    },
    sourceReport: DEFAULT_A11Y_SOURCE_REPORT,
    playwrightCommand:
      'pnpm --filter @bidstack/web exec playwright test e2e/a11y/axe.spec.ts e2e/a11y/color-contrast.spec.ts e2e/a11y/keyboard-nav.spec.ts --project chromium-desktop --reporter=json',
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
    'BIDSTACK_CI_REPEAT_EVIDENCE',
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

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.ci), { force: true });
    const missingCiRepeat = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingCiRepeat.ok,
      false,
      'expected missing CI repeat proof to fail staging gate',
    );
    assert.equal(
      missingCiRepeat.checks.some((check) => check.id === 'ci.exists' && check.status === 'fail'),
      true,
      'expected staging gate to require CI repeat proof',
    );

    createSelftestFixtures(root);
    const ciArtifactPath = path.join(root, DEFAULT_PATHS.ci);
    const wrongCiCommit = JSON.parse(readFileSync(ciArtifactPath, 'utf8'));
    wrongCiCommit.releaseCommit = 'ffffffffffffffffffffffffffffffffffffffff';
    wrongCiCommit.runs = wrongCiCommit.runs.map((run) => ({
      ...run,
      commit: 'ffffffffffffffffffffffffffffffffffffffff',
    }));
    writeJson(root, DEFAULT_PATHS.ci, wrongCiCommit);
    const wrongCiCommitEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      wrongCiCommitEvidence.ok,
      false,
      'expected CI repeat proof for the wrong commit to fail staging gate',
    );
    assert.equal(
      wrongCiCommitEvidence.checks.some(
        (check) => check.id === 'ci.sourceCommit' && check.status === 'fail',
      ),
      true,
      'expected staging gate to tie CI proof to source-control commit',
    );

    createSelftestFixtures(root);
    const apiReleaseArtifactPath = path.join(root, DEFAULT_PATHS.api);
    const wrongApiRelease = JSON.parse(readFileSync(apiReleaseArtifactPath, 'utf8'));
    wrongApiRelease.release.expectedCommit = 'ffffffffffffffffffffffffffffffffffffffff';
    for (const checkName of ['livez', 'readyz', 'health']) {
      wrongApiRelease.checks[checkName].release.commit = 'ffffffffffffffffffffffffffffffffffffffff';
    }
    writeJson(root, DEFAULT_PATHS.api, wrongApiRelease);
    const wrongApiReleaseEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      wrongApiReleaseEvidence.ok,
      false,
      'expected API connectivity proof for the wrong commit to fail staging gate',
    );
    assert.equal(
      wrongApiReleaseEvidence.checks.some(
        (check) => check.id === 'api.sourceCommit' && check.status === 'fail',
      ),
      true,
      'expected staging gate to tie API connectivity proof to source-control commit',
    );

    createSelftestFixtures(root);
    const mcpReleaseArtifactPath = path.join(root, DEFAULT_PATHS.mcp);
    const wrongMcpRelease = JSON.parse(readFileSync(mcpReleaseArtifactPath, 'utf8'));
    wrongMcpRelease.release.expectedCommit = 'ffffffffffffffffffffffffffffffffffffffff';
    for (const checkName of ['discovery', 'health']) {
      wrongMcpRelease.checks[checkName].release.commit = 'ffffffffffffffffffffffffffffffffffffffff';
    }
    writeJson(root, DEFAULT_PATHS.mcp, wrongMcpRelease);
    const wrongMcpReleaseEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      wrongMcpReleaseEvidence.ok,
      false,
      'expected MCP connectivity proof for the wrong commit to fail staging gate',
    );
    assert.equal(
      wrongMcpReleaseEvidence.checks.some(
        (check) => check.id === 'mcp.sourceCommit' && check.status === 'fail',
      ),
      true,
      'expected staging gate to tie MCP connectivity proof to source-control commit',
    );

    createSelftestFixtures(root);
    const skippedCiSuite = JSON.parse(readFileSync(ciArtifactPath, 'utf8'));
    skippedCiSuite.skippedSuiteCount = 1;
    skippedCiSuite.runs[2] = { ...skippedCiSuite.runs[2], skippedSuites: 1 };
    writeJson(root, DEFAULT_PATHS.ci, skippedCiSuite);
    const skippedCiSuiteEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      skippedCiSuiteEvidence.ok,
      false,
      'expected CI repeat proof with skipped suites to fail staging gate',
    );
    assert.equal(
      skippedCiSuiteEvidence.checks.some(
        (check) => check.id === 'ci.suites' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject skipped CI suites',
    );

    createSelftestFixtures(root);
    const unsafeCiArtifact = JSON.parse(readFileSync(ciArtifactPath, 'utf8'));
    unsafeCiArtifact.privacy.rawLogsIncluded = true;
    writeJson(root, DEFAULT_PATHS.ci, unsafeCiArtifact);
    const unsafeCiRepeatEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      unsafeCiRepeatEvidence.ok,
      false,
      'expected CI repeat proof with raw logs to fail staging gate',
    );
    assert.equal(
      unsafeCiRepeatEvidence.checks.some(
        (check) => check.id === 'ci.privacy' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require compact CI metadata',
    );

    createSelftestFixtures(root);
    const a11yArtifactPath = path.join(root, DEFAULT_PATHS.a11y);
    const missingKeyboardA11y = JSON.parse(readFileSync(a11yArtifactPath, 'utf8'));
    delete missingKeyboardA11y.controls.keyboardNavigation;
    writeJson(root, DEFAULT_PATHS.a11y, missingKeyboardA11y);
    const missingKeyboardA11yEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingKeyboardA11yEvidence.ok,
      false,
      'expected missing keyboard a11y control to fail staging gate',
    );
    assert.equal(
      missingKeyboardA11yEvidence.checks.some(
        (check) => check.id === 'a11y.controls' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require keyboard a11y control evidence',
    );

    createSelftestFixtures(root);
    const syntheticA11y = JSON.parse(readFileSync(a11yArtifactPath, 'utf8'));
    delete syntheticA11y.sourceReport;
    delete syntheticA11y.playwrightCommand;
    writeJson(root, DEFAULT_PATHS.a11y, syntheticA11y);
    const syntheticA11yEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      syntheticA11yEvidence.ok,
      false,
      'expected synthetic a11y evidence without source proof to fail staging gate',
    );
    for (const checkId of ['a11y.sourceReport', 'a11y.command']) {
      assert.equal(
        syntheticA11yEvidence.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to reject synthetic a11y evidence`,
      );
    }

    createSelftestFixtures(root);
    const skippedA11y = JSON.parse(readFileSync(a11yArtifactPath, 'utf8'));
    skippedA11y.tests = { passed: 42, failed: 0, skipped: 1, unknown: 0 };
    skippedA11y.passed = true;
    writeJson(root, DEFAULT_PATHS.a11y, skippedA11y);
    const skippedA11yEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      skippedA11yEvidence.ok,
      false,
      'expected a11y evidence with skipped tests to fail staging gate',
    );
    assert.equal(
      skippedA11yEvidence.checks.some(
        (check) => check.id === 'a11y.tests' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject skipped a11y outcomes',
    );

    createSelftestFixtures(root);
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
    const missingSentryProjects = JSON.parse(readFileSync(sentryArtifactPath, 'utf8'));
    delete missingSentryProjects.projects;
    writeJson(root, DEFAULT_PATHS.sentry, missingSentryProjects);
    const missingSentryProjectsEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingSentryProjectsEvidence.ok,
      false,
      'expected missing Sentry projects to fail staging gate',
    );
    assert.equal(
      missingSentryProjectsEvidence.checks.some(
        (check) => check.id === 'sentry.projects' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require Sentry API/worker project evidence',
    );

    createSelftestFixtures(root);
    const failedSentryQuery = JSON.parse(readFileSync(sentryArtifactPath, 'utf8'));
    failedSentryQuery.apiEvidence.command = {
      command: 'sentry issue list --json',
      exitCode: 1,
      passed: false,
      error: 'fixture auth failure',
    };
    failedSentryQuery.passed = true;
    writeJson(root, DEFAULT_PATHS.sentry, failedSentryQuery);
    const failedSentryQueryEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      failedSentryQueryEvidence.ok,
      false,
      'expected failed Sentry issue query to fail staging gate',
    );
    assert.equal(
      failedSentryQueryEvidence.checks.some(
        (check) => check.id === 'sentry.api.command' && check.status === 'fail',
      ),
      true,
      'expected staging gate to require successful Sentry API issue query',
    );

    createSelftestFixtures(root);
    const unsafeSentryEvidence = JSON.parse(readFileSync(sentryArtifactPath, 'utf8'));
    unsafeSentryEvidence.privacy.commandStdoutIncluded = true;
    unsafeSentryEvidence.passed = true;
    writeJson(root, DEFAULT_PATHS.sentry, unsafeSentryEvidence);
    const unsafeSentryPrivacyEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      unsafeSentryPrivacyEvidence.ok,
      false,
      'expected unsafe Sentry raw output evidence to fail staging gate',
    );
    assert.equal(
      unsafeSentryPrivacyEvidence.checks.some(
        (check) => check.id === 'sentry.rawPrivacy' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject raw Sentry command output',
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
        {
          id: 'apollo',
          status: 'queued',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
        },
        {
          id: 'seamless',
          status: 'synced',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
        },
        {
          id: 'tech_intel',
          status: 'synced',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
          observedSources: [{ label: 'BuiltWith MCP', sourceKey: 'builtwith_mcp', signalCount: 1 }],
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
        {
          id: 'apollo',
          status: 'queued',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
        },
        {
          id: 'seamless',
          status: 'unavailable',
          transport: 'mcp',
          signalCount: 0,
          passed: false,
          failures: ['Seamless must be synced for release evidence'],
        },
        {
          id: 'tech_intel',
          status: 'synced',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
        },
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
        {
          id: 'apollo',
          status: 'queued',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
        },
        {
          id: 'seamless',
          status: 'synced',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
        },
        {
          id: 'tech_intel',
          status: 'synced',
          transport: 'mcp',
          signalCount: 1,
          passed: true,
          failures: [],
          observedSources: [{ label: 'BuiltWith MCP', sourceKey: 'builtwith_mcp', signalCount: 1 }],
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
    for (const checkId of [
      'providers.target',
      'providers.companyKey',
      'providers.techIntelSources',
    ]) {
      assert.equal(
        placeholderProviderQuality.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to reject placeholder provider evidence`,
      );
    }

    createSelftestFixtures(root);
    const apiArtifactPath = path.join(root, DEFAULT_PATHS.api);
    const mismatchedApi = JSON.parse(readFileSync(apiArtifactPath, 'utf8'));
    mismatchedApi.environment = 'production';
    writeJson(root, DEFAULT_PATHS.api, mismatchedApi);
    const mismatchedApiEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedApiEnvironment.ok,
      false,
      'expected mismatched API environment to fail staging gate',
    );
    assert.equal(
      mismatchedApiEnvironment.checks.some(
        (check) => check.id === 'api.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production API evidence',
    );

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.api), { force: true });
    const missingApiConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingApiConnectivity.ok,
      false,
      'expected missing API connectivity proof to fail production gate',
    );
    assert.equal(
      missingApiConnectivity.checks.some(
        (check) => check.id === 'api.exists' && check.status === 'fail',
      ),
      true,
      'expected missing API connectivity proof to be a hard failure',
    );

    createSelftestFixtures(root);
    const weakApi = JSON.parse(readFileSync(apiArtifactPath, 'utf8'));
    weakApi.command = { ...weakApi.command, source: 'response-file', ok: true };
    weakApi.passed = true;
    writeJson(root, DEFAULT_PATHS.api, weakApi);
    const weakApiConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      weakApiConnectivity.ok,
      false,
      'expected non-live API proof to fail production gate',
    );
    assert.equal(
      weakApiConnectivity.checks.some(
        (check) => check.id === 'api.liveSmoke' && check.status === 'fail',
      ),
      true,
      'expected production gate to require live API smoke evidence',
    );

    createSelftestFixtures(root);
    const unhealthyApi = JSON.parse(readFileSync(apiArtifactPath, 'utf8'));
    unhealthyApi.checks.readyz = {
      ...unhealthyApi.checks.readyz,
      ok: false,
      storage: false,
    };
    unhealthyApi.passed = true;
    writeJson(root, DEFAULT_PATHS.api, unhealthyApi);
    const unhealthyApiConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      unhealthyApiConnectivity.ok,
      false,
      'expected unhealthy API readiness to fail production gate',
    );
    assert.equal(
      unhealthyApiConnectivity.checks.some(
        (check) => check.id === 'api.readyServices' && check.status === 'fail',
      ),
      true,
      'expected production gate to require API storage readiness proof',
    );

    createSelftestFixtures(root);
    const missingDomainReadApi = JSON.parse(readFileSync(apiArtifactPath, 'utf8'));
    delete missingDomainReadApi.checks.domainRead;
    missingDomainReadApi.passed = true;
    writeJson(root, DEFAULT_PATHS.api, missingDomainReadApi);
    const missingDomainReadConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingDomainReadConnectivity.ok,
      false,
      'expected missing API domain read smoke to fail production gate',
    );
    assert.equal(
      missingDomainReadConnectivity.checks.some(
        (check) => check.id === 'api.domainRead' && check.status === 'fail',
      ),
      true,
      'expected production gate to require domain read smoke proof',
    );

    createSelftestFixtures(root);
    const rawDomainReadApi = JSON.parse(readFileSync(apiArtifactPath, 'utf8'));
    rawDomainReadApi.checks.domainRead = {
      ...rawDomainReadApi.checks.domainRead,
      items: [{ id: 'company_1', name: 'Sensitive Corp' }],
      rawItemsIncluded: true,
    };
    writeJson(root, DEFAULT_PATHS.api, rawDomainReadApi);
    const rawDomainReadConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      rawDomainReadConnectivity.ok,
      false,
      'expected raw API response data in domain smoke evidence to fail production gate',
    );
    assert.equal(
      rawDomainReadConnectivity.checks.some(
        (check) => check.id === 'api.domainReadPrivacy' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject raw API response data in evidence',
    );

    createSelftestFixtures(root);
    const placeholderApi = JSON.parse(readFileSync(apiArtifactPath, 'utf8'));
    placeholderApi.target = 'https://staging-api.bidstack.example';
    writeJson(root, DEFAULT_PATHS.api, placeholderApi);
    const placeholderApiConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      placeholderApiConnectivity.ok,
      false,
      'expected placeholder API target to fail production gate',
    );
    assert.equal(
      placeholderApiConnectivity.checks.some(
        (check) => check.id === 'api.target' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject placeholder API target',
    );

    createSelftestFixtures(root);
    const wrongTenantApi = JSON.parse(readFileSync(apiArtifactPath, 'utf8'));
    wrongTenantApi.checks.capabilities = {
      ...wrongTenantApi.checks.capabilities,
      orgId: 'org_other_release',
    };
    wrongTenantApi.tenant = {
      ...wrongTenantApi.tenant,
      orgId: 'org_other_release',
    };
    wrongTenantApi.passed = true;
    writeJson(root, DEFAULT_PATHS.api, wrongTenantApi);
    const wrongTenantApiConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      wrongTenantApiConnectivity.ok,
      false,
      'expected API tenant mismatch to fail production gate',
    );
    assert.equal(
      wrongTenantApiConnectivity.checks.some(
        (check) => check.id === 'api.expectedOrg' && check.status === 'fail',
      ),
      true,
      'expected production gate to require the expected release org',
    );

    createSelftestFixtures(root);
    const piiArtifactPath = path.join(root, DEFAULT_PATHS.pii);
    const mismatchedPii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    mismatchedPii.environment = 'production';
    writeJson(root, DEFAULT_PATHS.pii, mismatchedPii);
    const mismatchedPiiEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedPiiEnvironment.ok,
      false,
      'expected mismatched PII ciphertext environment to fail staging gate',
    );
    assert.equal(
      mismatchedPiiEnvironment.checks.some(
        (check) => check.id === 'pii.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production PII ciphertext evidence',
    );

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.pii), { force: true });
    const missingPiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingPiiCiphertext.ok,
      false,
      'expected missing PII ciphertext proof to fail production gate',
    );
    assert.equal(
      missingPiiCiphertext.checks.some(
        (check) => check.id === 'pii.exists' && check.status === 'fail',
      ),
      true,
      'expected missing PII ciphertext proof to be a hard failure',
    );

    createSelftestFixtures(root);
    const weakPii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    weakPii.command = { ...weakPii.command, source: 'response-file', ok: true };
    weakPii.passed = true;
    writeJson(root, DEFAULT_PATHS.pii, weakPii);
    const weakPiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(weakPiiCiphertext.ok, false, 'expected non-raw PII proof to fail production gate');
    assert.equal(
      weakPiiCiphertext.checks.some(
        (check) => check.id === 'pii.rawScan' && check.status === 'fail',
      ),
      true,
      'expected production gate to require raw DB PII scan evidence',
    );

    createSelftestFixtures(root);
    const plaintextPii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    plaintextPii.models.contact.fields.email = {
      ...plaintextPii.models.contact.fields.email,
      encrypted: 1,
      plaintext: 1,
    };
    plaintextPii.totals.plaintextValues = 1;
    plaintextPii.passed = true;
    writeJson(root, DEFAULT_PATHS.pii, plaintextPii);
    const plaintextPiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      plaintextPiiCiphertext.ok,
      false,
      'expected plaintext PII rows to fail production gate',
    );
    assert.equal(
      plaintextPiiCiphertext.checks.some(
        (check) => check.id === 'pii.contact.email.plaintext' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject plaintext PII counts',
    );

    createSelftestFixtures(root);
    const unsafePii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    unsafePii.privacy = {
      ...unsafePii.privacy,
      hashesIncluded: true,
    };
    writeJson(root, DEFAULT_PATHS.pii, unsafePii);
    const unsafePiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      unsafePiiCiphertext.ok,
      false,
      'expected unsafe PII evidence details to fail production gate',
    );
    assert.equal(
      unsafePiiCiphertext.checks.some(
        (check) => check.id === 'pii.privacy' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject evidence that includes hashes',
    );

    createSelftestFixtures(root);
    const missingAtRestControlsPii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    delete missingAtRestControlsPii.atRestControls;
    missingAtRestControlsPii.passed = true;
    writeJson(root, DEFAULT_PATHS.pii, missingAtRestControlsPii);
    const missingAtRestControlsPiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingAtRestControlsPiiCiphertext.ok,
      false,
      'expected missing PII at-rest controls to fail production gate',
    );
    for (const checkId of [
      'pii.storageEncryption.enabled',
      'pii.userEmail.decision',
      'pii.plaintextPii.decision',
    ]) {
      assert.equal(
        missingAtRestControlsPiiCiphertext.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to require storage/User.email proof`,
      );
    }

    createSelftestFixtures(root);
    const placeholderUserEmailPii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    placeholderUserEmailPii.atRestControls.userEmail.decisionRef = '<approval-ticket>';
    placeholderUserEmailPii.passed = true;
    writeJson(root, DEFAULT_PATHS.pii, placeholderUserEmailPii);
    const placeholderUserEmailPiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      placeholderUserEmailPiiCiphertext.ok,
      false,
      'expected placeholder User.email decision evidence to fail production gate',
    );
    assert.equal(
      placeholderUserEmailPiiCiphertext.checks.some(
        (check) => check.id === 'pii.userEmail.decisionRef' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject placeholder User.email decision evidence',
    );

    createSelftestFixtures(root);
    const missingPlaintextPiiScope = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    missingPlaintextPiiScope.atRestControls.plaintextPii.acceptedFields =
      REQUIRED_PLAINTEXT_PII_FIELDS.filter((field) => field !== 'KamSession.transcriptText');
    missingPlaintextPiiScope.atRestControls.plaintextPii.missingAcceptedFields = [
      'KamSession.transcriptText',
    ];
    missingPlaintextPiiScope.passed = true;
    writeJson(root, DEFAULT_PATHS.pii, missingPlaintextPiiScope);
    const missingPlaintextPiiScopeCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingPlaintextPiiScopeCiphertext.ok,
      false,
      'expected incomplete plaintext-PII field scope to fail production gate',
    );
    assert.equal(
      missingPlaintextPiiScopeCiphertext.checks.some(
        (check) => check.id === 'pii.plaintextPii.scope' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject missing plaintext-PII decision scope',
    );

    createSelftestFixtures(root);
    const placeholderPlaintextPii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    placeholderPlaintextPii.atRestControls.plaintextPii.decisionRef = '<privacy-ticket>';
    placeholderPlaintextPii.passed = true;
    writeJson(root, DEFAULT_PATHS.pii, placeholderPlaintextPii);
    const placeholderPlaintextPiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      placeholderPlaintextPiiCiphertext.ok,
      false,
      'expected placeholder plaintext-PII decision evidence to fail production gate',
    );
    assert.equal(
      placeholderPlaintextPiiCiphertext.checks.some(
        (check) => check.id === 'pii.plaintextPii.decisionRef' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject placeholder plaintext-PII decision evidence',
    );

    createSelftestFixtures(root);
    const emptyRequiredPii = JSON.parse(readFileSync(piiArtifactPath, 'utf8'));
    emptyRequiredPii.models.kamConsultant.fields.email = {
      nonNull: 0,
      encrypted: 0,
      plaintext: 0,
      hashValid: 0,
      hashInvalid: 0,
    };
    emptyRequiredPii.totals.emailRows = 4;
    emptyRequiredPii.passed = true;
    writeJson(root, DEFAULT_PATHS.pii, emptyRequiredPii);
    const emptyRequiredPiiCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      emptyRequiredPiiCiphertext.ok,
      false,
      'expected empty required PII model coverage to fail production gate',
    );
    assert.equal(
      emptyRequiredPiiCiphertext.checks.some(
        (check) => check.id === 'pii.kamConsultant.requiredRows' && check.status === 'fail',
      ),
      true,
      'expected production gate to require non-empty KAM email coverage',
    );

    createSelftestFixtures(root);
    const webhookArtifactPath = path.join(root, DEFAULT_PATHS.webhooks);
    const mismatchedWebhookEvidence = JSON.parse(readFileSync(webhookArtifactPath, 'utf8'));
    mismatchedWebhookEvidence.environment = 'production';
    writeJson(root, DEFAULT_PATHS.webhooks, mismatchedWebhookEvidence);
    const mismatchedWebhookEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedWebhookEnvironment.ok,
      false,
      'expected mismatched webhook secret environment to fail staging gate',
    );
    assert.equal(
      mismatchedWebhookEnvironment.checks.some(
        (check) => check.id === 'webhooks.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production webhook secret evidence',
    );

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.webhooks), { force: true });
    const missingWebhookEvidence = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingWebhookEvidence.ok,
      false,
      'expected missing webhook secret proof to fail production gate',
    );
    assert.equal(
      missingWebhookEvidence.checks.some(
        (check) => check.id === 'webhooks.exists' && check.status === 'fail',
      ),
      true,
      'expected missing webhook secret proof to be a hard failure',
    );

    createSelftestFixtures(root);
    const weakWebhookEvidence = JSON.parse(readFileSync(webhookArtifactPath, 'utf8'));
    weakWebhookEvidence.command = {
      ...weakWebhookEvidence.command,
      source: 'response-file',
      ok: true,
    };
    weakWebhookEvidence.passed = true;
    writeJson(root, DEFAULT_PATHS.webhooks, weakWebhookEvidence);
    const weakWebhookCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      weakWebhookCiphertext.ok,
      false,
      'expected non-raw webhook proof to fail production gate',
    );
    assert.equal(
      weakWebhookCiphertext.checks.some(
        (check) => check.id === 'webhooks.rawScan' && check.status === 'fail',
      ),
      true,
      'expected production gate to require raw DB webhook secret evidence',
    );

    createSelftestFixtures(root);
    const plaintextWebhookEvidence = JSON.parse(readFileSync(webhookArtifactPath, 'utf8'));
    plaintextWebhookEvidence.totals = {
      ...plaintextWebhookEvidence.totals,
      encryptedDecryptableRows: 2,
      legacyPlaintextRows: 1,
    };
    plaintextWebhookEvidence.passed = true;
    writeJson(root, DEFAULT_PATHS.webhooks, plaintextWebhookEvidence);
    const plaintextWebhookCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      plaintextWebhookCiphertext.ok,
      false,
      'expected plaintext webhook secret rows to fail production gate',
    );
    assert.equal(
      plaintextWebhookCiphertext.checks.some(
        (check) => check.id === 'webhooks.totals.legacyPlaintext' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject plaintext webhook secret counts',
    );

    createSelftestFixtures(root);
    const missingHashWebhookEvidence = JSON.parse(readFileSync(webhookArtifactPath, 'utf8'));
    missingHashWebhookEvidence.totals = {
      ...missingHashWebhookEvidence.totals,
      secretHashPresentRows: 2,
      secretHashMissingRows: 1,
    };
    missingHashWebhookEvidence.passed = true;
    writeJson(root, DEFAULT_PATHS.webhooks, missingHashWebhookEvidence);
    const missingHashWebhookCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingHashWebhookCiphertext.ok,
      false,
      'expected missing webhook secret hashes to fail production gate',
    );
    assert.equal(
      missingHashWebhookCiphertext.checks.some(
        (check) => check.id === 'webhooks.totals.hashMissing' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject missing webhook secret hashes',
    );

    createSelftestFixtures(root);
    const unsafeWebhookEvidence = JSON.parse(readFileSync(webhookArtifactPath, 'utf8'));
    unsafeWebhookEvidence.privacy = {
      ...unsafeWebhookEvidence.privacy,
      ciphertextSamplesIncluded: true,
    };
    unsafeWebhookEvidence.policy = {
      ...unsafeWebhookEvidence.policy,
      plaintextFallbackAllowed: true,
    };
    writeJson(root, DEFAULT_PATHS.webhooks, unsafeWebhookEvidence);
    const unsafeWebhookCiphertext = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      unsafeWebhookCiphertext.ok,
      false,
      'expected unsafe webhook secret evidence details to fail production gate',
    );
    for (const checkId of ['webhooks.privacy', 'webhooks.fallback']) {
      assert.equal(
        unsafeWebhookCiphertext.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to reject unsafe webhook evidence`,
      );
    }

    createSelftestFixtures(root);
    const mcpArtifactPath = path.join(root, DEFAULT_PATHS.mcp);
    const mismatchedMcp = JSON.parse(readFileSync(mcpArtifactPath, 'utf8'));
    mismatchedMcp.environment = 'production';
    writeJson(root, DEFAULT_PATHS.mcp, mismatchedMcp);
    const mismatchedMcpEnvironment = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      mismatchedMcpEnvironment.ok,
      false,
      'expected mismatched MCP environment to fail staging gate',
    );
    assert.equal(
      mismatchedMcpEnvironment.checks.some(
        (check) => check.id === 'mcp.environment' && check.status === 'fail',
      ),
      true,
      'expected staging gate to reject production MCP evidence',
    );

    createSelftestFixtures(root);
    rmSync(path.join(root, DEFAULT_PATHS.mcp), { force: true });
    const missingMcpConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingMcpConnectivity.ok,
      false,
      'expected missing MCP connectivity proof to fail production gate',
    );
    assert.equal(
      missingMcpConnectivity.checks.some(
        (check) => check.id === 'mcp.exists' && check.status === 'fail',
      ),
      true,
      'expected missing MCP connectivity proof to be a hard failure',
    );

    createSelftestFixtures(root);
    const weakMcp = JSON.parse(readFileSync(mcpArtifactPath, 'utf8'));
    weakMcp.command = { ...weakMcp.command, source: 'response-file', ok: true };
    weakMcp.passed = true;
    writeJson(root, DEFAULT_PATHS.mcp, weakMcp);
    const weakMcpConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      weakMcpConnectivity.ok,
      false,
      'expected non-live MCP proof to fail production gate',
    );
    assert.equal(
      weakMcpConnectivity.checks.some(
        (check) => check.id === 'mcp.liveSmoke' && check.status === 'fail',
      ),
      true,
      'expected production gate to require live MCP smoke evidence',
    );

    createSelftestFixtures(root);
    const missingMcpTool = JSON.parse(readFileSync(mcpArtifactPath, 'utf8'));
    missingMcpTool.tools = DEFAULT_MCP_REQUIRED_TOOLS.filter(
      (toolName) => toolName !== 'contacts.list',
    );
    missingMcpTool.toolCount = missingMcpTool.tools.length;
    missingMcpTool.checks.toolsList = {
      ...missingMcpTool.checks.toolsList,
      tools: missingMcpTool.tools,
      toolCount: missingMcpTool.tools.length,
      missingRequiredTools: ['contacts.list'],
    };
    missingMcpTool.passed = true;
    writeJson(root, DEFAULT_PATHS.mcp, missingMcpTool);
    const missingMcpRequiredTool = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingMcpRequiredTool.ok,
      false,
      'expected missing required MCP tool to fail production gate',
    );
    assert.equal(
      missingMcpRequiredTool.checks.some(
        (check) => check.id === 'mcp.requiredTools' && check.status === 'fail',
      ),
      true,
      'expected production gate to require release MCP tools',
    );

    createSelftestFixtures(root);
    const missingMcpToolCall = JSON.parse(readFileSync(mcpArtifactPath, 'utf8'));
    delete missingMcpToolCall.checks.toolCall;
    missingMcpToolCall.passed = true;
    writeJson(root, DEFAULT_PATHS.mcp, missingMcpToolCall);
    const missingMcpToolCallProof = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingMcpToolCallProof.ok,
      false,
      'expected missing MCP tools/call proof to fail production gate',
    );
    assert.equal(
      missingMcpToolCallProof.checks.some(
        (check) => check.id === 'mcp.toolCall' && check.status === 'fail',
      ),
      true,
      'expected production gate to require a tools/call smoke',
    );

    createSelftestFixtures(root);
    const unsafeMcpToolCall = JSON.parse(readFileSync(mcpArtifactPath, 'utf8'));
    unsafeMcpToolCall.checks.toolCall = {
      ...unsafeMcpToolCall.checks.toolCall,
      rawOutputIncluded: true,
      content: [{ type: 'text', text: 'real customer output must not be stored' }],
    };
    unsafeMcpToolCall.passed = true;
    writeJson(root, DEFAULT_PATHS.mcp, unsafeMcpToolCall);
    const unsafeMcpToolCallProof = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      unsafeMcpToolCallProof.ok,
      false,
      'expected raw MCP tools/call output to fail production gate',
    );
    assert.equal(
      unsafeMcpToolCallProof.checks.some(
        (check) => check.id === 'mcp.toolCallPrivacy' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject raw MCP tools/call output',
    );

    createSelftestFixtures(root);
    const placeholderMcp = JSON.parse(readFileSync(mcpArtifactPath, 'utf8'));
    placeholderMcp.target = 'https://mcp.staging.bidstack.example';
    placeholderMcp.mcpUrl = 'https://mcp.staging.bidstack.example/mcp';
    writeJson(root, DEFAULT_PATHS.mcp, placeholderMcp);
    const placeholderMcpConnectivity = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      placeholderMcpConnectivity.ok,
      false,
      'expected placeholder MCP target to fail production gate',
    );
    assert.equal(
      placeholderMcpConnectivity.checks.some(
        (check) => check.id === 'mcp.target' && check.status === 'fail',
      ),
      true,
      'expected production gate to reject placeholder MCP target',
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
    for (const checkId of [
      'secrets.ownerApprover',
      'secrets.ownerApprovalTicket',
      'secrets.reviewer',
    ]) {
      assert.equal(
        placeholderSecretDisposition.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
        true,
        `expected ${checkId} to reject placeholder evidence`,
      );
    }

    createSelftestFixtures(root);
    const summaryOnlySecret = JSON.parse(
      readFileSync(path.join(root, DEFAULT_PATHS.secrets), 'utf8'),
    );
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
        summaryOnlySecretEvidence.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
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
    assert.equal(
      dirtySource.ok,
      false,
      'expected dirty source-control evidence to fail production gate',
    );
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
    assert.equal(
      unpushedSource.ok,
      false,
      'expected unpushed source-control evidence to fail production gate',
    );
    assert.equal(
      unpushedSource.checks.some(
        (check) => check.id === 'source.upstreamSynced' && check.status === 'fail',
      ),
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
      missingToolReadiness.checks.some(
        (check) => check.id === 'tools.exists' && check.status === 'fail',
      ),
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
        {
          id: 'gitleaks.image',
          label: 'Gitleaks image executes',
          required: false,
          passed: true,
          skipped: true,
        },
        {
          id: 'k6.image',
          label: 'k6 image executes',
          required: false,
          passed: true,
          skipped: true,
        },
        {
          id: 'semgrep.image',
          label: 'Semgrep image executes',
          required: false,
          passed: true,
          skipped: true,
        },
        {
          id: 'trivy.image',
          label: 'Trivy image executes',
          required: false,
          passed: true,
          skipped: true,
        },
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
      missingOperationalReadiness.checks.some(
        (check) => check.id === 'ops.exists' && check.status === 'fail',
      ),
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
    for (const checkId of [
      'ops.evidence.approval',
      'ops.evidence.whatIf',
      'ops.evidence.restoreDrill',
    ]) {
      assert.equal(
        summaryOnlyOperationalReadiness.checks.some(
          (check) => check.id === checkId && check.status === 'fail',
        ),
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
      weakOperationalReadiness.checks.some(
        (check) => check.id === 'ops.restoreRpo' && check.status === 'fail',
      ),
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
      validationFailures: [
        'restore RTO must be <= 240 minutes',
        'restore RPO must be <= 60 minutes',
      ],
    });
    const missingRestoreTargets = runVerification({ root, deployEnv: 'production' });
    assert.equal(
      missingRestoreTargets.checks.some(
        (check) => check.id === 'ops.restoreRto' && check.status === 'fail',
      ),
      true,
      'expected missing restore RTO to fail instead of passing as 0m',
    );
    assert.equal(
      missingRestoreTargets.checks.some(
        (check) => check.id === 'ops.restoreRpo' && check.status === 'fail',
      ),
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
      failedToolReadiness.checks.some(
        (check) => check.id === 'tools.passed' && check.status === 'fail',
      ),
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
    const missingSbomContainer = JSON.parse(readFileSync(containerArtifactPath, 'utf8'));
    missingSbomContainer.images = missingSbomContainer.images.map(
      ({ image, rawReportPath, vulnerabilities }) => ({
        image,
        rawReportPath,
        vulnerabilities,
      }),
    );
    writeJson(root, DEFAULT_PATHS.container, missingSbomContainer);
    const missingSbomContainerEvidence = runVerification({ root, deployEnv: 'staging' });
    assert.equal(
      missingSbomContainerEvidence.ok,
      false,
      'expected missing container SBOM proof to fail staging gate',
    );
    assert.equal(
      missingSbomContainerEvidence.checks.some(
        (check) => check.id === 'container.sbomReports' && check.status === 'fail',
      ),
      true,
      'expected strict deploy gate to require CycloneDX SBOM report proof',
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
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
