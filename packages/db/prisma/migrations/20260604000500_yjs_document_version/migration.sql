-- YjsDocument optimistic-concurrency token (review finding 2026-06-04).
-- Compaction (worker sweep + API inline path) read-merge-overwrites ydoc_binary.
-- Two concurrent passes could blind-overwrite each other and lose a collaborative
-- edit. The snapshot write is now a compare-and-swap on "version", so a stale
-- pass aborts instead of clobbering. Existing rows default to 0.
ALTER TABLE "yjs_documents" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
