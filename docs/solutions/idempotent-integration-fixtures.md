# Idempotent Integration Fixtures

**Problem:** Integration tests that insert fixed unique values fail on the second run when prior rows survive cleanup or a previous run exits before teardown.

**Diagnosis:** `apps/mcp-server/src/tools/tools.test.ts` created `OP-9999` for a stable test org without clearing existing rows before setup. The database correctly rejected the duplicate `(org_id, code)`.

**Fix:** Clear rows for the test org in `beforeAll` before creating fixtures, and keep teardown as a best-effort cleanup. This makes the setup phase deterministic even after interrupted runs.

**Why it works:** Integration tests should own their fixture namespace. Cleaning the namespace before seeding makes test success independent of previous process state.

**Prevention:** Any test using a fixed unique value must either upsert by that unique key or delete the test namespace before insert.
