# API key company/MSA scope (B2)

**Problem:** `getAccessScope` treated every non-UUID actor (`apikey:<id>`) as
unrestricted. New vendor/CI keys inherited org-wide company and MSA access.

**Fix:**

- `ApiKey` now has `unrestrictedScope` (default false), `readOnly` (default
  true), `companyIds`, and `msaIds`.
- Existing rows are backfilled unrestricted + writable so MARS keys keep
  working.
- New keys default-deny: empty allowlists see no companies/MSAs. The create
  dialog starts read-only and not org-wide.
- `requirePermission` rejects `:write` when `readOnly` is set, even if a write
  scope is present.

**Do not:** treat empty company/MSA lists as org-wide. That was the hole.

**Tests:** Prisma inserts inherit `readOnly=true`. A write-scoped key used to
assert a later gate (human actor, admin role, missing exact scope) must set
`readOnly: false` or the new flag 403s first.
