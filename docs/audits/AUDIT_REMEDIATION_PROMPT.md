# BidStack 360° — Full Remediation Prompt

> **Generated from comprehensive audit on 2026-05-10**
> **Goal:** Fix all audit findings and bring the codebase to production-ready v0.2.
> **Quality Gates:** `pnpm -r typecheck` clean, `pnpm -r test` all green, `pnpm -r lint` clean, Playwright E2E passes, `pnpm audit` zero high/critical.

---

## Phase 1: Security Hardening (CRITICAL — Before Any External Access)

### P1.1 Implement Production Authentication (API + Frontend)

**Severity:** Critical | **Files:** `apps/api/src/plugins/auth.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/layout/Topbar.tsx`

**Tasks:**

1. Install `@clerk/fastify` in `apps/api`.
2. Rewrite `auth.ts` to verify Clerk JWT when `CLERK_SECRET_KEY` is set:
   - Use `ClerkExpressRequireAuth` equivalent or verify JWT via `clerkClient.verifyToken()`.
   - Extract `orgId` from the JWT's `org_id` claim.
   - Extract `userId` from `sub` claim.
   - Set `req.auth = { orgId, userId, scopes: ['read', 'write'] }`.
3. Add `NODE_ENV === 'development'` guard around stub auth. If `NODE_ENV !== 'development'` and `CLERK_SECRET_KEY` is missing, throw `serviceUnavailable` with clear message.
4. In `apps/web`, install `@clerk/clerk-react`.
5. Wrap the app in `<ClerkProvider>` with `publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}`.
6. Add a login route (`/login`) that renders `<SignIn routing="path" path="/login" />`.
7. Add a `RequireAuth` component that:
   - Shows loading spinner while Clerk session loads.
   - Redirects to `/login` if unauthenticated.
   - Renders children if authenticated.
8. Wrap all protected routes in `<RequireAuth>`.
9. Replace hardcoded "Jane Smith" in `Topbar.tsx` with `useUser()` from Clerk.
10. Add logout button that calls `Clerk.signOut()`.
11. Update `.env.example` with Clerk instructions. Ensure `VITE_CLERK_PUBLISHABLE_KEY` is documented as required.

**Acceptance:**

- `pnpm dev:api` with `CLERK_SECRET_KEY` set verifies real JWTs (test with a Clerk test token).
- `pnpm dev:api` without `CLERK_SECRET_KEY` and `NODE_ENV=development` still uses stub.
- `pnpm dev:api` without `CLERK_SECRET_KEY` and `NODE_ENV=production` refuses to start.
- Frontend shows Clerk login screen at `/login` when unauthenticated.
- Authenticated user's name appears in Topbar.
- `pnpm -r test` still passes (update auth tests to mock Clerk if needed).

---

### P1.2 Secure Docker Compose Defaults

**Severity:** Critical | **File:** `docker-compose.yml`

**Tasks:**

1. Change Postgres credentials to read from `.env`:
   ```yaml
   environment:
     POSTGRES_USER: ${POSTGRES_USER:-bidstack}
     POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
   ```
2. If `POSTGRES_PASSWORD` is not set, the container should fail to start (no fallback default).
3. Add `.env` to `.gitignore` (already done — verify).
4. Update `.env.example` with `POSTGRES_USER=bidstack` and `POSTGRES_PASSWORD=` (blank, requiring fill-in).
5. Add a note in `README.md` that docker-compose requires `.env` to be populated.

**Acceptance:**

- `docker compose up` fails fast with clear error if `POSTGRES_PASSWORD` is missing.
- `docker compose up` succeeds when `.env` has a strong password.

---

### P1.3 Fix Webhook Org Injection

**Severity:** High | **File:** `apps/api/src/routes/webhooks.ts`

**Tasks:**

1. Remove trust in `x-bidstack-org` header.
2. Derive `orgId` from a verified subscription mapping instead:
   - Option A: Include `orgId` in the webhook URL path (`/webhooks/dust/:orgId`) and validate it against `webhook_subscriptions`.
   - Option B: Look up the subscription by `secret` hash and read `orgId` from the subscription row.
3. Ensure the webhook handler still writes `sync_event` with the verified `orgId`.
4. Update any Dust webhook configuration docs to reflect the new URL format.

