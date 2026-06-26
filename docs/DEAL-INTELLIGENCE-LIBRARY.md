# Deal Intelligence Library — Design & Phased Plan

**Status:** Phase 1 in progress (this session). Phases 2–4 designed, build gated on DB + `db:generate`.
**Owner:** BidStack core. **Last updated:** 2026-06-20.

## Problem (what's actually broken today)

1. **"I can't add documents."** The SERUM Mission Control page (`/serum`,
   `apps/web/src/pages/SerumMissionControlPage.tsx`) is a **read-only status
   dashboard** — it has no uploader. Its "Document intelligence" card dead-ends
   to a link. The real uploader is buried in the account cockpit
   (`apps/web/src/components/files/FilesPanel.tsx`), behind a layout flag.
2. **"It doesn't work / not user friendly."** Uploading a file does **nothing**
   automatically. Turning a document into intelligence is a *separate, hidden*
   step: open the account intel panel → "Extractions" tab → click **Extract**
   per file (`apps/web/src/components/account-intel/IntelTabs.tsx:377`). Nothing
   tells the user this exists, so uploads feel like dead ends.
3. **"Showcase why we won/lost."** Win/loss data exists (`WinLossRecord`) but it
   is **100% manual** and has **zero connection to documents**. The extraction
   worker only pulls "solutions/products" — never why-won, why-lost, competitor,
   or pricing themes.
4. **No organized home** for MSAs, rate cards, and win/loss debriefs, and no
   learning across them.

## Vision

A **Deal Intelligence Library**: every MSA, rate card, proposal, RFP, and
win/loss debrief is uploaded once, auto-categorized, auto-extracted into
structured intelligence, and continuously learned from — surfacing **why we win,
why we lose, pricing benchmarks, and competitor patterns**, both per-account and
org-wide, always with source citations.

## Building blocks already in the repo (reuse, do not rebuild)

| Concern | Asset | Location |
|---|---|---|
| File storage + org/account scope | `FileAttachment` | `packages/db/prisma/schema.prisma:1181` |
| Extraction job + JSON result | `DocumentExtraction` | `schema.prisma:1277` |
| Extracted records + provenance/confidence | `AccountSolution`, `AccountProduct` | `:1215`, `:1245` |
| MSA / contract lane | `BidDocument`, `DocumentVersion`, `ContractAgreement` | `:1432`, `:1463`, `:4836` |
| Win/loss (manual today) | `WinLossRecord` (`outcome`, `reason`, `competitor`, `note`) | `:4906` |
| Extraction pipeline (Dust agent or deterministic) | document-extract worker | `apps/worker/src/queues/document-extract.ts` |
| NDA-tier exclusion from AI | `isDocumentAiSafe` | `apps/api/src/queues/document-extract.ts:69` |
| Win/loss API + patterns aggregate | `/win-loss/*` | `apps/api/src/routes/win-loss.ts` |
| Status surface | SERUM Mission Control | `apps/web/src/pages/SerumMissionControlPage.tsx` |

The feature is **mostly wiring + extending** these, not greenfield.

## Target architecture

- **Categorize** every upload: `MSA | rate_card | proposal | rfp | win_loss_debrief | reference | other`. Cheap heuristic on filename/content + LLM fallback.
- **Extract more**: the worker prompt also emits win/loss signals (`whyWon`, `whyLost`, `competitor`, `priceTheme`, `productFit`) and rate-card line items — as typed structures with confidence + the source `documentId` (mirrors the existing `extractedFromDocumentId` provenance pattern on `AccountSolution`).
- **Learn**: an aggregator rolls doc-derived signals into `WinLossRecord` (stamped with `extractedFromDocumentId`), behind a **human-review gate** before any doc-derived fact is treated as truth.
- **Surface**: (a) per-account intel panel gains a **"Why won / lost"** tab with citations; (b) a **cross-deal Win/Loss Patterns** dashboard (extend `/win-loss/patterns`); (c) the SERUM **Document Intelligence** module becomes a real entry point into the library + uploader, ending the dead-end.

## Phases ("all of it, phased")

### Phase 1 — Make it work + discoverable *(no schema change; verifiable without regen)*
- **Auto-extract on upload** — *done this session* in `apps/api/src/routes/files.ts` finalize: an account-scoped, text-extractable document (`pdf/doc/docx/txt/md`) auto-creates a `DocumentExtraction` and enqueues the worker. Fail-open; gated off under `NODE_ENV=test`. Kills the hidden two-step.
- **Live status + progress (frontend):** poll extraction status while `pending/running`; show upload progress; add a clear "Add documents" affordance reachable from SERUM.
- **Verify:** `web`/`api` typecheck + lint + build now; full integration once the DB is back.

### Phase 2 — Organized library + categorization *(schema: `FileAttachment.category`; needs `db:generate`)*
- Add a `category` enum + auto-classify on extract.
- Library UI: filter/group by category (MSA, rate card, win/loss, …), per account and org-wide.

### Phase 3 — Learn win/loss patterns from documents *(schema: `WinLossRecord.extractedFromDocumentId` + a doc-signal store; worker prompt)*
- Extend worker extraction to emit win/loss signals; aggregator upserts `WinLossRecord` with provenance; human-review gate before it counts toward patterns.
- Account **"Why won/lost"** tab with source-document citations.

### Phase 4 — Cross-deal intelligence + rate-card benchmarks
- Cross-deal pattern dashboard: top loss reasons, winning themes, competitor win-rates — all sourced from documents with drill-down to the source.
- Rate-card parsing (xlsx/csv) → benchmark table.
- SERUM module ties the library + patterns together.

## Guardrails (must match BidStack standards)

- Org-scope every query; **provenance + confidence on every extracted fact** (reuse the existing badge pattern); **human-review gate** before doc-derived win/loss is treated as truth; audit every write; **NDA-tier-D excluded from AI** (`isDocumentAiSafe`); **i18n** every label (note: `WinLossReasonsCard` currently hardcodes English reason labels — fix during Phase 3).

## QA plan (requires a live DB)

- **Integration:** upload → auto-extract → intel appears; category filter; win/loss extraction → review → patterns aggregate.
- **e2e:** extend `apps/web/e2e/serum-account-experience.spec.ts`.
- **Blocker:** build + QA need the dev Postgres (currently exhausted by orphaned `node` test-workers) and `db:generate` (Windows DLL-lock). Clear those and the phased build can run end-to-end with QA gates.
