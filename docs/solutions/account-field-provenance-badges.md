# Account Field Provenance Badges

## Problem

Account cockpits lose trust when enriched values, manual values, CRM-derived
values, and missing-source values all render as plain text. Users need to know
which fields came from external enrichment, which were manually corrected, and
which are still unverified before acting on an account plan.

## Solution

- Use one small `SourceBadge` shape for cockpit provenance labels.
- Keep persisted business truth in the backend model; do not fake provider
  deltas in the UI if the API cannot store accept/reject state yet.
- For fields already backed by `CockpitKpi.fieldKey`, reuse the KPI source model
  so manual overrides remain visible in secondary surfaces such as Business
  Snapshot.
- For technical stack items, show the item `source` and `confidence` on each
  vendor pill until the full editable stack/delta API exists.
- For legal/MSA account-intel fields, return a `fieldSources` map from the API
  so reference, countries, rebate, rate review, review dates, expiry, and rate
  card fields show the reviewed source where the user reads the contract terms.
- For legal/MSA summary metrics, treat counts and dates as derived facts. Show
  compact provenance on Active, Coverage, and Next summary tiles using the
  underlying `status`, `countries`, `nextRateReviewAt`, and `expiryDate` source
  fields.
- For extracted account-intel solution/product rows, expose a `fieldSources` map
  from the API and persist document-extraction metadata in the worker. The UI
  may fall back to document id + confidence for legacy rows, but new rows should
  carry durable source/extraction/file metadata.
- Do not stop at the card title. Account-intel solution/product cards must show
  compact field proof for decision-critical fields such as description,
  category, status, price, and currency so users can audit the facts they act
  on without opening raw metadata.
- Treat missing provenance as visible state, not an absent badge.

## Verification

- Component tests must assert one source badge per Business Snapshot row.
- Component tests must assert technical stack pills expose source and confidence.
- Contract agreement route tests must assert manual, document-linked, and
  AI-reviewed extraction paths return field-level provenance.
- Contract agreement component tests must assert the visible contract terms carry
  compact source badges and accessible hints.
- Contract summary metric tests must assert derived metrics expose a source badge
  and hint, not only the underlying row fields.
- Account-intel solution/product tests must assert `fieldSources` survives
  worker persistence, API serialization, and UI rendering.
- Account-intel UI tests must assert secondary field proof badges render from
  `fieldSources`, not just the primary `name` provenance badge.
- After changing shared response schemas, rebuild `@bidstack/shared` before API
  tests or live browser QA; Fastify response validation resolves the package
  `dist` declarations/runtime and can otherwise strip newly-added fields.
- Account-detail E2E must still prove no page-level overflow on desktop/mobile.
- A live axe scan should remain free of critical/serious violations.
