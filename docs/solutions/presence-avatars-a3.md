# Presence avatars (A3) — two competing presence stacks existed; picked one

## Problem

Task A3 asked to "render the presence that is already built." Investigation found
**two independent, unwired presence systems** already shipped server-side, not one:

1. **DB-backed** — `UserPresence` Prisma model, `GET/POST /api/presence`
   (`apps/api/src/routes/collaboration.ts`), filtered by `recordType`/`recordId`.
   Pure REST, no TTL, real `userName` via a Prisma join. Already consumed by
   `useOrgPresence()` in `apps/web/src/hooks/useUsers.ts` (org-wide online dot in
   the Team settings table).
2. **Redis/WS-backed** — `presence.service.ts` + `plugins/realtime.ts`, keyed
   `presence:org:<orgId>:user:<userId>`, 30s TTL, pushed over `/api/realtime`
   WebSocket (`presence:org:<orgId>` channel) plus a `GET /presence/org` /
   `GET /presence/entity/:type/:id` polling fallback. **Zero frontend code
   consumed this** (grepped clean across `apps/web/src`).

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
- The DB-backed system is already proven in production by `useOrgPresence()`.

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
`/presence/entity/:type/:id`) is unconsumed dead weight with a live response-
schema bug and a broken name stub. Either wire it up properly (fix the name
lookup, fix the response schema, solve WS auth for Clerk) or delete it — right
now it's maintenance surface with no reader.