**Acceptance:**

- Sending a Dust webhook with a spoofed `x-bidstack-org` header targets only the org associated with the verified secret.
- Integration tests cover this (mock webhook with wrong org header should still map to correct org).

---

### P1.4 Restrict `trustProxy` and Enable CSP

**Severity:** High | **Files:** `apps/api/src/server.ts`, `apps/mcp-server/src/server.ts`

**Tasks:**

1. In API server, change `trustProxy: true` to:
   ```ts
   trustProxy: process.env.TRUSTED_PROXIES
     ? process.env.TRUSTED_PROXIES.split(',')
     : false,
   ```
2. Add `TRUSTED_PROXIES` to `.env.example` with comment.
3. In API server, change helmet registration to:
   ```ts
   await server.register(helmet, {
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'self'"],
         scriptSrc: ["'self'"],
         styleSrc: ["'self'", "'unsafe-inline'"], // only if needed for inline styles
         imgSrc: ["'self'", 'data:', 'https:'],
         connectSrc: ["'self'"],
         fontSrc: ["'self'"],
         objectSrc: ["'none'"],
         frameAncestors: ["'none'"],
       },
     },
   });
   ```
4. For MCP server, apply the same `trustProxy` fix.

**Acceptance:**

- API responds with `Content-Security-Policy` header.
- `trustProxy` is `false` unless `TRUSTED_PROXIES` is explicitly set.

---

### P1.5 Fix CORS localhost leak

**Severity:** Medium | **File:** `apps/api/src/server.ts`

**Tasks:**

1. Gate localhost origins to development:
   ```ts
   const allowed = [process.env.PUBLIC_BASE_URL].filter(Boolean);
   if (process.env.NODE_ENV === 'development') {
     allowed.push('http://localhost:5173', 'http://localhost:4173');
   }
   ```

**Acceptance:**

- Production API rejects requests from `localhost:5173`.
- Dev API still accepts them.

---

## Phase 2: Data Integrity & Schema Fixes

### P2.1 Fix Prisma Schema Drift

**Severity:** High | **File:** `packages/db/prisma/schema.prisma`

**Tasks:**

1. Add `@db.Citext()` to `users.email` and `contacts.email`:
   ```prisma
   email String? @unique @db.Citext
   ```
   (Note: `users.email` is `UNIQUE NOT NULL`, `contacts.email` is nullable).
2. Add the GIN trigram index for opportunity search:
   ```prisma
   @@index([orgId, stage], map: "opps_org_stage_idx")
   // Add below it:
   @@index([customer, name, code], map: "opps_search_idx")
   ```
   If Prisma doesn't support GIN/trigram directly, add it via a custom migration SQL:
   ```sql
   CREATE INDEX opps_search_idx ON opportunities USING gin (
     (coalesce(customer,'') || ' ' || coalesce(name,'') || ' ' || coalesce(code,'')) gin_trgm_ops
   );
   ```
3. Review `tasks.status`: the SQL source says `text NOT NULL DEFAULT 'open'`, but Prisma uses an enum. Decide:
   - **Option A (keep enum):** Update `handoff/db.schema.sql` to match Prisma (create enum and alter column). This makes SQL match code.
   - **Option B (revert to text):** Change Prisma schema to `status String @default("open")` to match SQL.
     Document the decision in `docs/ARCHITECTURE.md`.
4. Fix the `Industry` enum causing 500s (see P2.2).
5. Run `pnpm db:generate` after schema changes.
6. Create a new Prisma migration (not `--name init`) for these changes.

**Acceptance:**

- `prisma migrate dev` generates a new migration without errors.
- `pnpm -r typecheck` passes.
- Case-insensitive email uniqueness works (`Jane@Mantu.com` and `jane@mantu.com` collide).
- Opportunity search uses the GIN index (verify with `EXPLAIN ANALYZE`).

---

### P2.2 Fix `Industry` Enum 500 Errors

**Severity:** Critical | **File:** `packages/shared/src/schemas.ts`, `apps/api/src/routes/opportunities.ts`

**Tasks:**

