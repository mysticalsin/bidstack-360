# RBAC E2E viewer persona must have its own auth identity

## Problem

The web E2E fixtures defined both `read-only` and `viewer` personas. Both map
to the canonical `Read-Only` system role, but the API stub auth derived
`clerkUser` from `systemRole`. That meant both personas tried to create or
upsert `clerkUser=e2e_read_only`, and the second persona could hit a unique
constraint conflict.

## Fix

Keep the product role model canonical, but make E2E persona identities explicit:

- `read-only` -> `systemRole=Read-Only`, `clerkUser=e2e_read_only`
- `viewer` -> `systemRole=Read-Only`, `clerkUser=e2e_viewer`

Then assert the contract at both layers:

- API: `viewer` resolves to `legacyRole=member`, role `Read-Only`,
  `accounts:read`, no admin audit permission, and no write permissions.
- Web E2E: `viewer` can load the dashboard, sees read-only capabilities, and is
  redirected away from admin-only Audit Log.

## Lesson

Do not derive test user identities from a role name when multiple personas share
the same product role. E2E personas are QA identities first and authorization
roles second; keep the identity unique and assert the effective permissions.
