# Bugbot review rules for Polo (bidstack-360)

Flag a violation of any rule below as a bug, with the file and line. Severity
in brackets is the minimum to report.

## Tenancy [high]

- Every Prisma query on org-owned data is scoped by `orgId` from `req.auth`
  (or the job payload in the worker). `findUnique({ where: { id } })` on an
  org-owned model is a cross-tenant read; use `findFirst({ where: { id, orgId } })`.
- `updateMany` / `deleteMany` / raw SQL must carry `orgId` in the predicate.
- A record id from another org must answer 404, never 403 or the record.
- Caches, Redis keys, BullMQ job ids and storage keys include the org id.

## Authorization [high]

- Every non-public route declares `config: { permission: '<resource>:<action>' }`
  (enforced by the global `rbac:declared` preHandler in
  `apps/api/src/plugins/rbac.ts`) or an explicit `requirePermission` /
  `requireRole` / `requireHumanActor` preHandler. A route with neither is a bug.
- A route marked `config: { public: true }` must not read `req.auth` or touch
  org data without its own token check.
- Writes need a `:write` permission so read-only API keys are refused
  (`req.auth.readOnly`). Code that authorises API keys outside the RBAC plugin
  (MCP tools, custom guards) must apply the same read-only grant
  (`assertToolGrant` in `apps/mcp-server/src/lib/tool-call.ts`).
- API key company scope (`getAccessScope` / `applyCompanyScope`) applies on
  every read and write a key can reach.
- New routes update the route authorization census allowlist and route
  inventory baseline in the same PR, with a reason.

## Outreach stays drafts only [high]

- Polo never sends email, LinkedIn or Teams messages on a user's behalf.
  Outreach code creates drafts; the human sends. Flag any new call that sends
  from a user's mailbox or account, any send scope added to OAuth requests,
  and any auto-send triggered by a job, workflow or agent.
- System transactional mail the recipient asked for (booking confirmation,
  survey link) goes through the transactional sender, never a user mailbox,
  and a failure must be visible (error log plus in-app notification), not
  swallowed.

## Account intel uses public sources only [high]

- Intel and enrichment read public company sources only. Flag code that
  fetches or stores personal contact details (emails, phone numbers) of
  people, looks people up by name, or scrapes LinkedIn.

## Secrets [high]

- No keys, tokens, passwords or connection strings in code, tests, fixtures,
  docs or `.env.example` values. Reference environment variables by name only.
- Never log tokens, auth headers or decrypted credentials; never put raw OAuth
  tokens in BullMQ payloads.

## Outbound fetch [high]

- Any fetch to a URL that a user, tenant or third party can influence goes
  through `assertPublicHttpUrl` / `isPublicHostname` (`@bidstack/shared`
  `utils/ssrf.ts`) or a host allowlist (`assertAllowedSourceUrl`,
  `guardedGet`), with a timeout and a response size cap. Redirects must be
  re-checked.

## Money [medium]

- Amounts are stored as integer micros (`BigInt`, value x 1e6). Flag floats,
  `Decimal` money columns added for amounts, or arithmetic on formatted
  strings. Format only at the edge.

## Queues and concurrency [high]

- BullMQ jobs are idempotent on redelivery: claim the row with a conditional
  update and check the returned count; a final write that matches 0 rows must
  not log success.
- Deterministic `jobId` for jobs that must run once; BullMQ job ids must not
  contain a colon.
- "Start" operations that must run once per org or per record (imports,
  syncs, exports) use an atomic guard: `pg_advisory_xact_lock`, a unique
  (partial) index with insert-first claim, or a conditional update. A
  check-then-act across two queries is a race.
- Sweepers and reapers judge liveness by a heartbeat, not by start time.

## Tests and visual baselines [medium]

- Playwright screenshot baselines are Linux only (`*-linux.png`). Flag any new
  or modified `*-darwin.png` / `*-win32.png`.
- Bug fixes come with a test that fails without the fix.

## UI copy [low]

- No em dashes in user-facing copy (JSX text, locale JSON, toasts, emails).
- Keep safety and consent copy; flag its removal unless a test pins the
  replacement.