1. Change `Industry` from a strict enum to a `z.string()` in shared schemas, OR widen the enum to include all realistic industries.
2. If keeping the enum, add a runtime fallback in the API serializer:
   ```ts
   industry: (o.industry ?? undefined) as ApiOpportunity['industry'] | undefined,
   ```
   Better: remove the cast entirely and let `industry` be `string | undefined`.
3. Update the `Opportunity` Zod schema in shared to accept `string | null` for `industry`.
4. Update frontend types if they depend on the enum.

**Acceptance:**

- Seeding an opportunity with `industry: "aerospace"` does not cause a 500.
- Existing 16 industries still validate correctly.

---

### P2.3 Map Prisma Errors to HTTP Status Codes

**Severity:** Medium | **File:** `apps/api/src/plugins/error-handler.ts`

**Tasks:**

1. Import `Prisma` from `@prisma/client`.
2. In the error handler, check for `Prisma.PrismaClientKnownRequestError`:
   - `P2002` (unique violation) → `409 Conflict` with message indicating duplicate field.
   - `P2025` (record not found) → `404 Not Found`.
   - `P2003` (foreign key constraint) → `400 Bad Request`.
3. Keep generic `500` for unknown Prisma errors without leaking stack traces.

**Acceptance:**

- Creating an opportunity with duplicate `code` returns `409` instead of `500`.
- Fetching a non-existent opportunity returns `404`.

---

## Phase 3: Worker Reliability

### P3.1 Add Retries, Backoff, and Dead Letter Queue

**Severity:** High | **File:** `apps/worker/src/main.ts`, `apps/worker/src/queues/*.ts`

**Tasks:**

1. Add `defaultJobOptions` to each `Queue`:
   ```ts
   defaultJobOptions: {
     attempts: 3,
     backoff: { type: 'exponential', delay: 5000 },
     removeOnComplete: { count: 100 },
     removeOnFail: { count: 50 },
   }
   ```
2. Create a dead-letter queue:
   ```ts
   const dlq = new Queue('dust-dlq', { connection: redis });
   ```
3. In each `Worker`, add `onFailed` handler to move permanently failed jobs (attempt > 3) to DLQ.
4. Add Zod validation for `job.data` at the start of every processor. Reject malformed jobs immediately (fail fast).

**Acceptance:**

- A job that throws is retried 3 times with exponential backoff.
- After 3 failures, it appears in the DLQ.
- Malformed job data fails immediately with a clear error.

---

### P3.2 Implement Graceful Shutdown

**Severity:** High | **File:** `apps/worker/src/main.ts`

**Tasks:**

1. Track all `Worker` and `Queue` instances in an array.
2. In the `SIGINT`/`SIGTERM` handler:
   ```ts
   await Promise.all(workers.map((w) => w.close()));
   await Promise.all(queues.map((q) => q.close()));
   await connection.quit();
   ```
3. Add a timeout (e.g., 10s) to force-exit if graceful shutdown hangs.

**Acceptance:**

- `Ctrl+C` while a job is active waits for it to finish (or timeout), then exits cleanly.
- No jobs are left in "active" state after shutdown.

---

### P3.3 Add Circuit Breaker for Dust API

**Severity:** Medium | **File:** `apps/worker/src/processors/dust-poll.ts`

**Tasks:**

1. Track consecutive failures in Redis (or in-memory with caution).
2. If Dust API fails 3 times in a row, skip the next N polling intervals (e.g., skip 2 intervals = 10 min cooldown).
3. Log circuit breaker state changes.

**Acceptance:**

- If Dust is down, worker stops hammering it and logs "Circuit open, skipping poll".
- After cooldown, it tries again.

---

## Phase 4: MCP Server Hardening

### P4.1 Add Audit Log to `tasks.create`

**Severity:** High | **File:** `apps/mcp-server/src/tools/tasks.ts`

**Tasks:**

1. After `prisma.task.create()`, add:
   ```ts
   await prisma.auditLog.create({
     data: {
       orgId: ctx.orgId,
       userId: null, // or ctx.userId if available
       action: 'task.create',
       targetType: 'task',
       targetId: task.id,
       diff: { title, status, assigneeId, oppId },
     },
   });
   ```

**Acceptance:**

- Calling `tasks.create` via MCP writes an `audit_log` row.
- Integration test verifies this.

---

