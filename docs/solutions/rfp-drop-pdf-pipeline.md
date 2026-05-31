# RFP drop-PDF pipeline — making upload→pipeline→approval work end-to-end

**Date:** 2026-05-31 · **Area:** Wave-9 RFP engine (web upload, files storage, worker pipeline, DB)
**Commit:** `eb57f477` · **Branch:** `feat/wave9-rfp-engine`

## Problem

Dropping a PDF on the RFP pipeline page did nothing useful: the upload failed
before the pipeline started, and even when forced past upload the pipeline died
at its first DB write. Static gates (typecheck/lint/887 tests) were all green —
the bugs only surfaced against a real browser flow + a real Postgres.

## Root causes (ranked by how hard they blocked the flow)

1. **Upload never matched the route.** `useRfpUpload` POSTed raw `multipart` to
   `/opportunities/:id/rfp/upload`, but that route takes JSON `{ fileAttachmentId }`.
   Instant 400. The real 3-step storage flow (`upload-url` → PUT → `finalize`)
   existed in `useFiles.ts` but was never wired into the RFP path.
2. **Local binary uploads 415'd.** `getUploadUrl` signs `Content-Type: application/pdf`,
   but Fastify had no content-type parser for binary, so the local-mode PUT to
   `/files/local-upload` 415'd before the handler (which reads `req.raw`) ran.
   Broke _every_ local upload, not just RFP.
3. **`completed_phases` enum-array drift (the silent killer).** `schema.prisma`
   declares `completedPhases RfpResponsePhase[]` and the live DB matched, but the
   worker's raw SQL was written against the _original_ migration's `TEXT[]` and
   inserted/appended `text[]`/text. Every orchestration died with PG `42804`
   (`type RfpResponsePhase[] but expression is of type text[]`). The orchestrator's
   own `markOrchestrationFailed` also wrote `failed_phase='orchestrate'` — not a
   valid enum label — so even failure-marking failed and rows stuck at `queued`.
4. **API/worker read different local dirs.** API wrote `apps/api/.uploads`
   (cwd-relative), worker read `apps/worker/.uploads` (cwd-relative) → ENOENT.
   The API also ignored `LOCAL_STORAGE_ROOT` while the worker honored it.

Secondary: orphan orchestration on enqueue failure (202 over a dead row); UI stage
mapped from `state` (stuck on `running`) instead of `current_phase` so progress
looked frozen; ApprovalGate POSTed a 404 `/approve` with `{ reviewNotes }`;
story-match permanent-fail never advanced the section-planning counter (froze the
pipeline); zero-requirements stranded the run until the 30-min reaper.

## Fixes

- Web: real 3-step upload in `useRfpUpload` + store-backed upload state (zone and
  progress bar both call the hook, so it must live in the store, not `useState`).
- `files.ts`: pass-through content-type parser for the allowed upload types.
- Worker raw SQL: cast every `completed_phases` write to `"RfpResponsePhase"`;
  `markOrchestrationFailed` writes `failed_phase = NULL` + folds the step into the
  reason. New migration `20260531000400_completed_phases_enum_array` reconciles the
  column type (idempotent `DO` block — no-op where already enum[]).
- Storage: both api + worker resolve the local root to a monorepo-anchored
  `apps/api/.uploads` and honor `LOCAL_STORAGE_ROOT`.
- Route returns 503 + rolls back the orchestration if enqueue throws.
- `useRfpPipeline` derives UI stage from `current_phase`; story-match `failed`
  handler advances the counter on the final attempt; zero requirements fails loud.

## Verification

Live HTTP smoke against the dev stack: drop PDF → `upload-url 200` → `PUT 200` →
`finalize 201` → `rfp/upload 202` → SSE `running → awaiting_approval` →
`POST /proposals/:id/rfp-approve 200`. typecheck/lint/build green; api 8/8 +
worker 96/96 RFP tests.

## Reusable lessons

- **Raw SQL drifts from the Prisma enum.** When a column is a Postgres enum (or
  enum array), every raw `$queryRaw`/`$executeRaw` parameter and array literal
  needs an explicit `::"EnumType"` cast — string _literals_ coerce, but bound
  _parameters_ (sent as `text`) and `ARRAY[]::text[]` do not. Unit tests that mock
  Prisma never catch this; only a real-DB run does. Grep every enum column's raw
  writes when the schema type changes.
- **Two processes + local-fs storage = cwd trap.** Anchor the shared dir to a
  monorepo landmark (walk up for `pnpm-workspace.yaml`), don't use
  `process.cwd()/.uploads`. Prod S3 hides this; local dev exposes it.
- **Pre-signed-upload routes need a binary content-type parser** for the local PUT
  target, or they 415 before the handler can read `req.raw`.
- **`tsx watch` may not hot-reload deep lib changes** reliably after a crash —
  a stuck watcher serves stale code. When a live fix "isn't taking," verify the
  process actually reloaded (don't assume) before assuming the code is wrong.
- **Verify against the real runtime, not just green gates.** All four hard bugs
  passed typecheck + lint + 887 tests and only failed in a live browser/Postgres run.
