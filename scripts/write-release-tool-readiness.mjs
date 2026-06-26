#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/tool-readiness-latest.json';
const DEFAULT_GITLEAKS_IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.1';
const DEFAULT_SEMGREP_IMAGE = 'semgrep/semgrep:1.165.0';
const DEFAULT_TRIVY_IMAGE = 'aquasec/trivy:0.71.1';
const DEFAULT_K6_IMAGE = 'grafana/k6:2.0.0';

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_TOOL_READINESS_EVIDENCE || DEFAULT_OUTPUT_PATH,
    executeImageProbes:
      parseOptionalBoolean(process.env.BIDSTACK_TOOL_READINESS_EXECUTE_IMAGE_PROBES) ?? false,
    gitleaksMode: normalizeGitleaksMode(process.env.BIDSTACK_GITLEAKS_MODE || 'auto'),
    gitleaksBin: process.env.BIDSTACK_GITLEAKS_BIN || process.env.GITLEAKS_BIN || 'gitleaks',
    gitleaksImage: process.env.BIDSTACK_GITLEAKS_IMAGE || DEFAULT_GITLEAKS_IMAGE,
    semgrepImage: process.env.BIDSTACK_SEMGREP_IMAGE || DEFAULT_SEMGREP_IMAGE,
    trivyImage: process.env.BIDSTACK_TRIVY_IMAGE || DEFAULT_TRIVY_IMAGE,
    k6Image: process.env.K6_DOCKER_IMAGE || DEFAULT_K6_IMAGE,
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--selftest') {
      parsed.selftest = true;
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
    } else if (arg === '--execute-image-probes') {
      parsed.executeImageProbes = true;
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
  process.stdout.write(`BidStack release tool readiness writer

Usage:
  node scripts/write-release-tool-readiness.mjs
  node scripts/write-release-tool-readiness.mjs --execute-image-probes
  node scripts/write-release-tool-readiness.mjs --selftest

Environment:
  BIDSTACK_TOOL_READINESS_EVIDENCE
  BIDSTACK_TOOL_READINESS_EXECUTE_IMAGE_PROBES
  BIDSTACK_GITLEAKS_MODE=auto|native|docker
  BIDSTACK_GITLEAKS_BIN / GITLEAKS_BIN
  BIDSTACK_GITLEAKS_IMAGE
  BIDSTACK_SEMGREP_IMAGE
  BIDSTACK_TRIVY_IMAGE
  K6_DOCKER_IMAGE
`);
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function normalizeGitleaksMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase();
  if (['auto', 'native', 'docker'].includes(mode)) return mode;
  throw new Error(`Invalid gitleaks mode: ${value}`);
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
    timeout: options.timeoutMs ?? 30_000,
  });

  if (result.error) {
    return {
      command: commandLabel(command, args),
      exitCode: null,
      passed: false,
      stdout: '',
      stderr: '',
      error: result.error.code || result.error.message,
    };
  }

  return {
    command: commandLabel(command, args),
    exitCode: result.status,
    passed: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: '',
  };
}

function quoteCmdArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_@./:=-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function runPnpm(root, args) {
  if (process.platform !== 'win32') {
    return runCommand(root, 'pnpm', args);
  }
  return runCommand(root, 'cmd', ['/d', '/s', '/c', ['pnpm', ...args].map(quoteCmdArg).join(' ')]);
}

function oneLine(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
}

function checkFromCommand(id, label, result, detail = {}) {
  const version = detail.version ?? (oneLine(result.stdout) || oneLine(result.stderr) || undefined);
  return {
    id,
    label,
    required: detail.required ?? true,
    passed: result.passed,
    command: result.command,
    exitCode: result.exitCode,
    version,
    detail: detail.detail,
    error: result.passed ? undefined : result.error || oneLine(result.stderr) || oneLine(result.stdout),
  };
}

function checkFile(root, id, relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  return {
    id,
    label: `${relativePath} exists`,
    required: true,
    passed: existsSync(absolutePath),
    detail: relativePath,
  };
}

function parseMajor(versionText) {
  const match = /(\d+)(?:\.(\d+))?/.exec(String(versionText || ''));
  if (!match) return null;
  return Number(match[1]);
}

function versionedCommandCheck(root, id, label, command, args, expectedMajor) {
  const result = runCommand(root, command, args);
  return versionedResultCheck(id, label, result, expectedMajor);
}

function versionedResultCheck(id, label, result, expectedMajor) {
  const major = parseMajor(result.stdout || result.stderr);
  const passed = result.passed && major === expectedMajor;
  return {
    ...checkFromCommand(id, label, { ...result, passed }),
    expected: `major=${expectedMajor}`,
    parsedMajor: major,
  };
}

function dockerImageProbe(root, id, label, image, args, executeImageProbes) {
  if (!executeImageProbes) {
    return {
      id,
      label,
      required: false,
      passed: true,
      skipped: true,
      detail: `${image} probe skipped; set BIDSTACK_TOOL_READINESS_EXECUTE_IMAGE_PROBES=true for registry/image execution proof`,
    };
  }
  const result = runCommand(root, 'docker', ['run', '--rm', image, ...args], {
    timeoutMs: 120_000,
    maxBuffer: 25 * 1024 * 1024,
  });
  return checkFromCommand(id, label, result, {
    required: true,
    detail: image,
  });
}

