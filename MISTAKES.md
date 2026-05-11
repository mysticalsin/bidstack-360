# MISTAKES — BidStack 360°

Per Tony's `mistakes-protocol.md`:

- Read this BEFORE every task
- Log EVERY mistake immediately (root cause, prevention rule, category)
- Never repeat a logged mistake — if a repeat is detected, HALT and escalate
- After completing a non-trivial fix, write a `docs/solutions/` entry for reuse

---

## Format

```
### [TIMESTAMP] CATEGORY: Short description
- **What went wrong:** ...
- **Root cause:** ...
- **Prevention rule:** ...
- **Files affected:** ...
```

Categories: BUG, ARCHITECTURE, SECURITY, PERFORMANCE, UX, TESTING, INFRA, PROCESS.

---

## Ledger

<!-- New entries appended at the top of this section. -->

### 2026-05-11 TOOLING: Prisma generate while API server locked Windows DLL

- **What went wrong:** I ran the root `pnpm typecheck` while the local API dev server was still running, so `prisma generate` failed to rename `query_engine-windows.dll.node`.
- **Root cause:** I forgot the Windows-specific Prisma client file lock before invoking a gate that runs `db:generate`.
- **Prevention rule:** Before any root gate that calls `pnpm db:generate`, stop BIDCRM API/worker Node processes that may have loaded `@bidstack/db`.
- **Files affected:** none; validation order only.

### 2026-05-11 TOOLING: Repeated web typecheck against stale shared dist

- **What went wrong:** I ran `pnpm --filter @bidstack/web typecheck` immediately after adding shared CRM exports, so the web package resolved stale `@bidstack/shared` dist output and reported missing `CrmConnector`/`OpenDataSignal` exports.
- **Root cause:** I remembered the stale-dist issue for full gates but still ran a targeted sibling typecheck before rebuilding shared.
- **Prevention rule:** After any `packages/shared/src/**` contract edit, the very next validation command must be `pnpm --filter @bidstack/shared build` or a root script that performs that build first.
- **Files affected:** none; validation order only.

### 2026-05-11 SHELL: Repeated Bash separator in PowerShell

- **What went wrong:** I ran a PowerShell command containing `&&`, which this shell mode rejects.
- **Root cause:** I bundled a format command and lint command out of habit instead of keeping PowerShell tool calls single-purpose.
- **Prevention rule:** In this workspace, run sequential commands as separate shell tool calls unless using explicit PowerShell control flow.
- **Files affected:** none.

### 2026-05-11 TOOLING: Repeated targeted Prettier unsupported-file mistake

- **What went wrong:** I included `.prettierignore` in another targeted `prettier --write` command, so Prettier formatted the source files but exited nonzero because no parser applies to the ignore file.
- **Root cause:** I used a manual file list after patching the ignore file instead of trusting `pnpm format:check` to validate it.
- **Prevention rule:** Never pass `.prettierignore`, `.gitignore`, Prisma schema, or other tool metadata to targeted Prettier commands unless `--ignore-unknown` is included. Use `pnpm format:check` as the gate for ignore-file changes.
- **Files affected:** none beyond successfully formatted source files.

### 2026-05-11 TOOLING: API tests consumed stale shared dist contracts

- **What went wrong:** The API route schema imported new shared Zod contracts, but `@bidstack/shared` resolves from `dist`, so `pnpm --filter @bidstack/api test` saw stale exports until the shared package was rebuilt.
- **Root cause:** The root `test` script ran workspace tests without first building shared package artifacts consumed by sibling packages.
- **Prevention rule:** Build `@bidstack/shared` before recursive test runs whenever API/MCP/frontend packages import shared contracts from package exports.
- **Files affected:** `package.json`.

### 2026-05-10 BUG: Audit-injected auth abstraction violated Rules of Hooks

