# RFP workflow — UX refinement backlog (Apple-level)

Source: parallel UX/a11y audit of all 8 RFP surfaces (95 issues) + a synthesized
unified design spec. This is the durable backlog; apply incrementally, verifying

- committing each slice. Tick items as they land.

## Unified design spec (the 18 rules every RFP surface must follow)

1. **States contract** — every data view ships loading (`<LoadingSkeleton>` for rows/tables, not bare "Loading…"), error (`<ErrorState>` with a real Retry wired to `query.refetch()`, `role="alert"`), empty (`<EmptyState>` with noun-phrase title + what-to-do-next + action), and populated.
2. **Mutation feedback** — every mutation gives success AND error feedback via toast (`@/components/ui/Toast`); inline editors also show an inline `role="alert"` above the action row on error. No silent number-tick or swallowed failure.
3. **Per-row pending scoping** — when one mutation drives many rows, gate only the active row (`mutation.variables === row.id && mutation.isPending`), not all rows.
4. **Color tokens only** — no raw Tailwind palette (`bg-emerald-100`, `text-red-600 dark:…`, hex). Use the token tag palette (amber/jade/blue/tomato + `--success`/`--danger`) exactly as the Hub.
5. **Canonical proposal-status chip** — ONE source of truth for the 6 `ProposalStatus` values (chip + labels), imported by Hub/Proposals/ProposalDetail/AdminRfp. No per-page status map.
6. **Human labels, never raw enums/IDs** — map enums through a labels object; never render `status.toUpperCase()` or lead a row with a sliced UUID — show the entity NAME.
7. **Dates & money at the edge** — never print raw ISO dates (`toLocaleDateString()`); money is micros → format via the shared money formatter (respects display currency), no hardcoded EUR.
8. **Icons must resolve** — only pass `Icon name=` values present in `Icon.tsx` PATHS (unknown → invisible blank). Decorative icons pass `ariaHidden`.
9. **Focus ring + 44px target** — every interactive element has a visible focus ring + ≥44×44 hit area; prefer shared `Button`/`LiquidGlassButton`.
10. **Canonical header** — every RFP page uses `page-head`/`page-title`/`page-sub` + `useDocumentTitle()`; primary actions are `LiquidGlassButton` + leading `Icon`. No bespoke `h1`.
11. **Surface primitive** — plain `Card` for containers + list rows (row = single `group` link with hover + arrow cue); reserve `GlassCard` for elevated feature tiles.
12. **AI disclosure** — render the shared `<AiDisclosureBadge>` wherever AI content shows (EU AI Act Art. 50); surface draft `sources` as provenance.
13. **Color is never the only signal (WCAG 1.4.1)** — stepper dots get sr-only `(completed/…)` + `aria-current="step"`; score chips get `aria-label`; zero/empty verdict renders neutral, not danger-red.
14. **Live-region announcements** — streaming surfaces wrap progress in `role="status" aria-live="polite"`; list pages keep the sr-only result-count region (add to AdminRfp by-owner).
15. **Semantic structure** — one `<h1>`/page, no skipped heading levels, repeated cards in `<section aria-label>`, steppers are `<nav><ol>`, decorative separators `aria-hidden`.
16. **i18n discipline** — a page is fully translated or consistently English, never mixed; route all user-facing strings through `t()` on pages already using it (Hub, Pipeline).
17. **Microcopy voice** — concise, human; headings are noun phrases; errors state problem + next step; no jargon ("Defend Score" → "Why this score?"); no dev instructions in UI; real ellipsis `…`.
18. **No dead actions / no dead ends** — every control does something real; CTA verbs match behavior; terminal states always offer a next step; captured fields are shown/linked somewhere.

## Cross-cutting fixes (shared files — do once, centrally)

- [x] **`components/rfp/shared/ProposalStatusChip.tsx` (NEW)** — single source of truth for proposal-status tone + labels; adopted in Hub, Proposals (deleted raw-palette `STATUS_BADGE`), ProposalDetail (chip by title), AdminRfp (replaced local `STATUS_TONE`). Also humanized the Proposals status filter + formatted ISO Due dates. **DONE.**
- [ ] **`public/locales/en/rfp.json`** — fix `pipeline.stages` key mismatch (`uploading`→`queued`, `extraction`→`extracting`; add `awaiting_approval`/`approved`/`completed`/`rejected`/`timeout`); add missing namespaced strings (KPI details, row meta, SectionEditor, RequirementRow `confidence`, upload hints, `intake.*`). Mirror into es/fr/it/pt/zh.
- [~] **`components/ui/Icon.tsx`** — glyphs `upload`/`file`/`wand`/`refresh` added (fixed 7 invisible icons across intake ReceiveStep/ExtractStep/ReviewStep + account-intel IntelTabs). Type-hardening (`as const satisfies` so `IconName` is a literal union) **DEFERRED** — needs an app-wide Icon-name audit first or it reds the whole typecheck.
- [ ] **`components/rfp/shared/RfpStatusChip.tsx`** — replace raw-palette `STAGE_STYLES` with token tag palette; route `STAGE_LABELS` + aria-label through `t()`, reused by the progress bar.
- [ ] **`components/rfp/compliance/ComplianceRow.tsx`** — map `STATUS_STYLES` onto token tag palette.
- [ ] **`components/rfp/pipeline/PipelineErrorBanner.tsx`** — use shared `Button` for Retry/Restart; route rejected/timeout copy; keep `role="alert"`.
- [ ] **`components/rfp/approval/ApprovalGate.tsx`** — replace hand-rolled Approve `<button>` with shared `Button`; lift `proposalId` so the approved panel can link to `/proposals/:id`.
- [ ] **`components/rfp/shared/AiDisclosureBadge.tsx`** — move off raw amber palette onto `--tag-amber-*` tokens.
- [ ] **`components/rfp/upload/RfpUploadZone.tsx`** — make dropzone a real control (`role="button"` or `<label htmlFor>`); replace inline gradient hex with brand-gradient tokens; move hints to `rfp.json`.
- [ ] **`hooks/useReferences.ts`** — keep the hook as data layer (toast at call site); add `useReferenceTags` for a stable unfiltered tag list if needed.

> Note: refine + verify phases of the generating workflow were cut off by an
> Anthropic session usage limit, so fixes are applied by the main session.
