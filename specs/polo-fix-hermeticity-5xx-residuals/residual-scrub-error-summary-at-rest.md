# Residual: scrub migration errorSummary at rest

Ticket: `polo-residual-scrub-error-summary-at-rest`
Owner: Tony (product). This is a data rewrite, not part of PR #348.
Opened from Devin debate round 1, item 4, and Sentinel item 5. This file is the residual ticket. No GitHub issue was opened.

## What is left

`migration_jobs.error_summary` can already hold driver text, provider text, and `chunk failed permanently:` tails. Readers that return the column map it through `migrationPublicMessage` or `migrationFailureText` (see `decision.md`). The stored JSON is not rewritten.

A database session, a backup, or a future reader that selects the column and skips those functions still sees the raw text.

## Done when

A one-shot rewrite, or a read-and-write on the next job update, replaces unknown messages with `import_failed` and `chunk failed permanently:` tails with `chunk failed permanently: import_failed`, using the same exact allowlist as `migrationPublicMessage`. Known codes and known row sentences stay. The rewrite is idempotent. It does not run from this PR.
