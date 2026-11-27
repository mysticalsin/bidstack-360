# Competitor findings wait for the read

**Problem:** Competitor intelligence treated a missing payload as an empty research pass. A paused read has `isLoading` false and no rows, so the panel said "No competitor findings yet". A read that had not started did the same. An in-flight read was only a skeleton in the place a settled empty pass sits.

**Diagnosis:** `isLoading` is `isPending && isFetching`. An idle or paused read is pending and not fetching, so the empty branch ran. Demo synthetic findings can still be on the server. The panel had not read them.

**Fix:** `competitorInsightsPhase` in `apps/web/src/components/rfp/competitor/competitor-insights-read.ts` reports unread, failed, or ready. `CompetitorIntelPanel` says "Checking competitor findings. They have not arrived." while unread. A failed read stays on the error. A settled empty list still says "No competitor findings yet". A loaded finding still shows.

**Why it works:** Empty is a payload that arrived with no rows. Any other missing payload is unread or failed, so the panel does not invite a new research pass as if the cited list were already known.

**Prevention:** `CompetitorIntelPanel.read-honesty.test.tsx`. The paused, not-started, and in-flight cases failed before the phase check.
