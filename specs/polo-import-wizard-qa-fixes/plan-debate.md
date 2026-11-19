# Plan debate — POLO-IMPORT-WIZARD-QA-FIXES

## Proposal

H-1. Below the `md` breakpoint, render each column as a stacked row: header, sample, and a full-width Maps-to select. Keep the three-column table at `md` and up, and let that table scroll (`overflow-x-auto`) instead of clipping (`overflow-hidden`). Add three exact auto-map aliases: `Account Name` → `company.name`, `Employees` → `company.employeeCount`, `Country` → `company.countryCode`. No fuzzy matching.

M-1. Cancel sets `lock_timeout` to 2s, then updates the job row. If Postgres cancels that statement (`55P03`), Cancel writes an audit row `migration.cancel.requested` and returns 200 with the job still RUNNING. The chunk, under its existing `FOR UPDATE`, reads that audit row before it inserts and again before it commits bookkeeping. If the mark is there it rolls the inserts back and compare-and-sets the job to CANCELLED. A cancel that gets the lock still sets CANCELLED immediately, which the chunk already treats as "stop".

M-2. A ref makes Retry single-flight, the same way Confirm already is. The 409 sentence `Migration job is no longer failed` is not an error on screen: the winning request moved the job, and the poll shows the new status. Other 409 sentences the wizard still shows go through `t()` with an English fallback. The raw server string is not rendered.

Out of scope: deploying, the polo-preview Worker, wrangler, and merging. Devin gates the exact head.

## Challenger: Devin

## Challenger: Sentinel

Verbatim record: `plan-debate-polo-pr349-3a1975bd-20261119.md` (sha256 abe3d4a519cd14fbdca3fc997ac0db3756ae1aae63f2c4ceeba10a1dcdfa2cef).

CONSENSUS: OBJECTIONS
