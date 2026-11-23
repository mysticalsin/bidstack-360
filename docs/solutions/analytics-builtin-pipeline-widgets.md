# Analytics widgets with no saved report

**Problem:** `/reports` redirects to Analytics. The seeded Weighted Pipeline and Pipeline by Stage widgets have no `reportId`, so they rendered "No data available for this time period" while `GET /api/reports/pipeline` had open deals.

**Diagnosis:** `WidgetRenderer` treated a missing report run as an empty series. The seed widgets were never bound to the live pipeline snapshot.

**Fix:** Resolve those widgets by `config.source`, or by their seeded titles, and render `weightedPipeline` plus open stages from the pipeline report. A zero weighted value still renders as 0.

**Why it works:** The command center and the pipeline API now share one snapshot, including orgs seeded before `source` was stored, because the title fallback still matches.

**Prevention:** `e2e/reports.spec.ts` opens `/reports` and requires a non-zero weighted label and an open stage row.