### P4.2 Implement 600/Hour Rate Limit

**Severity:** Medium | **File:** `apps/mcp-server/src/server.ts`

**Tasks:**

1. Add a custom rate-limit store or secondary plugin that enforces 600 requests/hour per API key.
2. The existing `@fastify/rate-limit` handles 60/min. Add a second layer.
3. Return `429` with `Retry-After` header on overflow.

**Acceptance:**

- 61 requests in one minute returns 429 (existing).
- 601 requests in one hour returns 429 (new).

---

### P4.3 Remove Dead Dependency

**Severity:** Low | **File:** `apps/mcp-server/package.json`

**Tasks:**

1. Remove `@modelcontextprotocol/sdk` from dependencies if truly unused.
2. Verify `pnpm -r typecheck` still passes.

---

## Phase 5: Frontend Polish & Bug Fixes

### P5.1 Fix Non-Functional UI Elements

**Severity:** Medium | **Files:** `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/components/layout/Topbar.tsx`

**Tasks:**

1. Wire "View all" button on Dashboard to navigate to `/opportunities`.
2. Wire search bar in Topbar:
   - Maintain query state.
   - On submit, navigate to `/opportunities?search=${query}`.
   - Optionally: debounced search suggestions via `/api/opportunities?search=`.
3. Add `disabled` or tooltip to notification bell if not implemented yet.

---

### P5.2 Protect `JSON.parse` in API Client

**Severity:** Medium | **File:** `apps/web/src/lib/api.ts`

**Tasks:**

1. Wrap `JSON.parse(text)` in `try/catch`:
   ```ts
   let json: unknown;
   try {
     json = JSON.parse(text);
   } catch {
     throw new ApiError(res.status, 'Invalid JSON response from server', text);
   }
   ```

---

### P5.3 Fix Accessibility Issues

**Severity:** Low-Medium | **Files:** `apps/web/src/pages/OpportunitiesPage.tsx`, `apps/web/src/pages/ContactsPage.tsx`, etc.

**Tasks:**

1. Add `scope="col"` to all `<th>` elements in tables.
2. Fix breadcrumb in `OpportunityDetailPage` to use `<ol><li>` structure.
3. Update touch target CSS from `32px` to `44px` minimum.
4. Fix `main.tsx` import: `'./App.js'` → `'./App'`.

---

### P5.4 Remove Unused Radix Packages

**Severity:** Medium | **File:** `apps/web/package.json`

**Tasks:**

1. Remove: `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover`, `@radix-ui/react-toast`, `@radix-ui/react-tooltip`.
2. Run `pnpm install`.
3. Verify build still passes.

---

### P5.5 Replace Tailwind v4 Beta with Stable

**Severity:** High | **File:** `apps/web/package.json`

**Tasks:**

1. Downgrade to Tailwind CSS v3 stable:
   ```bash
   pnpm --filter @bidstack/web remove tailwindcss @tailwindcss/vite
   pnpm --filter @bidstack/web add -D tailwindcss@^3 postcss autoprefixer
   ```
2. Create `postcss.config.js` and `tailwind.config.js` for v3.
3. Convert `index.css` from v4 `@theme` syntax to v3 `@tailwind base/components/utilities`.
4. Update any v4-specific utility classes.

**Alternative:** If v4 stable is released by the time you read this, upgrade to stable instead.

---

### P5.6 Add Client-Side Zod Validation to Create Dialog

**Severity:** Medium | **File:** `apps/web/src/components/opportunity/CreateOpportunityDialog.tsx`

**Tasks:**

1. Import `OpportunityCreate` from `@bidstack/shared`.
2. Validate form data with Zod before submit:
   ```ts
   const parse = OpportunityCreate.safeParse(data);
   if (!parse.success) {
     setFieldErrors(parse.error.flatten().fieldErrors);
     return;
   }
   ```
3. Show inline error messages per field.

---

## Phase 6: OpenAPI & Shared Schema Alignment

### P6.1 Fix `OpportunityCreate` in OpenAPI

**Severity:** High | **File:** `handoff/openapi.yaml`

**Tasks:**

