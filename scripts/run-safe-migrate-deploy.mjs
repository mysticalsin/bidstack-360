#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PRODUCTION_LIKE_ENVS = new Set(['prod', 'production', 'stage', 'staging']);
const SUPPORTED_BACKUP_KINDS = new Set(['managed-snapshot', 'pg_dump', 'pitr-restore-point']);
const DEFAULT_MAX_AGE_MINUTES = 60;

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.selftest) {
    runSelftest();
    return;
  }

  const deployEnv = normalizeDeployEnv(
    options.env ?? process.env.BIDSTACK_DEPLOY_ENV ?? process.env.NODE_ENV,
  );
  const isProductionLike = PRODUCTION_LIKE_ENVS.has(deployEnv);
  const maxAgeMinutes = parsePositiveInteger(
    options.maxAgeMinutes ?? process.env.BIDSTACK_MIGRATE_BACKUP_MAX_AGE_MINUTES,
    DEFAULT_MAX_AGE_MINUTES,
  );

  const preflight = validateMigrationSafetyPreflight({
    backupProofPath: options.backupProofPath ?? process.env.BIDSTACK_MIGRATE_BACKUP_PROOF,
    databaseUrl: process.env.DATABASE_URL,
    deployEnv,
    isProductionLike,
    maxAgeMinutes,
    now: new Date(),
  });

  for (const message of preflight.messages) {
    console.log(message);
  }

  if (options.dryRun) {
    console.log('[safe-migrate] dry run complete; Prisma migrate deploy was not executed.');
    return;
  }

  const command = buildMigrateCommand(options);
  console.log(`[safe-migrate] running ${command.displayName}; backup gate=${preflight.status}`);

  const result = runMigrateCommand(command);

  if (result.error) {
    throw new Error(`[safe-migrate] failed to start migrate command: ${result.error.message}`);
  }

  process.exit(result.status ?? 1);
}

function runMigrateCommand(command) {
  // Node >= 20.12 refuses to spawn .cmd shims (pnpm.cmd) without a shell
  // (CVE-2024-27980 fix throws EINVAL), so Windows must route through the
  // shell like write-a11y-evidence.mjs does. Quote shell args ourselves
  // because Node does not quote them when shell mode is enabled.
  const useShell = process.platform === 'win32';
  return spawnSync(
    useShell ? quoteForCmdShell(command.bin) : command.bin,
    useShell ? command.args.map(quoteForCmdShell) : command.args,
    {
      env: process.env,
      shell: useShell,
      stdio: 'inherit',
    },
  );
}

