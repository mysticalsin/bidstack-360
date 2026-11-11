# Migration starts: the uploadId retry window

**Problem:** A migration start (`POST /api/v1/migrations/start-csv`,
`start-hubspot`) queues its chunks and then writes the audit row, the mapping
and the status. If one of those writes fails, the start answers 500 but the
import is already queued, so a client retry used to import every row again.

**Fix:** The client sends one `uploadId` per start and reuses it on retry. The
API serialises starts with the same key on a Postgres advisory lock, and the
unique `(org_id, upload_id)` index on `migration_jobs` refuses a duplicate with
409. A retry finds the earlier start. If its start writes never finished, the
retry queues its chunks again under the same deterministic BullMQ job ids and
finishes those writes. A start that finished is returned as is.

**Window:** Re-adding a chunk is a no-op only while BullMQ still holds a job
with that id. The `MIGRATION` queue keeps a completed chunk for **7 days**, and
only the **last 500** completed jobs across all orgs (`removeOnComplete`). A
resume after either limit queues chunks that already ran again, and their rows
are imported a second time. How far that goes depends on the dedup strategy.
In practice client retries come seconds after the failure, well inside both
limits.

**Signal:** `warnIfPastRetryWindow` (`apps/api/src/lib/upload-start.ts`) logs
the warning `resuming a migration start past the queue retry window` with
`migrationJobId`, `ageMs` and `missingChunks`. It fires when the start is older
than 7 days or when one of its chunks is no longer in the queue. The resume
still runs.