function collectChecks(options) {
  const checks = [];

  checks.push(versionedCommandCheck(options.root, 'node.version', 'Node.js 24 runtime', 'node', ['--version'], 24));
  checks.push(versionedResultCheck('pnpm.version', 'pnpm 10 package manager', runPnpm(options.root, ['--version']), 10));
  checks.push(checkFromCommand('git.available', 'Git CLI available', runCommand(options.root, 'git', ['--version'])));
  checks.push(checkFromCommand('bash.available', 'Bash available for repo shell gates', runCommand(options.root, 'bash', ['--version'])));

  const dockerCli = runCommand(options.root, 'docker', ['--version']);
  checks.push(checkFromCommand('docker.cli', 'Docker CLI available', dockerCli));
  const dockerDaemon = dockerCli.passed
    ? runCommand(options.root, 'docker', ['version', '--format', '{{.Server.Version}}'])
    : { command: 'docker version --format {{.Server.Version}}', exitCode: null, passed: false, error: 'Docker CLI unavailable', stdout: '', stderr: '' };
  checks.push(checkFromCommand('docker.daemon', 'Docker daemon reachable', dockerDaemon));

  checks.push(checkFromCommand('sentry.cli', 'Sentry CLI available for smoke evidence', runCommand(options.root, 'sentry', ['--version'])));
  checks.push(
    checkFromCommand(
      'playwright.cli',
      'Playwright CLI available for browser evidence',
      runPnpm(options.root, ['--filter', '@bidstack/web', 'exec', 'playwright', '--version']),
    ),
  );

  const localK6 = runCommand(options.root, 'k6', ['version']);
  checks.push({
    id: 'k6.runner',
    label: 'k6 load runner available locally or through Docker fallback',
    required: true,
    passed: localK6.passed || dockerDaemon.passed,
    command: localK6.command,
    exitCode: localK6.exitCode,
    version: localK6.passed ? oneLine(localK6.stdout || localK6.stderr) : `docker fallback ${options.k6Image}`,
    detail: localK6.passed ? 'local k6' : 'Docker fallback is required',
    error: localK6.passed || dockerDaemon.passed ? undefined : 'k6 is unavailable and Docker fallback is not reachable',
  });

  const nativeGitleaks = runCommand(options.root, options.gitleaksBin, ['version']);
  const gitleaksUsesNative = nativeGitleaks.passed && options.gitleaksMode !== 'docker';
  const gitleaksUsesDocker =
    options.gitleaksMode !== 'native' && dockerDaemon.passed && !gitleaksUsesNative;
  checks.push({
    id: 'gitleaks.runner',
    label: 'Gitleaks available natively or through Docker fallback',
    required: true,
    passed:
      (options.gitleaksMode === 'native' && nativeGitleaks.passed) ||
      (options.gitleaksMode === 'docker' && dockerDaemon.passed) ||
      (options.gitleaksMode === 'auto' && (nativeGitleaks.passed || dockerDaemon.passed)),
    command: nativeGitleaks.command,
    exitCode: nativeGitleaks.exitCode,
    version: gitleaksUsesNative ? oneLine(nativeGitleaks.stdout || nativeGitleaks.stderr) : `docker fallback ${options.gitleaksImage}`,
    detail: gitleaksUsesNative ? 'native' : gitleaksUsesDocker ? 'docker fallback' : options.gitleaksMode,
    error:
      nativeGitleaks.passed || dockerDaemon.passed
        ? undefined
        : nativeGitleaks.error || oneLine(nativeGitleaks.stderr) || 'Gitleaks runner unavailable',
  });

  checks.push({
    id: 'semgrep.runner',
    label: 'Semgrep Docker runner available',
    required: true,
    passed: dockerDaemon.passed,
    command: dockerDaemon.command,
    exitCode: dockerDaemon.exitCode,
    version: options.semgrepImage,
    detail: 'Semgrep release evidence runs in Docker',
    error: dockerDaemon.passed ? undefined : 'Docker daemon is required for Semgrep evidence',
  });
  checks.push({
    id: 'trivy.runner',
    label: 'Trivy Docker runner available',
    required: true,
    passed: dockerDaemon.passed,
    command: dockerDaemon.command,
    exitCode: dockerDaemon.exitCode,
    version: options.trivyImage,
    detail: 'Container vulnerability evidence runs in Docker',
    error: dockerDaemon.passed ? undefined : 'Docker daemon is required for Trivy evidence',
  });

  checks.push(dockerImageProbe(options.root, 'gitleaks.image', 'Gitleaks Docker image executes', options.gitleaksImage, ['version'], options.executeImageProbes));
  checks.push(dockerImageProbe(options.root, 'semgrep.image', 'Semgrep Docker image executes', options.semgrepImage, ['semgrep', '--version'], options.executeImageProbes));
  checks.push(dockerImageProbe(options.root, 'trivy.image', 'Trivy Docker image executes', options.trivyImage, ['--version'], options.executeImageProbes));
  checks.push(dockerImageProbe(options.root, 'k6.image', 'k6 Docker image executes', options.k6Image, ['version'], options.executeImageProbes));

  for (const relativePath of [
    '.gitleaks.toml',
    'scripts/check-secrets.sh',
    'scripts/run-k6-load-test.mjs',
    'scripts/run-semgrep-sast.mjs',
    'scripts/run-container-vulnerability-scan.mjs',
    'scripts/write-source-control-evidence.mjs',
    'scripts/write-source-review-plan.mjs',
    'scripts/write-operational-readiness-evidence.mjs',
    'scripts/verify-azure-infra-policy.mjs',
    'scripts/write-secret-scan-evidence.mjs',
    'scripts/write-provider-quality-evidence.mjs',
    'scripts/write-sentry-smoke-evidence.mjs',
    'scripts/write-browser-regression-evidence.mjs',
    'scripts/run-deploy-evidence-bundle.mjs',
    'scripts/verify-deploy-evidence.mjs',
  ]) {
    checks.push(checkFile(options.root, `file.${relativePath}`, relativePath));
  }

  return checks;
}

