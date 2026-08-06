# PLAN — Compai fusion (full re-IA + sheet model + Carbon icons)

Branch `feat/crm-design-fusion`. Companion to [`DESIGN.md`](./DESIGN.md).
Reference: `github.com/trycompai/crm` (cloned and read, not paraphrased).

## Outcome

Polo PreSales adopts the reference's user experience end to end: a spare icon
rail, a single centred page shell, record create/detail as slide-over sheets,
URL-driven tables, Carbon iconography and the near-monochrome one-accent token
system.

**Non-goals.** No backend/API changes. No feature removal — every one of the 28
existing destinations stays reachable. No change to auth, tenancy or the demo
door.

**Success metric.** A stranger comparing the two apps side by side reads them as
the same design language, and every destination that worked before still works.

---

## ADR-1 — Information architecture: 7-item rail over section sub-nav

**Decision.** Collapse 28 destinations to a **7-item icon rail**; each rail item
opens a section whose sub-destinations appear in a secondary in-section nav (the
pattern the reference already uses for Settings).

| Rail | Absorbs |
|---|---|
| Overview | Dashboard · Quick Start |
| Accounts | Accounts · Companies · Contacts · Sector View · KAM Initiatives · Cross-sell · Territories · Reference Library |
| Pipeline | Leads · Opportunities · Forecasts · Win/Loss Review |
| Bids | Bid/No-Bid Matrix · Proposals · Document Intake · Sales Toolkits · SERUM Mission Control |
| Work | Tasks · Team Workload · Calendar · Workflows · Collaborate |
| Insights | Analytics & Reports |
| Settings | Settings · Custom Objects · Agent Studio |

**Why.** A literal 5-item copy would strand 20+ destinations behind search. Two
levels keep the rail as calm as the reference while every feature stays two
clicks away.

**Rejected.** (a) Flat 28-item sidebar — what exists today; the density is the
thing being replaced. (b) Literal 5-item rail — buries too much. (c) Command-
palette-only access — discovery collapses for anyone who doesn't know the name of
what they want.

**Dissent to record.** Grouping is a judgement call; "Cross-sell" and
"Reference Library" could equally sit under Bids. Revisit once it can be watched
in use rather than argued about.

## ADR-2 — Detail and create become sheets

**Decision.** Record create and record detail open in a right-side `Sheet`; the
list stays mounted underneath. The open record is encoded in the URL so a sheet
is deep-linkable and the back button closes it.

**Why.** This is the single largest contributor to the reference's feel. Scroll
position and filter state survive, so the list stops being something you leave.

**Rejected.** Full-page routes (today's model — loses context on every drill-in);
modal dialogs (centre-screen and worse for long forms).

**Risk.** BidStack's detail pages carry far more than the reference's — bid
facts, compliance matrices, scoring. Sheets that host these must be wide
(`max-w-3xl`+) and internally scrollable, and a few of the heaviest may need to
stay full-page. That is a per-page call at conversion time, recorded as it
happens rather than pre-guessed.

## ADR-3 — Carbon icons replace Lucide

**Decision.** Adopt `@carbon/icons-react`, matching the reference. One family,
app-wide, no mixing.

**Why.** Explicitly requested. Carbon's flatter, squarer geometry is a visible
part of the reference's character.

**Cost, stated plainly.** Lucide is used across the whole app; this is a large
mechanical diff with low intellectual content and real regression surface (every
missed import is a broken icon). Mitigated by an explicit name map plus a lint
rule banning `lucide-react` imports once migration completes.

## ADR-4 — Retheme in place, don't fork the token layer

**Decision.** Change the values behind the existing token names in
`apps/web/src/index.css`. Do not introduce a parallel theme.

**Why.** The codebase already routes colour through semantic tokens with WCAG
ratios documented inline. Rethemed values propagate to every component for free,
and the existing design-law lint rules keep working.

**Rejected.** A second theme layer toggled at runtime — doubles the surface and
guarantees drift.

---

## Sequence

Each step ships green and is verifiable in the live demo before the next starts.

1. **Token layer** — accent, neutrals, radius, shadows, type. Highest leverage:
   changes every screen at once with no structural risk. *(Contrast re-verified
   per DESIGN.md §1, including the dark-mode accent trap.)*
2. **Shell** — `AppIconRail` + `PageShell` primitives; 7-item IA with section
   sub-nav.
3. **Sheet infrastructure** — `DetailSheet` / `ResponsiveSheet` + URL binding.
4. **Convert the CRM core** — Companies, Contacts, Opportunities: tables to the
   shared data-table, create + detail to sheets.
5. **Convert the rest** — remaining lists, then dashboard, then settings.
6. **Carbon migration** — mechanical sweep + lint ban on Lucide.

## Test matrix

Typecheck · lint (incl. design-law rules) · unit (Vitest) · e2e (Playwright,
existing specs must stay green) · axe pass on rail/shell/sheet · manual dark-mode
and keyboard walk of every converted surface · live demo verification.

## Edge cases

- Sheet open while the underlying list refetches → the sheet must not unmount.
- Deep-link straight to an open sheet with no list loaded yet → list renders
  behind, sheet resolves independently.
- `prefers-reduced-motion` → sheet appears without slide.
- Rail on narrow viewports → left `Sheet`, focus trapped, Esc closes.
- A destination absorbed into a section must keep its old URL working (redirect,
  never a 404).

## Risks

Concurrent sessions on this branch (observed mid-work) — a full-app refactor
collides badly, so conversion runs in a worktree or when the branch is
demonstrably idle. Carbon migration is the regression hotspot. Sheet conversion
of heavy detail pages is the scope hotspot.
