# Audit log read scope (B3/C3/C4)

**Problem:** Sales Manager holds `audit-log:read` but the Settings tab,
`/audit-log`, and ⌘K treated audit as `settings:write`. List/export also
returned actor emails and search prefixes to every reader.

**Fix:** Gate those three doors on `audit-log:read`. Redact `q`/`query`/
`search`/`prefix` from diffs. Show actor email only when the caller has
`settings:write`. Log `account.financials.view` on GET financials.
