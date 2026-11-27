# The tasks list counts follow-ups that are still open

## Evidence

The caption under Tasks used the loaded row count. On 25 Nov 2026 the Polo book includes "Submit revised pricing & SoW v2" (in progress, due 15 May 2026) and a finished handover. Both were called active. Before that read landed, and when it failed, the same caption said "0 active follow-ups", which is the sentence for an empty book. Marking the pricing follow-up done toasts "Marked done" and the caption still counted the row.

## Correction

The caption counts loaded rows whose status is not done. One row uses the singular sentence. A loading or failed read draws no count. A successful empty page still says zero, because that book has no active follow-ups. The done toast is unchanged. The overdue chip still leaves a finished row.

## Verification

`apps/web/src/pages/TasksPage.active-count.test.tsx` renders the loading and failed reads without a zero caption, expects zero on a page that loaded no rows, expects one active follow-up when the handover is already done, and after the pricing toast expects zero with the overdue chip gone.