1. Change `OpportunityCreate` from `allOf: [Opportunity]` to a standalone schema with only required create fields:
   ```yaml
   OpportunityCreate:
     type: object
     required: [code, customer, name, stage, value, probability]
     properties:
       code: { type: string }
       customer: { type: string }
       name: { type: string }
       stage: { type: string, enum: [...] }
       value: { type: number }
       probability: { type: integer }
       dueDate: { type: string, format: date, nullable: true }
       owner: { type: string, nullable: true }
       industry: { type: string, nullable: true }
       logo: { type: string, nullable: true }
   ```

### P6.2 Add `OpportunityFull` to `@bidstack/shared`

**Severity:** Critical | **File:** `packages/shared/src/schemas.ts`

**Tasks:**

1. Define `OpportunityFull` Zod schema that matches the API serializer output:
   ```ts
   export const OpportunityFull = Opportunity.extend({
     intel: IntelPayload,
     tasks: z.array(Task),
     documents: z.array(Document),
     timeline: z.array(z.object({ ... })),
   });
   ```
2. Update the API route to validate its response against `OpportunityFull`.

### P6.3 Add `DustStatus` to Shared

**Severity:** Medium | **File:** `packages/shared/src/schemas.ts`

**Tasks:**

1. Add `DustStatus` Zod schema matching openapi.yaml.
2. Use it in the API route response validation.

---

## Phase 7: Dust Client & Integration

### P7.1 Fix `runAgent` Payload Shape

**Severity:** High | **File:** `packages/dust-client/src/index.ts`

**Tasks:**

1. Consult Dust API docs for the correct `POST /v1/w/{ws}/assistant/agent_configurations/{id}/runs` payload.
2. Likely fix: send `{ message: { content, role: 'user' } }` or an array of messages.
3. Add runtime validation of the response with Zod.

### P7.2 Implement `getConversation`

**Severity:** High | **File:** `packages/dust-client/src/index.ts`

**Tasks:**

1. Add `async getConversation(workspaceId, conversationId)` method.
2. `GET /v1/w/{workspaceId}/assistant/conversations/{conversationId}`.
3. Parse and validate response with Zod.

### P7.3 Wrap `AbortError` as `DustError`

**Severity:** Medium | **File:** `packages/dust-client/src/index.ts`

**Tasks:**

1. Catch `AbortError` (check `err.name === 'AbortError'`) and throw `new DustError('TIMEOUT', ...)`.

---

## Phase 8: Quality Gates & CI/CD

### P8.1 Fix All No-Op Lint Scripts

**Severity:** High | **Files:** `apps/worker/package.json`, `apps/mcp-server/package.json`, `packages/db/package.json`, `packages/dust-client/package.json`

**Tasks:**

1. Replace `"lint": "echo '... lint TBD'"` with `"lint": "eslint ."` in all packages.
2. Ensure each package extends the root `eslint.config.js` properly (flat config should auto-apply).
3. Fix any lint errors that surface.

### P8.2 Add GitHub Actions CI

**Severity:** High | **File:** `.github/workflows/ci.yml` (new)

**Tasks:**

1. Create workflow triggered on PR and push to `main`.
2. Steps:
   - Checkout
   - Setup Node 24 + pnpm 10
   - `pnpm install`
   - `pnpm audit` (fail on high/critical)
   - `pnpm -r typecheck`
   - `pnpm -r lint`
   - `pnpm -r test`
   - `pnpm -r build`
   - `pnpm --filter @bidstack/web e2e` (requires `docker compose up -d` for Postgres/Redis)
3. Cache `~/.pnpm-store` and `node_modules`.

### P8.3 Add `db:generate` Root Script

**Severity:** Medium | **File:** `package.json`

**Tasks:**

1. Add `"db:generate": "pnpm --filter @bidstack/db generate"`.
2. Document in README that fresh clones need `pnpm db:generate` after install.

### P8.4 Fix DB Migrate Script

**Severity:** High | **File:** `packages/db/package.json`

**Tasks:**

1. Change `"migrate": "prisma migrate dev --name init"` to `"migrate": "prisma migrate dev"`.
2. Developers should pass `--name` manually, or use a prompt wrapper.

---

## Phase 9: Testing Expansion

### P9.1 Add MCP Server Unit Tests

**Severity:** High | **File:** `apps/mcp-server/src/**/*.test.ts` (new)

**Tasks:**

