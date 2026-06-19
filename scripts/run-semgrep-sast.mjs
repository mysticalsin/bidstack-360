#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SEMGREP_IMAGE = process.env.BIDSTACK_SEMGREP_IMAGE || 'semgrep/semgrep:1.165.0';
const CONFIGS = (
  process.env.BIDSTACK_SEMGREP_CONFIGS || 'p/owasp-top-ten,p/javascript,p/typescript'
)
  .split(',')
  .map((config) => config.trim())
  .filter(Boolean);
const SEVERITIES = (process.env.BIDSTACK_SEMGREP_SEVERITIES || 'ERROR')
  .split(',')
  .map((severity) => severity.trim().toUpperCase())
  .filter(Boolean);
const KEEP_TEMP = process.env.BIDSTACK_SEMGREP_KEEP_TEMP === 'true';
const REPORT_PATH = process.env.BIDSTACK_SEMGREP_REPORT || 'deploy-evidence/semgrep-latest.json';

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.prisma',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const ROOT_FILES = new Set([
  '.dockerignore',
  '.gitleaks.toml',
  'Dockerfile',
  'docker-compose.yml',
  'eslint.config.js',
  'package.json',
  'pnpm-workspace.yaml',
]);
const SOURCE_PREFIXES = [
  'apps/api/',
  'apps/marketing/',
  'apps/mcp-server/',
  'apps/web/',
  'apps/worker/',
  'integrations/',
  'packages/db/',
  'packages/dust-client/',
  'packages/integrations/',
  'packages/memos/',
  'packages/odoo-mcp-client/',
  'packages/shared/',
  'scripts/',
];
const EXCLUDED_PREFIXES = [
  '.audit-screens/',
  '.claude/worktrees/',
  '.codex/',
  '.forge/',
  'BIDCRM-design/',
  'apps/web/playwright-report/',
  'apps/web/test-results/',
  'apps/web/public/locales/',
  'coverage/',
  'node_modules/',
  'packages/twenty-bidstack/',
  'scratch/',
  'scratch_img/',
];
const EXCLUDED_PARTS = [
  '/.turbo/',
  '/.vite/',
  '/build/',
  '/coverage/',
  '/dist/',
  '/node_modules/',
  '/playwright-report/',
  '/test-results/',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function toPosix(filePath) {
  return filePath.replaceAll(path.sep, '/');
}

function shouldScan(filePath) {
  const normalized = toPosix(filePath);
  if (!normalized || normalized.endsWith('/')) {
    return false;
  }
  if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (EXCLUDED_PARTS.some((part) => normalized.includes(part))) {
    return false;
  }
  if (ROOT_FILES.has(normalized)) {
    return true;
  }
  if (normalized.startsWith('.')) {
    return false;
  }
  const extension = path.extname(normalized);
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }
  return SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function listCandidateFiles() {
  const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(toPosix)
    .filter(shouldScan)
    .filter((filePath) => existsSync(path.join(ROOT, filePath)));
}

function semgrepDockerfileMirror(source) {
  const transformations = [];
  let content = source;

  const emptyArgDefaultCount = [...content.matchAll(/^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=$/gm)]
    .length;
  if (emptyArgDefaultCount > 0) {
    content = content.replace(/^ARG\s+([A-Za-z_][A-Za-z0-9_]*)=$/gm, 'ARG $1=""');
    transformations.push({
      filePath: 'Dockerfile',
      kind: 'dockerfile-empty-arg-default',
      replacements: emptyArgDefaultCount,
      reason:
        'Semgrep Dockerfile parser rejects valid empty ARG defaults; source Dockerfile is unchanged.',
    });
  }

  const healthcheckContinuationCount = [
    ...content.matchAll(/^(HEALTHCHECK\b[^\r\n]*?)\\\r?\n\s+(CMD\b[^\r\n]*)/gm),
  ].length;
  if (healthcheckContinuationCount > 0) {
    content = content.replace(
      /^(HEALTHCHECK\b[^\r\n]*?)\\\r?\n\s+(CMD\b[^\r\n]*)/gm,
      '$1 $2',
    );
    transformations.push({
      filePath: 'Dockerfile',
      kind: 'dockerfile-healthcheck-continuation',
      replacements: healthcheckContinuationCount,
      reason:
        'Semgrep Dockerfile parser partially parses valid HEALTHCHECK continuations; source Dockerfile is unchanged.',
    });
  }

  return { content, transformations };
}

function copyScanTree(files, destination) {
  const transformations = [];
  for (const filePath of files) {
    const source = path.join(ROOT, filePath);
    const target = path.join(destination, filePath);
    mkdirSync(path.dirname(target), { recursive: true });
    if (filePath === 'Dockerfile') {
      const transformed = semgrepDockerfileMirror(readFileSync(source, 'utf8'));
      writeFileSync(target, transformed.content, 'utf8');
      transformations.push(...transformed.transformations);
    } else {
      cpSync(source, target, { dereference: true, force: true });
    }
  }
  return transformations;
}

function summarizeResults(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    const findings = Array.isArray(parsed.results) ? parsed.results : [];
    return findings.map((finding) => ({
      checkId: finding.check_id,
      path: finding.path,
      line: finding.start?.line,
      severity: finding.extra?.severity,
      message: finding.extra?.message,
    }));
  } catch {
    return null;
  }
}

function clipOutput(value) {
  return String(value || '').trim().slice(-4000);
}

function runDockerfileSyntaxCheck(files) {
  if (!files.includes('Dockerfile')) {
    return { checked: false, passed: true };
  }
  const result = run('docker', ['build', '--check', '.'], { cwd: ROOT });
  return {
    checked: true,
    command: 'docker build --check .',
    exitCode: result.status ?? 1,
    passed: (result.status ?? 1) === 0,
    stdout: clipOutput(result.stdout),
    stderr: clipOutput(result.stderr),
  };
}