function parseArgs(args) {
  const options = {
    backupProofPath: undefined,
    dryRun: false,
    env: undefined,
    maxAgeMinutes: undefined,
    prismaBin: undefined,
    schema: undefined,
    selftest: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--selftest') {
      options.selftest = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--env') {
      options.env = requireValue(args, (index += 1), arg);
    } else if (arg.startsWith('--env=')) {
      options.env = arg.slice('--env='.length);
    } else if (arg === '--backup-proof') {
      options.backupProofPath = requireValue(args, (index += 1), arg);
    } else if (arg.startsWith('--backup-proof=')) {
      options.backupProofPath = arg.slice('--backup-proof='.length);
    } else if (arg === '--max-age-minutes') {
      options.maxAgeMinutes = requireValue(args, (index += 1), arg);
    } else if (arg.startsWith('--max-age-minutes=')) {
      options.maxAgeMinutes = arg.slice('--max-age-minutes='.length);
    } else if (arg === '--prisma-bin') {
      options.prismaBin = requireValue(args, (index += 1), arg);
    } else if (arg.startsWith('--prisma-bin=')) {
      options.prismaBin = arg.slice('--prisma-bin='.length);
    } else if (arg === '--schema') {
      options.schema = requireValue(args, (index += 1), arg);
    } else if (arg.startsWith('--schema=')) {
      options.schema = arg.slice('--schema='.length);
    } else {
      throw new Error(`[safe-migrate] unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(args, index, flag) {
  const value = args[index];

  if (!value || value.startsWith('--')) {
    throw new Error(`[safe-migrate] ${flag} requires a value.`);
  }

  return value;
}

function normalizeDeployEnv(value) {
  return String(value || 'development')
    .trim()
    .toLowerCase();
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('[safe-migrate] max backup age must be a positive integer.');
  }

  return parsed;
}

function validateMigrationSafetyPreflight({
  backupProofPath,
  databaseUrl,
  deployEnv,
  isProductionLike,
  maxAgeMinutes,
  now,
}) {
  if (!isProductionLike) {
    return {
      messages: [
        `[safe-migrate] ${deployEnv} is not production-like; backup proof gate not required.`,
      ],
      status: 'not-required',
    };
  }

  if (!databaseUrl) {
    throw new Error(
      '[safe-migrate] DATABASE_URL is required for staging/production migration backup verification.',
    );
  }

  if (!backupProofPath) {
    throw new Error(
      '[safe-migrate] BIDSTACK_MIGRATE_BACKUP_PROOF is required before staging/production migrations.',
    );
  }

  const proof = readProofJson(backupProofPath);
  const normalizedProof = normalizeProof(proof);
  validateProofContract(normalizedProof);
  validateProofMatchesEnvironment(normalizedProof, deployEnv);
  validateProofFreshness(normalizedProof, maxAgeMinutes, now);
  validateProofMatchesDatabase(normalizedProof, databaseUrl);
  validateProofBackup(normalizedProof);

  return {
    messages: [
      `[safe-migrate] backup proof accepted: env=${deployEnv} fingerprint=${databaseUrlFingerprint(
        databaseUrl,
      ).slice(0, 19)}... kind=${normalizedProof.backup.kind} location=${redactLocation(
        normalizedProof.backup.location,
      )}`,
    ],
    status: 'verified',
  };
}

function readProofJson(path) {
  let raw;

  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`[safe-migrate] unable to read backup proof file: ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`[safe-migrate] backup proof file must be valid JSON: ${error.message}`);
  }
}

function normalizeProof(proof) {
  return {
    backup: {
      encrypted: proof?.backup?.encrypted,
      kind: proof?.backup?.kind,
      location: proof?.backup?.location,
      restoreTested: proof?.backup?.restoreTested ?? proof?.backup?.restore_tested,
      sizeBytes: proof?.backup?.sizeBytes ?? proof?.backup?.size_bytes,
    },
    databaseUrlFingerprint: proof?.databaseUrlFingerprint ?? proof?.database_url_fingerprint,
    environment: proof?.environment,
    generatedAt: proof?.generatedAt ?? proof?.generated_at,
    passed: proof?.passed,
    schemaVersion: proof?.schemaVersion ?? proof?.schema_version,
  };
}

function validateProofContract(proof) {
  if (proof.schemaVersion !== 1) {
    throw new Error('[safe-migrate] backup proof schemaVersion must be 1.');
  }

  if (proof.passed !== true) {
    throw new Error('[safe-migrate] backup proof must have passed=true.');
  }

  if (!proof.generatedAt || Number.isNaN(Date.parse(proof.generatedAt))) {
    throw new Error('[safe-migrate] backup proof generatedAt must be an ISO date.');
  }

  if (!proof.environment || typeof proof.environment !== 'string') {
    throw new Error('[safe-migrate] backup proof environment is required.');
  }

  if (
    !proof.databaseUrlFingerprint ||
    !/^sha256:[a-f0-9]{64}$/u.test(proof.databaseUrlFingerprint)
  ) {
    throw new Error(
      '[safe-migrate] backup proof databaseUrlFingerprint must be sha256:<64 hex chars>.',
    );
  }
}

function validateProofMatchesEnvironment(proof, deployEnv) {
  if (normalizeDeployEnv(proof.environment) !== deployEnv) {
    throw new Error(
      `[safe-migrate] backup proof environment mismatch: proof=${normalizeDeployEnv(
        proof.environment,
      )} deploy=${deployEnv}.`,
    );
  }
}

function validateProofFreshness(proof, maxAgeMinutes, now) {
  const generatedAtMs = Date.parse(proof.generatedAt);
  const ageMs = now.getTime() - generatedAtMs;
  const maxAgeMs = maxAgeMinutes * 60 * 1000;

  if (ageMs < -60_000) {
    throw new Error('[safe-migrate] backup proof generatedAt is in the future.');
  }

  if (ageMs > maxAgeMs) {
    throw new Error(`[safe-migrate] backup proof is stale; max age is ${maxAgeMinutes} minutes.`);
  }
}