1. Test auth: valid key, revoked key, missing `mcp` scope, malformed header.
2. Test rate limiting: 61st request returns 429.
3. Test each tool handler with mocked Prisma.
4. Test JSON-RPC dispatch: valid request, unknown method, invalid params.

### P9.2 Add Worker Unit/Integration Tests

**Severity:** High | **File:** `apps/worker/src/**/*.test.ts` (new)

**Tasks:**

1. Test dust-poll processor with mocked `dust-client`.
2. Test webhook processor with mocked `prisma`.
3. Test graceful shutdown.
4. Test circuit breaker behavior.

### P9.3 Add Frontend Component Tests

**Severity:** Medium | **File:** `apps/web/src/**/*.test.tsx` (new)

**Tasks:**

1. Test `CreateOpportunityDialog` form validation and submission.
2. Test `CommandPalette` keyboard navigation.
3. Test `PipelinePage` drag-and-drop and keyboard stage moves.
4. Test dark mode toggle persistence.

---

## Phase 10: Performance & Production Readiness

### P10.1 Compute `avgDaysOpen` from Database

**Severity:** Medium | **File:** `apps/api/src/routes/reports.ts`

**Tasks:**

1. Replace hardcoded `42` with actual average:
   ```ts
   const avgDaysOpen =
     opportunities.length > 0
       ? Math.round(
           opportunities.reduce((sum, o) => sum + differenceInDays(now, o.createdAt), 0) /
             opportunities.length,
         )
       : 0;
   ```

### P10.2 Disable Source Maps in Production

**Severity:** Medium | **File:** `apps/web/vite.config.ts`

**Tasks:**

1. Change `build.sourcemap` to:
   ```ts
   sourcemap: process.env.NODE_ENV === 'development',
   ```

### P10.3 Add Bundle Analyzer Script

**Severity:** Low | **File:** `apps/web/package.json`

**Tasks:**

1. Add `rollup-plugin-visualizer` as dev dependency.
2. Add `"analyze": "vite build --mode analyze"` script.

---

## Next Steps (Beyond Remediation)

Once all phases above are complete and quality gates pass, proceed with:

1. **Sprint 18: Real Dust Integration**
   - Wire live `DUST_API_KEY` in staging.
   - Verify outbound pull (poll) creates/updates opportunities.
   - Verify outbound push (on opp write) upserts Dust documents.
   - Verify inbound webhook (Dust → BidStack) updates opportunity intel.

2. **Sprint 19: Real Clerk Production Setup**
   - Configure Clerk organizations and roles.
   - Add org-scoped user invitation flow.
   - Test multi-org isolation end-to-end.

3. **Sprint 20: Observability**
   - Wire Sentry DSN for error tracking.
   - Add OpenTelemetry traces for API → DB → Dust calls.
   - Structured logging correlation IDs across requests.

4. **Sprint 21: Advanced Frontend**
   - Mobile viewport E2E tests (iPhone, iPad).
   - Lighthouse CI with thresholds (perf ≥ 90, a11y ≥ 95).
   - Visual regression testing with Playwright.

5. **Sprint 22: Production Deployment Prep**
   - Dockerfile for API, MCP, worker, web.
   - Kubernetes manifests or Docker Compose production variant.
   - Terraform / infra-as-code for Postgres, Redis, load balancer.
   - SSL/TLS termination, HSTS, WAF rules.

---

## Universal Rules for This Work

1. **Make minimal changes.** Fix only what's listed. Don't refactor adjacent code.
2. **Match existing style.** Follow the patterns already in the file.
3. **Update tests.** Every behavioral change needs a test update or new test.
4. **Update docs.** If you change architecture, update `docs/ARCHITECTURE.md` and `README.md`.
5. **Log to MISTAKES.md.** If you find a bug that was preventable, add it with prevention rule.
6. **Checkpoint after each phase.** Use the format:
   ```
   ✅ Done: <what's verified>
   🔄 Now: <what's running>
   ⏭️  Next: <what's queued>
   ⚠️  Surfaced: <conflicts, deferred work, or "none">
   ```
7. **Never commit secrets.** If `.env` changes, ensure it's gitignored.
8. **Run gates before declaring done:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`, `pnpm e2e`.
