# Late follow-ups outside the activity chart

## Evidence

Company and account activity charts draw the last 12 weeks. Demo follow-ups are due in May 2026. On 25 Nov those dates never increment a bar, and a window with no newer activity painted empty charts. The summary already counted the late follow-ups.

## Correction

When the overdue count is larger than the bars, the page says how many open follow-ups are already late and the oldest due day. A window with no activity and no in-window overdue shows that sentence instead of blank charts. Follow-ups the bars already draw do not get the sentence.

## Verification

`apps/web/src/components/company/AccountActivityCharts.test.tsx` covers the quiet window, charts that still have newer activity, the singular, and in-window overdue that must stay quiet.
