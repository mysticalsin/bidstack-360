# Presence avatars (A3) — two competing presence stacks existed; picked one

## Problem

Task A3 asked to "render the presence that is already built." Investigation found
**two independent, unwired presence systems** already shipped server-side, not one:

1. **DB-backed** — `UserPresence` Prisma model, `GET/POST /api/presence`
   (`apps/api/src/routes/collaboration.ts`), filtered by `recordType`/`recordId`.
   Pure REST, no TTL, real `userName` via a Prisma join. Unconsumed by any
   frontend code before this task — A3 is its first consumer.
2. **Redis/WS-backed** — `presence.service.ts` + `plugins/realtime.ts`, keyed
   `presence:org:<orgId>:user:<userId>`, 30s TTL, pushed over `/api/realtime`
   WebSocket (`presence:org:<orgId>` channel) plus a `GET /presence/org` /
   `GET /presence/entity/:type/:id` polling fallback registered in
   `apps/api/src/routes/realtime.ts`. **Not fully dead**: the org-scoped route
   (`GET /presence/org`) IS consumed in production — `useOrgPresence()` in
   `apps/web/src/hooks/useUsers.ts` polls it every 30s to drive the online/
   offline dot on the Team settings page (`TeamSection.tsx`). Only the
   entity-scoped route (`GET /presence/entity/:type/:id`) is unconsumed
   (grepped clean across `apps/web/src`).

## Why the DB-backed system won

- The WS system's `upsertPresence()` call sites in `plugins/realtime.ts` hardcode
  `name: ''` — every presence entry has an empty name server-side. Not a wiring
  gap, a stub that was never finished.
- `GET /presence/entity/:type/:id`'s response zod schema
  (`apps/api/src/routes/realtime.ts`) declares `{ userId, presence: unknown }`,
  but the service returns flat `PresenceEntry` fields (`orgId`, `name`,
  `avatarUrl`, `currentEntityType`, `currentEntityId`, `sessionId`,
  `lastSeenAt`). None of those keys match the schema, so every field except
  `userId` is silently stripped on the wire.
- The WS auth story is questionable for the Clerk-production path: browser
  `WebSocket` cannot set an `Authorization` header on the Upgrade request, and
  `apps/api/src/plugins/auth.ts`'s `verifyClerkAuth` only reads
  `req.headers.authorization` (no cookie fallback). `useYjsField.ts` papers over
  the same gap with a `window.__apiTokenProvider` bridge that is **never set
  anywhere in the codebase** — dead code that happens not to matter in dev/test
  because stub auth doesn't check tokens at all.
- `useOrgPresence()` already proves the WS/Redis org-scoped route works
  end-to-end in production (Team settings online dot), but only because it
  reads solely `userId` off the response — the response-schema bug above
  silently drops every other field. This entity-level presence UI needs a
  real `userName` per viewer for its tooltips, which the DB-backed route
  already resolves via a Prisma join and the WS route's live schema bug would
  strip. That's why A3 follows the DB-backed contract instead of fixing the
  WS route's schema bug as a prerequisite.

## What A3 built

`apps/web/src/hooks/usePresence.ts` — join (`POST /api/presence` with
`currentRecordType`/`currentRecordId`) + 15s heartbeat + leave-on-unmount
(`POST` with those fields omitted, which the route resolves to `null` — stays
"online" app-wide, just detaches from the record) + client-side staleness
filter (`dataUpdatedAt`-based, not `Date.now()` — the latter trips
`react-hooks/purity` inside a `useMemo`) for tabs that crash without sending
the leave call.

`apps/web/src/components/presence/PresenceAvatars.tsx` — stacked avatars,
max 4 + "+N" overflow, Radix tooltip names, `role="group"` +
`aria-label="N people viewing"`, renders `null` when alone, self excluded
twice (hook response never includes the caller; component filters again
defensively).

Mounted on `OpportunityDetailPage.tsx` (breadcrumb row) and
`RfpPipelinePage.tsx` ("bid workspace" — the RFP response pipeline for the
same opportunity), both keyed `entityType: 'opportunity', entityId:
<opportunityId>` so viewers merge across both surfaces of the same bid.

## Cleanup candidate (not done here — out of scope for A3)

The Redis/WS presence stack (`presence.service.ts`, `plugins/realtime.ts`'s
`presence:org:*` handling, `routes/realtime.ts`'s `/presence/org` +
`/presence/entity/:type/:id`) has a live response-schema bug (declares
`{ userId, presence: unknown }`, service returns flat `PresenceEntry` fields,
so everything but `userId` is silently stripped on the wire) and a broken
name stub (`name: ''` hardcoded in `plugins/realtime.ts`'s `upsertPresence`
call sites). **This is not fully unconsumed** — `GET /presence/org` is live
in production via `useOrgPresence()` → `TeamSection.tsx`'s online dot, which
happens to tolerate the schema bug because it only needs `userId`. Only
`GET /presence/entity/:type/:id` has zero callers today. Either fix the name
lookup + response schema (benefiting the already-live org route too) and
wire up the entity route, or delete the entity route specifically — but do
not delete the org route or `presence.service.ts` wholesale without first
replacing `useOrgPresence()`'s dependency on it.
