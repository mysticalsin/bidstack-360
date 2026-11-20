# Factory 0: Prior art and decisions

Date: 2026-11-06. Baseline: `main` at `ad2d0839`. Companion to `docs/factory/RECON.md`.

Scope: webhooks (Svix, Hookdeck, Standard Webhooks), authorization (Cerbos, OPA, Casbin, in-repo
`rbac-matrix`), the job queue (BullMQ today), and UI components (TUFFUI). Each section ends with a
decision and the reason. Repo stats were read from GitHub on 2026-11-06.

| Project | Stars | License | Latest seen | Shape |
|---|---|---|---|---|
| svix/svix-webhooks | 3,475 | MIT | server-v1.104.0 | Rust server + SDKs, Postgres + Redis |
| hookdeck/outpost | 1,077 | Apache-2.0 | v1.7.0 | Go outbound delivery service |
| frain-dev/convoy | 2,888 | not OSI (no SPDX asserted) | n/a | Go gateway, Postgres + Redis |
| standard-webhooks/standard-webhooks | 1,793 | Apache-2.0 | spec + libs | Signing spec, TS/JS lib |
| cerbos/cerbos | 4,647 | Apache-2.0 | v0.57.0 | Policy decision point, YAML policies |
| open-policy-agent/opa | 12,442 | Apache-2.0 | n/a | Policy decision point, Rego |
| casbin/node-casbin | 2,922 | Apache-2.0 | n/a | In-process lib, PERM model files |
| taskforcesh/bullmq | 9,575 | MIT | 5.x (in repo) | Redis queue, already used |

## 1. Webhooks

### What Polo has today (details in RECON)

- `WebhookSubscription` and `WebhookDelivery` in `packages/db/prisma/schema.prisma` (lines 777, 805).
  Deliveries store status, code, attempt and error, but no payload, request headers or response body,
  so a delivery cannot be inspected or replayed byte for byte.
- Worker `apps/worker/src/queues/webhook-delivery.ts`: HMAC over `t.body`, header
  `X-Polo-Signature: t=<unix>,v1=<hex>` plus legacy `X-BidStack-Signature`, 10s timeout, concurrency 20,
  auto-disable after 10 consecutive failures. Retries come from
  `packages/shared/src/queue-config.integrations.ts` (`attempts: 5`, exponential from 30s). The file
  header comment describes a different schedule and is wrong. No `Retry-After` handling; 4xx responses
  are retried like 5xx.
- Two producers: the worker `fanOutWebhookEvent` stamps a stable event id;
  `apps/api/src/queues/webhook-delivery.ts` is fail-open and sends none, so receivers cannot dedupe.

### Svix

Patterns worth copying: a stored message separate from per-endpoint attempts; replay of one message or
"recover all failed since T"; disable after a failure window; an event type catalogue with schemas;
secret rotation with an overlap window (several `v1,` signatures in one header); a portal showing
attempts, response code, latency and body. Running the Svix server means a Rust service with its own
Postgres and Redis, a second tenancy model and a second audit trail. That is a large operational add
for a feature that already works.

### Hookdeck (Outpost) and Convoy

Outpost: at-least-once delivery, an idempotency key per event, a dead-letter view with manual retry,
tenant-scoped destinations, topic filters. Convoy adds a circuit breaker per endpoint, a retry policy per
endpoint (linear or exponential) and stores request and response. Convoy's license is not OSI, so ideas
only, no code.

### Standard Webhooks

Headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 of id.timestamp.body>`,
secrets prefixed `whsec_`. Receivers reject timestamps outside a tolerance (5 minutes typical) and dedupe
on `webhook-id`. Svix libraries and many receivers verify this format out of the box.

### Decision

**Build in-repo on BullMQ, follow Svix and Hookdeck patterns, and add Standard Webhooks headers
alongside the current ones. Do not run a Svix, Outpost or Convoy server.**

Why: tenancy, RBAC, audit and encryption already live in Fastify and Prisma; a sidecar would duplicate
all four. The gaps are data model and retry policy, not transport. For the slice work:

1. One producer path that always stamps an event id (route the API producer through the worker helper).
2. Store a message row (payload, event type, event id) and per-attempt rows with request headers,
   response code, a capped response body and latency. Retention follows queue config (7d / 30d).
3. Send `webhook-id`, `webhook-timestamp`, `webhook-signature` in addition to `X-Polo-Signature` and the
   legacy header. Existing secrets keep working; new secrets may use `whsec_`. Rotation signs with both
   secrets during an overlap window.
4. Retry policy: honour `Retry-After`; do not retry 400, 401, 403, 404, 410, 422 (mark failed, count
   toward disable); retry 408, 429, 5xx and network errors. Schedule per endpoint, current 5 attempts as
   default. Fix the misleading comment.
5. Dead-letter view plus replay (single, and bulk "since T"), audited and permission-gated.
6. Transactional outbox for events raised inside DB writes, so a rollback never sends a webhook.

## 2. Authorization

### What Polo has today

`packages/shared/src/types/rbac-matrix.ts` (6 system roles) and `permissions.ts` (66 keys), seeded into
`Role`, `Permission`, `RolePermission`, `UserRole`. `apps/api/src/plugins/rbac.ts` enforces
`requirePermission` at about 339 call sites over about 632 routes, with a bounded decision cache.
Tenant isolation is app-layer (`tenant-scope-guard.ts`); no Postgres RLS.

| Option | Fit | Cost |
|---|---|---|
| Cerbos | Resource policies, derived roles, CEL conditions, policy tests, decision audit log. | Sidecar or WASM bundle; YAML policies outside Prisma; a network hop per check unless batched; a second source of role truth. |
| OPA | Most general; Rego is powerful. | Rego learning cost; CRM-record ABAC modelled by hand; sidecar or WASM. |
| Casbin | In-process Node lib; RBAC with domains (tenants), ABAC matchers. | Terse model files easy to get wrong; community Prisma adapter; little gain over the matrix for RBAC. |
| Keep matrix + in-repo policy layer | No migration of 339 call sites; types shared with web; cache exists. | Conditions, simulation and versioning are ours to build. |

### Decision

**Keep the `rbac-matrix` and add a small in-repo policy layer. Do not adopt Cerbos, OPA or Casbin now.**

Why: the RBAC core is sound and typed end to end. The access-policy screens (When / Then / Except rules,
impact preview, publish a version) need a thin layer: `Policy` and `PolicyVersion` tables; a pure
evaluator in `packages/shared` taking (actor, permission, resource attributes) and returning allow or
deny plus the matching rule; a simulation endpoint that runs the evaluator over a sample of users and
records; publish writes an `AuditLog` row. `requirePermission` stays the entry point and consults the
evaluator after the matrix check. Rules use Cerbos-like shapes (resource, actions, effect, condition) so a
later move stays mechanical. Revisit if policies must be shared with non-Node services.

## 3. Queue

BullMQ 5 on ioredis runs the worker (webhooks, integrations, AI jobs) with config in
`packages/shared/src/queue-config*.ts`. Considered: pg-boss or Graphile Worker (Postgres only,
transactional enqueue, lower throughput), Temporal or Inngest (durable workflows, new infra). None
removes a real pain today.

**Decision: keep BullMQ.** Add the outbox (section 1, item 6), a dead-letter queue per critical job
family, and job metrics on the existing health surface. Revisit Temporal only if agent workflows need
durable timers spanning days.

## 4. UI components (TUFFUI)

Source is public: https://github.com/yurigdesigner/tuffui (MIT, "Copyright (c) 2026 TUFFUI
contributors"), pinned commit `378f3eaac693c693d2ec845baf38bf6c0488cb37`; site https://tuffui.com.
Components live at `registry/<name>/<name>.tsx`.

**Decision: vendor, not a dependency.** Copy needed files into `apps/web/src/components/vendor/tuffui/`
with the full LICENSE file, keep each file header, rewrite classes to repo tokens at import, and swap
Phosphor icons for Lucide. Mapping and rules are in root `DESIGN.md` v3.0.0.
