-- MemosTrace.user_id records the actor of a trace but has no foreign key, and
-- system-initiated traces (RFP worker pipeline, KB ingest) have no user. Make
-- the column nullable so those traces store NULL instead of failing the UUID
-- cast on a sentinel string such as 'system' (Prisma P2023). The original
-- actor string is preserved in metadata.actor by MemOSService.logTrace.
ALTER TABLE "memos_traces" ALTER COLUMN "user_id" DROP NOT NULL;