function buildArtifact(options, checks) {
  const blockingFailures = checks.filter((check) => check.required && check.passed !== true);
  const optionalFailures = checks.filter((check) => !check.required && check.passed !== true);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runner: 'release-tool-readiness',
    executeImageProbes: options.executeImageProbes,
    images: {
      gitleaks: options.gitleaksImage,
      semgrep: options.semgrepImage,
      trivy: options.trivyImage,
      k6: options.k6Image,
    },
    passed: blockingFailures.length === 0,
    blockingFailures: blockingFailures.map((check) => check.id),
    optionalFailures: optionalFailures.map((check) => check.id),
    checks,
  };
}

function writeArtifact(root, outputPath, artifact) {
  const absolutePath = path.resolve(root, outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function runWriter(options) {
  const artifact = buildArtifact(options, collectChecks(options));
  const absolutePath = writeArtifact(options.root, options.outputPath, artifact);
  process.stdout.write(`Release tool readiness: ${path.relative(options.root, absolutePath)}\n`);
  process.stdout.write(`Required checks: ${artifact.checks.filter((check) => check.required).length}\n`);
  process.stdout.write(`Blocking failures: ${artifact.blockingFailures.length}\n`);

  for (const check of artifact.checks) {
    const prefix = check.passed ? 'PASS' : check.required ? 'FAIL' : 'WARN';
    const suffix = check.error ? ` - ${check.error}` : check.detail ? ` - ${check.detail}` : '';
    process.stdout.write(`${prefix} ${check.label}${suffix}\n`);
  }

  if (!artifact.passed) {
    return 1;
  }
  process.stdout.write('Release tool readiness passed\n');
  return 0;
}

function runSelftest() {
  const good = buildArtifact(
    { executeImageProbes: false, gitleaksImage: DEFAULT_GITLEAKS_IMAGE, semgrepImage: DEFAULT_SEMGREP_IMAGE, trivyImage: DEFAULT_TRIVY_IMAGE, k6Image: DEFAULT_K6_IMAGE },
    [
      { id: 'node.version', label: 'Node', required: true, passed: true },
      { id: 'docker.daemon', label: 'Docker', required: true, passed: true },
      { id: 'gitleaks.image', label: 'Gitleaks image', required: false, passed: true, skipped: true },
    ],
  );
  assert.equal(good.passed, true);
  assert.deepEqual(good.blockingFailures, []);

  const missingRequired = buildArtifact(
    { executeImageProbes: false, gitleaksImage: DEFAULT_GITLEAKS_IMAGE, semgrepImage: DEFAULT_SEMGREP_IMAGE, trivyImage: DEFAULT_TRIVY_IMAGE, k6Image: DEFAULT_K6_IMAGE },
    [
      { id: 'node.version', label: 'Node', required: true, passed: true },
      { id: 'docker.daemon', label: 'Docker', required: true, passed: false },
      { id: 'gitleaks.image', label: 'Gitleaks image', required: false, passed: true, skipped: true },
    ],
  );
  assert.equal(missingRequired.passed, false);
  assert.deepEqual(missingRequired.blockingFailures, ['docker.daemon']);

  const failedRequiredProbe = buildArtifact(
    { executeImageProbes: true, gitleaksImage: DEFAULT_GITLEAKS_IMAGE, semgrepImage: DEFAULT_SEMGREP_IMAGE, trivyImage: DEFAULT_TRIVY_IMAGE, k6Image: DEFAULT_K6_IMAGE },
    [
      { id: 'docker.daemon', label: 'Docker', required: true, passed: true },
      { id: 'semgrep.image', label: 'Semgrep image', required: true, passed: false },
    ],
  );
  assert.equal(failedRequiredProbe.passed, false);
  assert.deepEqual(failedRequiredProbe.blockingFailures, ['semgrep.image']);

  process.stdout.write('release tool readiness selftest passed\n');
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
