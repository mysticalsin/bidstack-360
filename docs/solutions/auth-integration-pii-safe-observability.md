# Auth and Integration PII-Safe Observability

## Context

Enterprise logs need enough auth/integration detail to diagnose policy failures
and provider connection state, but they must not become a second PII store.

Two risky patterns were removed:

- SSO domain rejection logged the full rejected email and returned the tenant
  allowlist in the response.
- Gmail and Outlook connection logs wrote the external mailbox address.

## Pattern

- Use generic user-facing auth-policy messages. Do not reveal configured
  allowlists to rejected callers.
- Log pseudonymous internal ids (`orgId`, `userId`) and bounded metadata only.
- For email-adjacent telemetry, log the normalized domain if useful; never log
  the local part.
- Keep raw email addresses in the database fields that need them, not in general
  Pino output.
- Preserve HTTP semantics: verified-token policy failures should remain 403
  responses, while token verification failures stay 401.

## Implementation

- `apps/api/src/lib/email-privacy.ts` exposes
  `emailDomainForTelemetry(...)`.
- `apps/api/src/plugins/auth.ts` uses a generic
  `SSO_DOMAIN_REJECTED_MESSAGE`, logs `{ userDomain, allowedDomainCount }`,
  and rethrows application-generated HTTP errors instead of wrapping them as
  Clerk verification failures.
- `apps/api/src/routes/integrations/gmail.ts` and
  `apps/api/src/routes/integrations/microsoft-mail.ts` log
  `externalAccountDomain` instead of `email`.

## Verification

- `pnpm --filter @bidstack/api exec vitest run src/lib/email-privacy.test.ts src/plugins/auth.test.ts`
- `pnpm --filter @bidstack/api exec eslint src/lib/email-privacy.ts src/lib/email-privacy.test.ts src/plugins/auth.ts src/plugins/auth.test.ts src/routes/integrations/gmail.ts src/routes/integrations/microsoft-mail.ts`
- `pnpm --filter @bidstack/api typecheck`
- `rg -n "server\\.log\\.info\\(\\{ orgId, userId, email: externalEmail \\}|req\\.log\\.warn\\(\\{ email|Sign-in from @|Allowed domains:" apps/api/src/plugins/auth.ts apps/api/src/routes/integrations/gmail.ts apps/api/src/routes/integrations/microsoft-mail.ts`

## Guardrail

Any auth/integration log that includes `email`, `phone`, token material, or
provider account identifiers needs a privacy review. Prefer id-only correlation
plus bounded, non-identifying metadata.