function validateProofMatchesDatabase(proof, databaseUrl) {
  const expected = databaseUrlFingerprint(databaseUrl);

  if (proof.databaseUrlFingerprint !== expected) {
    throw new Error(
      '[safe-migrate] backup proof database fingerprint does not match DATABASE_URL.',
    );
  }
}

function validateProofBackup(proof) {
  if (!SUPPORTED_BACKUP_KINDS.has(proof.backup.kind)) {
    throw new Error(
      `[safe-migrate] backup proof kind must be one of: ${[...SUPPORTED_BACKUP_KINDS].join(', ')}.`,
    );
  }

  if (proof.backup.encrypted !== true) {
    throw new Error('[safe-migrate] backup proof must mark backup.encrypted=true.');
  }

  if (
    proof.backup.sizeBytes !== undefined &&
    (!Number.isInteger(proof.backup.sizeBytes) || proof.backup.sizeBytes < 1)
  ) {
    throw new Error('[safe-migrate] backup proof sizeBytes must be a positive integer.');
  }

  if (!isDurableBackupLocation(proof.backup.location)) {
    throw new Error(
      '[safe-migrate] backup proof location must be a durable, non-placeholder backup location.',
    );
  }
}

function isDurableBackupLocation(location) {
  if (typeof location !== 'string') {
    return false;
  }

  const trimmed = location.trim();

  if (
    !trimmed ||
    trimmed.includes('<') ||
    trimmed.includes('>') ||
    /example|placeholder|changeme|todo/iu.test(trimmed)
  ) {
    return false;
  }

  if (/^(s3|az|azure|gs):\/\//iu.test(trimmed)) {
    return true;
  }

  if (/^https:\/\//iu.test(trimmed)) {
    return true;
  }

  if (/^file:\/\//iu.test(trimmed)) {
    return !/^file:\/\/(\/tmp|\/var\/tmp|\/run)(\/|$)/iu.test(trimmed);
  }

  if (/^[a-z]:\\/iu.test(trimmed)) {
    return !/^[a-z]:\\(temp|tmp)\\/iu.test(trimmed);
  }

  if (/^\//u.test(trimmed)) {
    return !/^\/(tmp|var\/tmp|run)(\/|$)/u.test(trimmed);
  }

  return false;
}

function databaseUrlFingerprint(databaseUrl) {
  return `sha256:${createHash('sha256').update(databaseUrl).digest('hex')}`;
}

function redactLocation(location) {
  try {
    const url = new URL(location);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(location).replace(/[?].*$/u, '?<redacted>');
  }
}

function quoteForCmdShell(value) {
  // cmd.exe splits unquoted spaces, so a prisma bin or schema path with
  // spaces would silently become multiple arguments without this.
  return /\s/u.test(value) ? `"${value}"` : value;
}

function buildMigrateCommand(options) {
  if (options.prismaBin) {
    const schema = options.schema ?? 'packages/db/prisma/schema.prisma';
    return {
      args: ['migrate', 'deploy', '--schema', schema],
      bin: options.prismaBin,
      displayName: `${options.prismaBin} migrate deploy`,
    };
  }

  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return {
    args: ['--filter', '@bidstack/db', 'migrate:deploy'],
    bin: pnpmBin,
    displayName: 'pnpm --filter @bidstack/db migrate:deploy',
  };
}

