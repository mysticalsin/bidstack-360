# Worker Vitest wrapper on Windows

**Problem:** Worker tests passed when run directly from the repo root, but `pnpm test` failed at the worker preflight with no useful assertion output.

**Diagnosis:** The helper script could be launched from root or from `apps/worker`. Deriving paths from the script URL produced a brittle Windows lifecycle path for the Vitest child process. Discovering the workspace root from the current cwd and the `pnpm-workspace.yaml` marker made root and package invocations behave the same.

**Fix:** Update `scripts/run-worker-tests.mjs` to walk upward from `process.cwd()` until it finds `pnpm-workspace.yaml`, then launch the worker-local Vitest entry with `cwd` set to `apps/worker`.

**Why it works:** The script now uses the same workspace-root contract that pnpm users think in, rather than depending on how Node resolved the helper file path in a package lifecycle.

## 2026-06-06 Update

`extract-text-sandbox.test.ts` creates real `worker_threads.Worker` instances
and exercises pdf-parse inside them. Running the worker suite inside Vitest's
thread pool can crash Node on Windows after the sandbox tests finish
(`3221225477`) even when all assertions pass. The root worker wrapper therefore
uses `--pool=forks`: the sandbox still validates worker-thread behavior, while
Vitest itself isolates files in child processes instead of nested worker
threads.

The sandbox worker must also clean up parser resources before posting a normal
result. `pdf-parse@2.x` exposes `PDFParse.destroy()`. Call it in a `finally`
block and let the worker exit naturally after a successful message; reserve
`worker.terminate()` for timeout/crash paths.

If pdf-parse still destabilizes `worker_threads` on Windows, route PDFs through
a child-process sandbox. The process boundary preserves the same timeout/heap
cap guarantees while preventing a native parser crash from taking down Vitest or
the BullMQ worker process.

**Prevention:** For repo helper scripts called by package scripts, prefer workspace-marker discovery over assumptions about launch cwd or script URL shape.
