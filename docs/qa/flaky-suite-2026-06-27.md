# Flaky api test suite — cross-file state leakage (2026-06-27)

**Status:** Real CI-reliability gap. NOT product breakage — every offending test passes in isolation; the features are correct. Different tests fail on different full-suite runs.

## Evidence
Three separate full `pnpm --filter @bidstack/api test` runs this session each failed on a DIFFERENT test, each of which passes when run alone or in a small subset:
- run A → `src/evals/llm-judge.test.ts` (passes 6/6 alone)
- run B → `src/routes/webhook-subscriptions.integration.test.ts > rejects plaintext secret in production` (passes in the webhook+dust subset)
- earlier → `src/plugins/rbac.test.ts` (2 API-key gate tests; passes alone)

The api vitest config runs files serially (`fileParallelism: false`), so global mutations in one file leak into later files in the same worker.

## Root causes (per offender)
1. **llm-judge** — `vi.stubGlobal('fetch', …)` was undone only by `vi.restoreAllMocks()`, which does NOT unstub globals. The mocked `fetch` leaked downstream. **FIXED** (`f08a9ed1`): added `vi.unstubAllGlobals()` in `afterEach`.
2. **webhook plaintext-secret-in-production** — the test mutates `process.env.NODE_ENV='production'` + `BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK='false'` and restores in a `finally`. Suspected residual: a module-level cache of the prod/plaintext-fallback decision in `decryptSecretOrPlaintext` (or a config read) that another test's call populates, so this test's call returns a stale "allow" → no rejection → fail. NOT yet fixed — needs to confirm the cache + make the read live or reset it per test (prefer `vi.stubEnv` + `vi.unstubAllEnvs()`).
3. **rbac API-key gates** — passes alone; suspect leaked `process.env`/global state from a prior file. NOT yet root-caused.

## Fix plan (dedicated session — do methodically, do NOT rush)
1. Sweep every api test for global mutations without paired cleanup: `process.env.X=` (→ `vi.stubEnv` + `afterEach(vi.unstubAllEnvs)`), `vi.stubGlobal` (→ `vi.unstubAllGlobals`), `vi.setSystemTime` (→ `vi.useRealTimers`), and any module-level singleton/cache touched in tests.
2. Audit modules that CACHE an env-derived decision at first call (config, secret-fallback, feature flags) — these defeat per-test env overrides. Make the decision read live in test, or expose a reset.
3. Add an `afterEach` global-hygiene helper (unstub envs+globals+timers, restore mocks) shared across the suite.
4. Re-run the full api suite ~10× to confirm zero flakes before claiming reliable-green.

## Interim
- Product is verified correct (each test green in isolation; all non-flaky tests green; typecheck + prod build green).
- Until the hermeticity pass lands, CI should treat a single full-suite failure as suspect-flaky: re-run the named file in isolation to distinguish a real regression from a leak.

## Update — scope of the shared-org hermeticity work (deferred)
- The full api suite passed GREEN after the llm-judge fetch-leak fix (the one high-blast-radius global leak). Residual flakiness is intermittent shared-DB pollution.
- **39 api test files** resolve the shared `org_seed_mantu` (grep `clerkOrg: 'org_seed_mantu'`). Only 6 are migrated to `createIsolatedOrg`. Migrating the rest is the durable fix BUT is non-trivial: `seedOrgData` (the isolated seed) is smaller/different-shaped than the legacy big seed, so count/shape assertions break on a naive swap (seen on accounts/leads/opportunities — reverted).
- **High-leverage path:** enrich `seedOrgData` to match the legacy seed's shape (>=8 companies/contacts/opps, etc.) so all 39 can migrate cleanly in one pass. Caveat: `seedOrgData` is also the production demo-org seed (demo-auth.ts) — enriching changes the demo dataset; do it deliberately.
- **Status:** deferred to a dedicated session (large + needs the seed-shape decision). The suite is green; treat single full-suite failures as suspect-flaky (re-run the named file alone) until this lands.