function runSelftest() {
  const root = mkdtempSync(join(tmpdir(), 'bidstack-safe-migrate-'));
  const now = new Date('2026-06-29T12:00:00.000Z');
  const databaseUrl = 'postgresql://bidstack@example.internal:5432/bidstack?schema=public';
  const validProof = {
    backup: {
      encrypted: true,
      kind: 'pg_dump',
      location: 's3://bidstack-prod-db-backups/pre-migrate/20260629T115800Z.dump',
      restoreTested: false,
      sizeBytes: 1024,
    },
    databaseUrlFingerprint: databaseUrlFingerprint(databaseUrl),
    environment: 'production',
    generatedAt: '2026-06-29T11:58:00.000Z',
    passed: true,
    schemaVersion: 1,
  };

  try {
    expectFailure('production without proof', () =>
      validateMigrationSafetyPreflight({
        backupProofPath: undefined,
        databaseUrl,
        deployEnv: 'production',
        isProductionLike: true,
        maxAgeMinutes: 60,
        now,
      }),
    );

    expectFailure('missing DATABASE_URL', () =>
      validateMigrationSafetyPreflight({
        backupProofPath: writeProof(root, 'valid.json', validProof),
        databaseUrl: '',
        deployEnv: 'production',
        isProductionLike: true,
        maxAgeMinutes: 60,
        now,
      }),
    );

    expectFailure(
      'stale proof',
      () =>
        validateMigrationSafetyPreflight({
          backupProofPath: writeProof(root, 'stale.json', {
            ...validProof,
            generatedAt: '2026-06-29T10:00:00.000Z',
          }),
          databaseUrl,
          deployEnv: 'production',
          isProductionLike: true,
          maxAgeMinutes: 60,
          now,
        }),
      'stale',
    );

    expectFailure(
      'environment mismatch',
      () =>
        validateMigrationSafetyPreflight({
          backupProofPath: writeProof(root, 'env-mismatch.json', {
            ...validProof,
            environment: 'staging',
          }),
          databaseUrl,
          deployEnv: 'production',
          isProductionLike: true,
          maxAgeMinutes: 60,
          now,
        }),
      'environment mismatch',
    );

    expectFailure(
      'fingerprint mismatch',
      () =>
        validateMigrationSafetyPreflight({
          backupProofPath: writeProof(root, 'fingerprint-mismatch.json', {
            ...validProof,
            databaseUrlFingerprint: databaseUrlFingerprint(
              'postgresql://other@example.internal:5432/bidstack',
            ),
          }),
          databaseUrl,
          deployEnv: 'production',
          isProductionLike: true,
          maxAgeMinutes: 60,
          now,
        }),
      'fingerprint',
    );

    expectFailure(
      'plaintext backup',
      () =>
        validateMigrationSafetyPreflight({
          backupProofPath: writeProof(root, 'plaintext.json', {
            ...validProof,
            backup: {
              ...validProof.backup,
              encrypted: false,
            },
          }),
          databaseUrl,
          deployEnv: 'production',
          isProductionLike: true,
          maxAgeMinutes: 60,
          now,
        }),
      'encrypted',
    );

    expectFailure(
      'temporary backup location',
      () =>
        validateMigrationSafetyPreflight({
          backupProofPath: writeProof(root, 'temporary-location.json', {
            ...validProof,
            backup: {
              ...validProof.backup,
              location: 'file:///tmp/pre-migrate.dump',
            },
          }),
          databaseUrl,
          deployEnv: 'production',
          isProductionLike: true,
          maxAgeMinutes: 60,
          now,
        }),
      'durable',
    );

    const pass = validateMigrationSafetyPreflight({
      backupProofPath: writeProof(root, 'valid-proof.json', validProof),
      databaseUrl,
      deployEnv: 'production',
      isProductionLike: true,
      maxAgeMinutes: 60,
      now,
    });

    assert(pass.status === 'verified', 'valid production proof should pass');

    const output = pass.messages.join('\n');
    assert(
      !output.includes(databaseUrl),
      'preflight output must not leak DATABASE_URL or credentials',
    );

    const devPass = validateMigrationSafetyPreflight({
      backupProofPath: undefined,
      databaseUrl: undefined,
      deployEnv: 'test',
      isProductionLike: false,
      maxAgeMinutes: 60,
      now,
    });

    assert(devPass.status === 'not-required', 'test env should not require proof');

    console.log('[safe-migrate] selftest PASS (8/8)');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function writeProof(root, name, proof) {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return path;
}

function expectFailure(name, fn, expectedMessagePart) {
  try {
    fn();
  } catch (error) {
    if (expectedMessagePart && !String(error.message).includes(expectedMessagePart)) {
      throw new Error(
        `[safe-migrate] selftest ${name} failed with unexpected error: ${error.message}`,
      );
    }
    return;
  }

  throw new Error(`[safe-migrate] selftest ${name} should have failed.`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[safe-migrate] selftest assertion failed: ${message}`);
  }
}

main();
