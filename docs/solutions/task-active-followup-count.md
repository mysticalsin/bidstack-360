# Task header counts the open book

## Evidence

The tasks page subtitle used `data.items.length`. That length is the loaded page, and it includes completed follow-ups. The demo book has five tasks and one completed handover, so the header read "5 active follow-ups." While the list was still loading, the same line read "0 active follow-ups."

`GET /api/tasks/summary` already counts `status <> 'done'` for the whole org. The sidebar overdue badge reads that summary. The header did not.

## Correction

The header uses `summary.open`. A summary that has not arrived says "Counting follow-ups." A failed summary with no last count says "Couldn't count follow-ups." A refresh that still holds the last count keeps that count.

## Verification

`activeFollowUpCount` and `TasksPage` tests cover the demo book (open 4, page length 2 including one done row), the pending line, and the failed read.
