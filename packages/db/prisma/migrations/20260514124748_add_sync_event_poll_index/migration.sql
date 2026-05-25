-- CreateIndex
CREATE INDEX "sync_events_status_source_received_idx" ON "sync_events"("status", "source", "received_at");
