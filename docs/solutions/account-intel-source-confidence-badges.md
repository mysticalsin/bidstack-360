# Account Intel Source Confidence Badges

## Problem

Extracted account-intel cards can look trustworthy while hiding why they should
be trusted. A plain `From:` line is easy to miss, and high-confidence-only
badges hide medium or low-confidence records.

## Pattern

- Show source and exact confidence for every solution/product card.
- Reuse `SourceBadge` so cockpit, technical stack, legal/MSA, and account-intel
  source treatments stay visually consistent.
- If a source document is present, use its file name as the source label and
  include an accessible hint with exact confidence.
- If no source document exists, show a safe `Manual` fallback instead of leaving
  the row source-less.
- Display exact confidence as a percentage, not only a binary "high confidence"
  badge.

## Verification

- Component tests should cover document-derived and manual fallback rows.
- A browser cockpit smoke should prove `/accounts/:id` still mounts and the
  account-intel request returns after the bundle change.

## 2026-06-17 FieldSources Contract Upgrade

- Account-intel solution/product rows now expose `fieldSources` in the shared
  API contract, matching the legal/MSA provenance pattern instead of making the
  UI infer trust state from loose `extractedFromDocumentId` and
  `confidenceBps` fields.
- The document-extraction worker persists durable source metadata on generated
  `AccountSolution` and `AccountProduct` rows:
  `source.type=document_extraction`, `extractionId`, `documentId`, extractor
  kind, and `dustRunId` when present.
- The API serializer prefers stored metadata and safely falls back for legacy
  rows. Fallbacks still show `Manual`, `Dust extraction`, or `Document
  extraction` with exact confidence, source file name, source extraction id,
  and update date when available.
- `IntelTabs` now renders from `fieldSources.name` first, with the previous
  document/confidence fallback preserved so cached or old rows remain visible.

## Verification Delta

- `pnpm --filter @bidstack/shared build`
- `pnpm --filter @bidstack/web test -- src/components/account-intel/IntelTabs.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/api test -- src/routes/account-intel.integration.test.ts --reporter=dot`
- `pnpm --filter @bidstack/worker test -- document-extract.contract.test.ts`
- API, web, and worker targeted ESLint for touched files.
- API, web, and worker `tsc --noEmit --pretty false`.
- API, web, and worker package builds.
- In-app browser smoke on `http://127.0.0.1:5174/accounts/ci-financial`
  confirmed the account page and Account Intelligence panel mount with no
  console errors. CI Financial currently has zero solution/product rows, so
  visible badge rendering is covered by component/API/worker tests.

## References

- `apps/web/src/components/account-intel/IntelTabs.tsx`
- `apps/web/src/components/account-intel/IntelTabs.test.tsx`
- `packages/shared/src/schemas/account-intel.ts`
- `apps/api/src/routes/account-intel.ts`
- `apps/worker/src/queues/document-extract.ts`

## 2026-06-17 Secondary Field Proof Rail

- The first `fieldSources` UI pass proved the API contract but still rendered
  only `fieldSources.name` on solution/product cards.
- Account-intel cards now keep the primary source/confidence badges and add a
  compact field-proof rail for secondary decision fields:
  - solutions: description, category, status
  - products: description, category, price, currency, status
- The chips use the field name as the visible label and the API provenance hint
  as the accessible/title text. This keeps the card scannable while preserving
  source detail for audit and keyboard/screen-reader users.
- Legacy rows without `fieldSources` still fall back to the existing manual or
  document/confidence badges; the rail appears only when the API provides field
  proof.

## Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/account-intel/IntelTabs.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/account-intel/IntelTabs.tsx src/components/account-intel/IntelTabs.test.tsx`
- `pnpm --filter @bidstack/web build`
- `git diff --check -- apps/web/src/components/account-intel/IntelTabs.tsx apps/web/src/components/account-intel/IntelTabs.test.tsx`
