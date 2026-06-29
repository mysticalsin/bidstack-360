#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_OUTPUT_PATH = 'deploy-evidence/pii-ciphertext-latest.json';
const ENCRYPTED_PREFIX = 'enc:v1:';
const EMAIL_HASH_PATTERN = '^[0-9a-f]{64}$';
const DEFAULT_REQUIRED_MODELS = ['contact', 'lead', 'kamConsultant'];

const MODEL_DEFINITIONS = [
  {
    id: 'contact',
    label: 'Contact',
    table: 'contacts',
    fields: [
      { id: 'email', column: 'email', hashColumn: 'email_hash' },
      { id: 'phone', column: 'phone' },
    ],
  },
  {
    id: 'lead',
    label: 'Lead',
    table: 'leads',
    fields: [
      { id: 'email', column: 'email', hashColumn: 'email_hash' },
      { id: 'phone', column: 'phone' },
    ],
  },
  {
    id: 'kamConsultant',
    label: 'KAM consultant',
    table: 'kam_consultants',
    fields: [{ id: 'email', column: 'email', hashColumn: 'email_hash' }],
  },
];

const MODEL_IDS = new Set(MODEL_DEFINITIONS.map((definition) => definition.id));
const MODEL_ALIASES = new Map([
  ['contacts', 'contact'],
  ['leads', 'lead'],
  ['kam', 'kamConsultant'],
  ['kam_consultant', 'kamConsultant'],
  ['kam-consultant', 'kamConsultant'],
  ['kam_consultants', 'kamConsultant'],
  ['kam-consultants', 'kamConsultant'],
]);

