# Competitor profiles wait for the read

**Problem:** The competitor picker treated a missing catalog as no competitors. A paused read has `isLoading` false and no rows, so the select showed a dash. An in-flight read did the same. A failed read did the same. Demo profiles can still be on the server.

**Diagnosis:** The picker used `data?.items ?? []` and disabled itself whenever that array was empty. `isLoading` is `isPending && isFetching`, so an idle or paused read never took a waiting branch.

**Fix:** `competitorProfilesPhase` in `apps/web/src/components/rfp/competitor/competitor-profiles-read.ts` reports unread, failed, or ready. The picker says "Checking competitors. The list has not arrived." while unread. A failed read with no payload stays on the error. A settled empty list says "No competitors yet". A loaded name stays, including after a failed refresh.

**Why it works:** Empty is a payload that arrived with no names. Any other missing payload is unread or failed, so the picker does not claim the org tracks nobody.

**Prevention:** `CompetitorIntelPanel.profiles-read.test.tsx`. The paused, in-flight, failed, and settled-empty cases failed before the phase check. Draft #1061 owns the findings list. This does not change that branch.
