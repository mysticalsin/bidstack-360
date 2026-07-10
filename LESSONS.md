# LESSONS — BidStack 360°

Ledger backing the repo rule "no TODO without a LESSONS.md entry". Every
in-code `TODO(...)` marker gets a row here stating what is deferred, why it is
safe to defer, and what unblocks it. Remove the row when the TODO is resolved.

| TODO marker | Site(s) | What is deferred & why it is safe | Unblocked by |
| --- | --- | --- | --- |
| `TODO(wire-up)` | `apps/worker/src/queues/predictive-retrain.ts:142` | Cron registration semantics for the retrain queue are ambiguous (repeat vs one-shot). Queue is inert until SERUM predictive scoring is enabled, which is default-off. | SERUM go-live decision; then pin the repeatable-job options and delete the marker. |
| `TODO(360L)` | `apps/api/src/lib/lms-360learning.ts:9,107` | 360Learning endpoints/auth headers are written from docs, unverified against the live vendor API. Integration is flag-gated (`LMS_360L_ENABLED=false` default) and fails closed without credentials. | Vendor sandbox credentials; one verification pass against the real API. |
| `TODO(InfoSearch)` | `apps/api/src/lib/infosearch-client.ts:9` | Same as 360L: client written to spec, unverified live. Flag-gated (`INFOSEARCH_ENABLED=false` default), fails closed. | InfoSearch MCP URL + API key; live verification pass. |
| `TODO(Spotlight Ref)` | `apps/api/src/services/project-reference.service.ts:3`, `apps/api/src/routes/project-references.ts:77` | Reference ingestion path stubbed pending the Spotlight Reference rework; current routes serve stored rows only. | Spotlight Ref design decision (product), then implement ingestion. |
| deferred-feature TODO | `apps/worker/src/queues/calls.ts:154` | Call-recording follow-on (transcription enrichment) deferred; the queue processes calls without it and the field is nullable. | Product decision on transcription provider + PII sign-off (transcripts are in the PII decision set D3). |
| virtualization TODO | `apps/web/src/components/rfp/compliance/ComplianceMatrix.tsx:1` | @tanstack/react-virtual adoption deferred until matrices exceed ~200 rows; current pilot RFPs are far below that and rows are memoized. | First real RFP with a 200+ requirement matrix; then virtualize before it lands. |
