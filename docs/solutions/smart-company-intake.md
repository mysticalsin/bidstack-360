# Smart Company Intake

## Problem

Adding an account felt like a blank CRM form. For a bid and presales workflow, the first company touch should immediately resolve name/domain, logo, enrichment source, confidence, and the existing account match before any user has to type deal details.

## Solution

- Use the existing CRM enrichment service as the write path: `POST /api/crm/companies/:id/enrich`.
- Use `GET /api/crm/companies/lookup` as the preview path so existing accounts are detected before duplicate creation.
- Derive domain and website defaults inside input handlers, not effects, to keep React hooks lint happy and avoid cascading renders.
- Preview logos from the enriched company when available, otherwise use a deterministic domain favicon preview and initials fallback.
- On successful enrichment, invalidate `crm-dashboard` and navigate directly to the new account cockpit.

## Verification

- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web lint`
- `pnpm --filter @bidstack/web test`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/web e2e`