- **What went wrong:** `apps/web/src/lib/auth.tsx` from the audit pipeline shipped three `useAuth/useUser/useSignOut` hooks that called Clerk's hooks **after** an early return for stub mode (`if (stub.user?.id === 'stub-user-1') return …; const clerk = useClerkAuth();`). React's hook order is per-component-instance, not per-app — so any component using these hooks could trigger "Rendered fewer hooks than expected" if it ever switched providers, and Clerk's hooks throw at runtime when there's no `<ClerkProvider>` ancestor (stub mode). ESLint's `react-hooks/rules-of-hooks` flagged it correctly.
- **Root cause:** The author assumed the app would only ever be in one mode per session, then used a runtime conditional to skip Clerk's hooks in stub mode. Both assumptions are right _operationally_ but wrong _for React_. Hooks are unconditional contracts.
- **Prevention rule:** When integrating an SDK whose hooks throw without their provider, never call those hooks conditionally. Instead: gate the _provider tree_ (mount one of two non-overlapping subtrees in `AuthProvider`) and have each subtree expose the same shared `Context`. Consumers always read the shared context — same hooks, same order, every render. The `ClerkAuthBridge` pattern.
- **Files affected:** `apps/web/src/lib/auth.tsx` (refactored).

### 2026-05-10 BUG: Audit used `require()` in a Vite ESM module

- **What went wrong:** `apps/web/src/App.tsx` had `const { SignIn } = require('@clerk/clerk-react')` to "lazy-load" Clerk's SignIn component. Vite's ESM build doesn't have CommonJS `require` at runtime; it would have failed in the browser. ESLint's `@typescript-eslint/no-require-imports` caught it.
- **Root cause:** Pattern carried over from a Node CJS context. In a Vite project, the lazy-load idiom is `React.lazy(() => import(...))`.
- **Prevention rule:** In Vite/ESM apps, `require()` is always wrong. The lint rule already enforces this — keep `@typescript-eslint/no-require-imports: error` on. For genuine lazy loading of named exports use `lazy(() => import(pkg).then(m => ({ default: m.Named })))`.
- **Files affected:** `apps/web/src/App.tsx`.

### 2026-05-10 PROCESS: Audit ran in parallel without a contract for which workspace owns lint

- **What went wrong:** A separate audit pipeline modified ~13 files between my commits, partially applying a 10-phase remediation. Some changes left the workspace in a half-broken state (typecheck fails, tests fail) and contradicted earlier work (Industry enum widening invalidated my fixture-guard test for industry; CI workflow rewritten without the bundle-size guard or 3-job split).
- **Root cause:** No coordination protocol between the audit pipeline and the active session — both wrote to the same tree without locking or branching.
- **Prevention rule:** When two automation pipelines could run in parallel, they MUST work on separate branches (or worktrees) and converge via PR. Never let a long-running audit write directly into the same branch a session is editing. If it happens anyway: pause, run `pnpm -r typecheck && pnpm -r lint && pnpm -r test`, and adopt-or-revert per file before continuing.
- **Files affected:** ~13 audit-modified files across `apps/`, `packages/`, `handoff/`.

### 2026-05-10 TESTING: Industry Zod enum was narrower than seed data

- **What went wrong:** Integration test `POST /opportunities` returned 500 because the `Industry` Zod enum was missing `insurance` (MAPFRE seed) and `transportation` (Logistec seed). The seed wrote those rows directly via Prisma, but the API rejected anything containing the same values on read serialization.
- **Root cause:** I built the Zod schema and the SQL seed in separate sittings and never reconciled them. Closed enums lie in two places and drift if the source of truth isn't enforced.
- **Prevention rule:** When extending a closed enum that constrains an external boundary (HTTP/GraphQL/MCP input), grep every fixture, seed, and migration for literal values of that enum and add a parse-the-fixtures unit test so the build fails on drift. Treat the enum and the seed as one change.
- **Files affected:** `packages/shared/src/schemas/opportunity.ts`, `packages/db/src/seed.ts`, `apps/api/src/routes/opportunities.integration.test.ts`.

### 2026-05-10 PROCESS: Master prompt assumed React 19 + Twenty fork as base

- **What went wrong:** Initial framing assumed Twenty CRM uses React 19 and has a stable `ApplicationRegistration` marketplace contract; both turned out to be wrong (React 18.2.39, marketplace WIP, registry path 404).
- **Root cause:** Trusted prose specs without verifying against upstream code.
- **Prevention rule:** Before committing to a fork/extension architecture, spawn an Explore agent to verify the actual upstream tech stack and extension-point contracts. Treat any prose claim about an upstream's internals as a hypothesis until grepped.
- **Files affected:** SPEC.md (architecture decision documented as standalone-first, Twenty overlay preserved for future).