function buildEvidence(
  stdout,
  status,
  fileCount,
  mirrorTransformations,
  dockerfileSyntaxCheck,
) {
  const generatedAt = new Date().toISOString();
  try {
    const parsed = JSON.parse(stdout);
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    const blockingSeveritySet = new Set(SEVERITIES);
    const blockingFindings = results.filter((finding) =>
      blockingSeveritySet.has(
        String(finding?.extra?.severity ?? finding?.severity ?? '').toUpperCase(),
      ),
    ).length;

    return {
      ...parsed,
      schemaVersion: 1,
      generatedAt,
      scanner: 'semgrep',
      image: SEMGREP_IMAGE,
      configs: CONFIGS,
      severities: SEVERITIES,
      mirroredFileCount: fileCount,
      mirrorTransformations,
      dockerfileSyntaxCheck,
      commandExitCode: status ?? 1,
      passed:
        (status ?? 1) === 0 &&
        errors.length === 0 &&
        blockingFindings === 0 &&
        dockerfileSyntaxCheck.passed !== false,
      blockingFindings,
      results,
      errors,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      generatedAt,
      scanner: 'semgrep',
      image: SEMGREP_IMAGE,
      configs: CONFIGS,
      severities: SEVERITIES,
      mirroredFileCount: fileCount,
      mirrorTransformations,
      dockerfileSyntaxCheck,
      commandExitCode: status ?? 1,
      passed: false,
      blockingFindings: 0,
      results: [],
      errors: [
        {
          type: 'parse_error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function writeEvidenceReport(
  stdout,
  status,
  fileCount,
  mirrorTransformations,
  dockerfileSyntaxCheck,
) {
  const absolutePath = path.resolve(ROOT, REPORT_PATH);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    `${JSON.stringify(
      buildEvidence(stdout, status, fileCount, mirrorTransformations, dockerfileSyntaxCheck),
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write(`Semgrep evidence artifact: ${absolutePath}\n`);
}

function printFindingSummary(findings) {
  if (!findings || findings.length === 0) {
    return;
  }
  console.error(`Semgrep findings: ${findings.length}`);
  for (const finding of findings.slice(0, 50)) {
    const location = `${finding.path ?? 'unknown'}:${finding.line ?? '?'}`;
    console.error(`- ${finding.severity ?? 'UNKNOWN'} ${finding.checkId ?? 'unknown'} ${location}`);
    if (finding.message) {
      console.error(`  ${finding.message}`);
    }
  }
  if (findings.length > 50) {
    console.error(`- ... ${findings.length - 50} more findings omitted from console summary`);
  }
}

const files = listCandidateFiles();
if (files.length === 0) {
  process.stdout.write('No source/config files selected for Semgrep scan.\n');
  process.exit(0);
}

const tempRoot = path.join(tmpdir(), `bidcrm-semgrep-${Date.now()}`);
mkdirSync(tempRoot, { recursive: true });

try {
  const mirrorTransformations = copyScanTree(files, tempRoot);
  const dockerfileSyntaxCheck = runDockerfileSyntaxCheck(files);

  const dockerArgs = [
    'run',
    '--rm',
    '-v',
    `${tempRoot}:/src:ro`,
    '-w',
    '/src',
    SEMGREP_IMAGE,
    'semgrep',
    'scan',
    '--metrics=off',
    '--timeout=20',
    '--timeout-threshold=3',
    '--jobs=2',
    '--error',
    '--json',
  ];
  for (const config of CONFIGS) {
    dockerArgs.push('--config', config);
  }
  for (const severity of SEVERITIES) {
    dockerArgs.push('--severity', severity);
  }
  dockerArgs.push('.');

  process.stdout.write(`Semgrep image: ${SEMGREP_IMAGE}\n`);
  process.stdout.write(`Semgrep configs: ${CONFIGS.join(', ')}\n`);
  process.stdout.write(`Semgrep severities: ${SEVERITIES.join(', ')}\n`);
  process.stdout.write(`Files mirrored for scan: ${files.length}\n`);
  if (mirrorTransformations.length > 0) {
    process.stdout.write(
      `Semgrep mirror transformations: ${mirrorTransformations
        .map((item) => `${item.kind}:${item.replacements}`)
        .join(', ')}\n`,
    );
  }
  if (dockerfileSyntaxCheck.checked) {
    process.stdout.write(
      `Dockerfile syntax check: ${dockerfileSyntaxCheck.passed ? 'passed' : 'failed'}\n`,
    );
  }

  const result = run('docker', dockerArgs, { cwd: ROOT });
  writeEvidenceReport(
    result.stdout,
    result.status,
    files.length,
    mirrorTransformations,
    dockerfileSyntaxCheck,
  );

  const findings = summarizeResults(result.stdout);
  if (dockerfileSyntaxCheck.checked && !dockerfileSyntaxCheck.passed) {
    console.error('Dockerfile syntax check failed.');
    console.error(dockerfileSyntaxCheck.stderr || dockerfileSyntaxCheck.stdout);
    process.exit(dockerfileSyntaxCheck.exitCode || 1);
  }
  if (result.status !== 0) {
    printFindingSummary(findings);
    if (!findings) {
      console.error(result.stderr || result.stdout);
    }
    process.exit(result.status ?? 1);
  }

  printFindingSummary(findings);
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }
  process.stdout.write('Semgrep SAST scan passed.\n');
} finally {
  if (KEEP_TEMP) {
    process.stdout.write(`Semgrep temp mirror kept at: ${tempRoot}\n`);
  } else {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