function parseArgs(argv) {
  const database = resolveDatabaseUrlFromEnv();
  const options = {
    root: process.cwd(),
    outputPath: process.env.BIDSTACK_PII_CIPHERTEXT_EVIDENCE ?? DEFAULT_OUTPUT_PATH,
    deployEnv: process.env.BIDSTACK_DEPLOY_ENV ?? process.env.NODE_ENV ?? 'unknown',
    databaseUrl: database.value,
    databaseUrlSource: database.source,
    requiredModels: normalizeRequiredModels(
      process.env.BIDSTACK_PII_CIPHERTEXT_REQUIRED_MODELS ?? DEFAULT_REQUIRED_MODELS.join(','),
    ),
    strict: resolveStrictDefault(),
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--selftest') {
      options.selftest = true;
    } else if (arg === '--root') {
      options.root = next;
      index += 1;
    } else if (arg === '--output') {
      options.outputPath = next;
      index += 1;
    } else if (arg === '--env') {
      options.deployEnv = next;
      index += 1;
    } else if (arg === '--database-url') {
      options.databaseUrl = next;
      options.databaseUrlSource = '--database-url';
      index += 1;
    } else if (arg === '--required-models') {
      options.requiredModels = normalizeRequiredModels(next);
      index += 1;
    } else if (arg === '--allow-empty') {
      options.requiredModels = [];
    } else if (arg === '--non-strict') {
      options.strict = false;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/write-pii-ciphertext-evidence.mjs [options]

Writes deploy-evidence/pii-ciphertext-latest.json with privacy-safe raw database
counts proving supported PII columns are encrypted.

Environment:
  BIDSTACK_PII_CIPHERTEXT_DATABASE_URL       Release database URL
  DATABASE_URL                               Fallback release database URL
  BIDSTACK_PII_CIPHERTEXT_EVIDENCE           Output path
  BIDSTACK_PII_CIPHERTEXT_REQUIRED_MODELS    CSV: contact,lead,kamConsultant
  BIDSTACK_DEPLOY_ENV                        Evidence environment label

Options:
  --database-url <url>        Override database URL
  --required-models <csv>     Require non-empty encrypted email rows for models
  --allow-empty               Do not require non-empty model coverage
  --output <path>             Override evidence output path
  --env <name>                Override deploy environment
  --strict / --non-strict     Toggle strict release checks
  --selftest                  Run offline contract tests
`);
}

function resolveStrictDefault() {
  const piiStrict = String(process.env.BIDSTACK_PII_CIPHERTEXT_STRICT ?? '').trim();
  if (piiStrict === '0' || piiStrict.toLowerCase() === 'false') {
    return false;
  }
  return process.env.BIDSTACK_STRICT_DEPLOY_GATE !== '0';
}

function resolveDatabaseUrlFromEnv() {
  const piiUrl = String(process.env.BIDSTACK_PII_CIPHERTEXT_DATABASE_URL ?? '').trim();
  if (piiUrl) {
    return { source: 'BIDSTACK_PII_CIPHERTEXT_DATABASE_URL', value: piiUrl };
  }

  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  if (databaseUrl) {
    return { source: 'DATABASE_URL', value: databaseUrl };
  }

  return { source: null, value: '' };
}

function normalizeRequiredModels(value) {
  const seen = new Set();
  const result = [];

  for (const item of String(value ?? '')
    .split(',')
    .map((modelId) => modelId.trim())
    .filter(Boolean)) {
    const normalized = MODEL_ALIASES.get(item) ?? item;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function toCount(value) {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildModelQuery(definition) {
  const selections = [];

  for (const field of definition.fields) {
    const column = quoteIdentifier(field.column);
    selections.push(
      `COUNT(*) FILTER (WHERE ${column} IS NOT NULL) AS "${field.id}_non_null"`,
      `COUNT(*) FILTER (WHERE ${column} IS NOT NULL AND CAST(${column} AS text) LIKE '${ENCRYPTED_PREFIX}%') AS "${field.id}_encrypted"`,
      `COUNT(*) FILTER (WHERE ${column} IS NOT NULL AND CAST(${column} AS text) NOT LIKE '${ENCRYPTED_PREFIX}%') AS "${field.id}_plaintext"`,
    );

    if (field.hashColumn) {
      const hashColumn = quoteIdentifier(field.hashColumn);
      selections.push(
        `COUNT(*) FILTER (WHERE ${column} IS NOT NULL AND ${hashColumn} ~ '${EMAIL_HASH_PATTERN}') AS "${field.id}_hash_valid"`,
        `COUNT(*) FILTER (WHERE ${column} IS NOT NULL AND (${hashColumn} IS NULL OR ${hashColumn} !~ '${EMAIL_HASH_PATTERN}')) AS "${field.id}_hash_invalid"`,
      );
    }
  }

  return `SELECT ${selections.join(', ')} FROM ${quoteIdentifier(definition.table)}`;
}

async function queryModel(prisma, definition) {
  const rows = await prisma.$queryRawUnsafe(buildModelQuery(definition));
  const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const fields = {};

  for (const field of definition.fields) {
    const summary = {
      nonNull: toCount(row[`${field.id}_non_null`]),
      encrypted: toCount(row[`${field.id}_encrypted`]),
      plaintext: toCount(row[`${field.id}_plaintext`]),
    };

    if (field.hashColumn) {
      summary.hashValid = toCount(row[`${field.id}_hash_valid`]);
      summary.hashInvalid = toCount(row[`${field.id}_hash_invalid`]);
    }

    fields[field.id] = summary;
  }

  return {
    id: definition.id,
    label: definition.label,
    table: definition.table,
    fields,
    passed: false,
    validationFailures: [],
  };
}

async function collectLiveScan(options) {
  const startedAt = new Date().toISOString();
  if (!options.databaseUrl) {
    return {
      source: 'raw-db-pii-ciphertext-scan',
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      error: 'Database URL is required for PII ciphertext evidence.',
      databaseUrlConfigured: false,
      databaseUrlSource: null,
      models: {},
    };
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = options.databaseUrl;
  let prisma;

  try {
    const { PrismaClient } = await import('../packages/db/generated/client/index.js');
    prisma = new PrismaClient();
    const models = {};

    for (const definition of MODEL_DEFINITIONS) {
      models[definition.id] = await queryModel(prisma, definition);
    }

    return {
      source: 'raw-db-pii-ciphertext-scan',
      ok: true,
      startedAt,
      completedAt: new Date().toISOString(),
      error: null,
      databaseUrlConfigured: true,
      databaseUrlSource: options.databaseUrlSource || 'DATABASE_URL',
      models,
    };
  } catch (error) {
    return {
      source: 'raw-db-pii-ciphertext-scan',
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      databaseUrlConfigured: true,
      databaseUrlSource: options.databaseUrlSource || 'DATABASE_URL',
      models: {},
    };
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
}

function validateModel(model, definition) {
  const failures = [];

  for (const field of definition.fields) {
    const summary = model.fields?.[field.id];
    if (!summary) {
      failures.push(`${definition.label}.${field.id} count summary is missing.`);
      continue;
    }

    if (summary.plaintext !== 0) {
      failures.push(`${definition.label}.${field.id} has ${summary.plaintext} plaintext row(s).`);
    }

    if (summary.encrypted !== summary.nonNull) {
      failures.push(
        `${definition.label}.${field.id} encrypted count ${summary.encrypted} does not match non-null count ${summary.nonNull}.`,
      );
    }

    if (field.hashColumn) {
      if (summary.hashInvalid !== 0) {
        failures.push(
          `${definition.label}.${field.id} has ${summary.hashInvalid} missing or invalid email hash row(s).`,
        );
      }

      if (summary.hashValid !== summary.nonNull) {
        failures.push(
          `${definition.label}.${field.id} valid hash count ${summary.hashValid} does not match non-null count ${summary.nonNull}.`,
        );
      }
    }
  }

  return failures;
}

function buildArtifact(options, scan) {
  const generatedAt = new Date().toISOString();
  const models = {};
  const totals = {
    piiValues: 0,
    encryptedValues: 0,
    plaintextValues: 0,
    emailRows: 0,
    emailHashInvalidRows: 0,
  };

  for (const definition of MODEL_DEFINITIONS) {
    const model = scan.models?.[definition.id] ?? {
      id: definition.id,
      label: definition.label,
      table: definition.table,
      fields: {},
    };
    const validationFailures = validateModel(model, definition);
    const normalizedModel = {
      id: definition.id,
      label: definition.label,
      table: definition.table,
      fields: model.fields ?? {},
      passed: validationFailures.length === 0,
      validationFailures,
    };
    models[definition.id] = normalizedModel;

    for (const field of Object.values(normalizedModel.fields)) {
      totals.piiValues += field.nonNull ?? 0;
      totals.encryptedValues += field.encrypted ?? 0;
      totals.plaintextValues += field.plaintext ?? 0;
      if (Object.hasOwn(field, 'hashInvalid')) {
        totals.emailRows += field.nonNull ?? 0;
        totals.emailHashInvalidRows += field.hashInvalid ?? 0;
      }
    }
  }

  const artifact = {
    schemaVersion: 1,
    generatedAt,
    runner: 'write-pii-ciphertext-evidence',
    environment: options.deployEnv,
    strict: options.strict,
    database: {
      configured: scan.databaseUrlConfigured === true,
      source: scan.databaseUrlSource ?? null,
      queryMode: 'raw-counts-only',
      rawValuesIncluded: false,
    },
    policy: {
      encryptedPrefix: ENCRYPTED_PREFIX,
      emailHashPattern: EMAIL_HASH_PATTERN,
      requiredModels: options.requiredModels,
      supportedModels: MODEL_DEFINITIONS.map((definition) => definition.id),
    },
    privacy: {
      piiValuesIncluded: false,
      ciphertextSamplesIncluded: false,
      hashesIncluded: false,
      rowIdsIncluded: false,
    },
    command: {
      source: scan.source,
      ok: scan.ok,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt,
      error: scan.error,
    },
    models,
    totals,
    passed: false,
    validationFailures: [],
  };

  artifact.validationFailures = validateArtifact(artifact);
  artifact.passed = artifact.validationFailures.length === 0;

  return artifact;
}

function validateArtifact(artifact) {
  const failures = [];

  if (artifact.command.source !== 'raw-db-pii-ciphertext-scan') {
    failures.push('PII ciphertext evidence must come from raw-db-pii-ciphertext-scan.');
  }

  if (artifact.command.ok !== true) {
    failures.push(`PII ciphertext scan did not complete successfully: ${artifact.command.error}`);
  }

  if (artifact.database.configured !== true) {
    failures.push('Database URL is required for PII ciphertext evidence.');
  }

  if (artifact.privacy.piiValuesIncluded !== false) {
    failures.push('PII ciphertext evidence must not include raw PII values.');
  }

  if (artifact.privacy.ciphertextSamplesIncluded !== false) {
    failures.push('PII ciphertext evidence must not include ciphertext samples.');
  }

  if (artifact.privacy.hashesIncluded !== false) {
    failures.push('PII ciphertext evidence must not include email hashes.');
  }

  for (const definition of MODEL_DEFINITIONS) {
    const model = artifact.models[definition.id];
    if (!model || model.passed !== true) {
      failures.push(
        ...(model?.validationFailures?.length
          ? model.validationFailures
          : [`${definition.label} PII ciphertext proof is missing.`]),
      );
    }
  }

  for (const requiredModel of artifact.policy.requiredModels) {
    if (!MODEL_IDS.has(requiredModel)) {
      failures.push(`Required PII model ${requiredModel} is not supported.`);
      continue;
    }

    const emailRows = artifact.models[requiredModel]?.fields?.email?.nonNull ?? 0;
    if (artifact.strict && emailRows <= 0) {
      failures.push(
        `Strict PII ciphertext evidence requires at least one non-null ${requiredModel}.email row.`,
      );
    }
  }

  if (artifact.strict && artifact.totals.emailRows <= 0) {
    failures.push('Strict PII ciphertext evidence requires at least one encrypted email row.');
  }

  return failures;
}

function resolveOutputPath(root, outputPath) {
  return path.isAbsolute(outputPath) ? outputPath : path.join(root, outputPath);
}

function writeJsonFile(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function runWriter(options, deps = {}) {
  const scan = deps.collectScan ? await deps.collectScan(options) : await collectLiveScan(options);
  const artifact = buildArtifact(options, scan);
  const outputPath = resolveOutputPath(options.root, options.outputPath);
  writeJsonFile(outputPath, artifact);

  return {
    artifact,
    outputPath,
    exitCode: artifact.passed ? 0 : 1,
  };
}

function syntheticModel({
  emailRows = 2,
  phoneRows = 1,
  plaintextEmailRows = 0,
  hashInvalid = 0,
} = {}) {
  return {
    fields: {
      email: {
        nonNull: emailRows,
        encrypted: emailRows - plaintextEmailRows,
        plaintext: plaintextEmailRows,
        hashValid: emailRows - hashInvalid,
        hashInvalid,
      },
      phone: {
        nonNull: phoneRows,
        encrypted: phoneRows,
        plaintext: 0,
      },
    },
  };
}

function syntheticScan(overrides = {}) {
  return {
    source: 'raw-db-pii-ciphertext-scan',
    ok: true,
    startedAt: '2026-06-28T12:00:00.000Z',
    completedAt: '2026-06-28T12:00:01.000Z',
    error: null,
    databaseUrlConfigured: true,
    databaseUrlSource: 'DATABASE_URL',
    models: {
      contact: syntheticModel(),
      lead: syntheticModel(),
      kamConsultant: {
        fields: {
          email: {
            nonNull: 1,
            encrypted: 1,
            plaintext: 0,
            hashValid: 1,
            hashInvalid: 0,
          },
        },
      },
      ...overrides,
    },
  };
}

async function runSelftest() {
  const root = mkdtempSync(path.join(tmpdir(), 'bidstack-pii-ciphertext-'));

  try {
    const baseOptions = {
      root,
      outputPath: DEFAULT_OUTPUT_PATH,
      deployEnv: 'production',
      databaseUrl: 'postgresql://release-db-user:release-db-pass@db.release.internal/bidstack',
      databaseUrlSource: 'DATABASE_URL',
      requiredModels: DEFAULT_REQUIRED_MODELS,
      strict: true,
    };

    const good = await runWriter(baseOptions, { collectScan: () => syntheticScan() });
    assert.equal(good.exitCode, 0);
    assert.equal(good.artifact.passed, true);
    assert.equal(good.artifact.totals.plaintextValues, 0);
    assert.equal(good.artifact.privacy.piiValuesIncluded, false);
    assert.equal(existsSync(good.outputPath), true);

    const serializedGood = JSON.stringify(good.artifact);
    assert.doesNotMatch(serializedGood, /alice|example\.com|555-0100/i);

    const plaintextContact = await runWriter(
      { ...baseOptions, outputPath: 'plaintext-contact.json' },
      {
        collectScan: () =>
          syntheticScan({
            contact: syntheticModel({ plaintextEmailRows: 1 }),
          }),
      },
    );
    assert.equal(plaintextContact.exitCode, 1);
    assert.match(plaintextContact.artifact.validationFailures.join('\n'), /plaintext/);

    const invalidHash = await runWriter(
      { ...baseOptions, outputPath: 'invalid-hash.json' },
      {
        collectScan: () =>
          syntheticScan({
            lead: syntheticModel({ hashInvalid: 1 }),
          }),
      },
    );
    assert.equal(invalidHash.exitCode, 1);
    assert.match(invalidHash.artifact.validationFailures.join('\n'), /invalid email hash/);

    const emptyRequiredModel = await runWriter(
      { ...baseOptions, outputPath: 'empty-kam.json' },
      {
        collectScan: () =>
          syntheticScan({
            kamConsultant: {
              fields: {
                email: {
                  nonNull: 0,
                  encrypted: 0,
                  plaintext: 0,
                  hashValid: 0,
                  hashInvalid: 0,
                },
              },
            },
          }),
      },
    );
    assert.equal(emptyRequiredModel.exitCode, 1);
    assert.match(emptyRequiredModel.artifact.validationFailures.join('\n'), /kamConsultant/);

    const missingDatabase = await runWriter(
      {
        ...baseOptions,
        outputPath: 'missing-database.json',
        databaseUrl: '',
        databaseUrlSource: null,
      },
      {
        collectScan: () => ({
          source: 'raw-db-pii-ciphertext-scan',
          ok: false,
          startedAt: '2026-06-28T12:00:00.000Z',
          completedAt: '2026-06-28T12:00:00.000Z',
          error: 'Database URL is required for PII ciphertext evidence.',
          databaseUrlConfigured: false,
          databaseUrlSource: null,
          models: {},
        }),
      },
    );
    assert.equal(missingDatabase.exitCode, 1);
    assert.match(missingDatabase.artifact.validationFailures.join('\n'), /Database URL/);

    process.stdout.write('[pii-ciphertext-evidence] selftest passed\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.selftest) {
    await runSelftest();
  } else {
    const result = await runWriter(options);
    process.stdout.write(
      `[pii-ciphertext-evidence] wrote ${result.outputPath} passed=${result.artifact.passed} environment=${result.artifact.environment}\n`,
    );
    if (!result.artifact.passed) {
      for (const failure of result.artifact.validationFailures) {
        process.stderr.write(`[pii-ciphertext-evidence] ${failure}\n`);
      }
    }
    process.exit(result.exitCode);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
