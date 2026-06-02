# Worker Vitest wrapper on Windows

**Problem:** Worker tests passed when run directly from the repo root, but `pnpm test` failed at the worker preflight with no useful assertion output.

**Diagnosis:** The helper script could be launched from root or from `apps/worker`. Deriving paths from the script URL produced a brittle Windows lifecycle path for the Vitest child process. Discovering the workspace root from the current cwd and the `pnpm-workspace.yaml` marker made root and package invocations behave the same.

**Fix:** Update `scripts/run-worker-tests.mjs` to walk upward from `process.cwd()` until it finds `pnpm-workspace.yaml`, then launch the worker-local Vitest entry with `cwd` set to `apps/worker`.

**Why it works:** The script now uses the same workspace-root contract that pnpm users think in, rather than depending on how Node resolved the helper file path in a package lifecycle.

**Prevention:** For repo helper scripts called by package scripts, prefer workspace-marker discovery over assumptions about launch cwd or script URL shape.
