// Test-only env loader. Vitest suites may read *connection* settings from the
// repo-root .env files (so integration tests can reach Postgres/Redis), but
// never feature flags or policy knobs: those made suites pass or fail
// depending on what a developer happened to put in .env. Values already set in
// process.env always win. Guarded by scripts/verify-test-hermeticity.mjs.
// dotenv-flow is passed in by each package's vitest config (it is a
// per-package devDependency, not hoisted to the repo root).

export const TEST_ENV_ALLOWLIST = Object.freeze([
  'DATABASE_URL',
  'SHADOW_DATABASE_URL',
  'DATABASE_URL_REPLICA',
  'REDIS_URL',
  'REDIS_PASSWORD',
]);

export function loadTestEnv(dotenvFlow, rootDir, { allowlist = TEST_ENV_ALLOWLIST, env = process.env } = {}) {
  let files = [];
  try {
    files = dotenvFlow.listFiles({ path: rootDir, node_env: 'test' });
  } catch {
    return {};
  }
  if (files.length === 0) return {};
  const parsed = dotenvFlow.parse(files);
  const applied = {};
  for (const key of allowlist) {
    if (env[key] === undefined && parsed[key] !== undefined && parsed[key] !== '') {
      env[key] = parsed[key];
      applied[key] = true;
    }
  }
  return applied;
}
