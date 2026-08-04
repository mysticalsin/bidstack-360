# ADR 0005 — The dark brand is `#5e6ad2`. Code wins; the question is closed with numbers.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Tony Walteur (CTO), Frontend lead
- **Related:** ADR 0002 (design tokens — this settles the divergence it flagged),
  `apps/web/src/index.css`, `docs/design-system/DESIGN-v1-brand.md`,
  `docs/ROUND2-ULTRAPLAN.md` §"Where the judges split" item 4

## Context

Three documents named three things:

- The fusion validation (via `docs/design-system/DESIGN-v1-brand.md:66`) asserts
  the dark brand is `#5B7FFF` on a `#0D0F1A` ground (:68).
- The code has `--brand-primary: #5e6ad2` at `apps/web/src/index.css:195`, with
  `--surface-page: #010102` (:218) and `--surface-card: #0c0c0e` (:219).
- ADR 0002 already noticed the gap and deferred it: *"the dark brand in code is
  `#5e6ad2`, not the `#5B7FFF` the validation doc quotes… Both pass; reconciling
  code vs `DESIGN.md` is deferred"* (`docs/adr/0002-design-tokens.md:53-55`).

Round 2 writes new CSS across a table kit, a compliance strip, and three list
surfaces. An unresolved brand value is a coin flip repeated in every new file.

## The numbers

Computed for this ADR from the WCAG 2.2 definitions, not quoted. Relative
luminance: for each sRGB channel `c/255 → s`, `s ≤ 0.04045 ? s/12.92 :
((s+0.055)/1.055)^2.4`, then `L = 0.2126R + 0.7152G + 0.0722B`. Contrast ratio:
`(L_lighter + 0.05) / (L_darker + 0.05)`.

| Foreground | Ground | Ratio | Floor | Verdict |
|---|---|---|---|---|
| `--brand-primary` light `#2c4bff` | `--surface-card` `#ffffff` (:56) | **5.90:1** | 3:1 (SC 1.4.11) | pass |
| `--brand-primary` light `#2c4bff` | `--surface-page` `#fafbfd` (:55) | **5.70:1** | 3:1 | pass |
| `--brand-primary` dark `#5e6ad2` | `--surface-card` `#0c0c0e` (:219) | **4.16:1** | 3:1 | pass |
| `--brand-primary` dark `#5e6ad2` | `--surface-page` `#010102` (:218) | **4.44:1** | 3:1 | pass |
| asserted `#5B7FFF` | `#0c0c0e` | 5.51:1 | 3:1 | pass |
| asserted `#5B7FFF` | `#0D0F1A` (DESIGN-v1 ground) | 5.38:1 | 3:1 | pass |
| white label | `#2c4bff` fill (`Button.tsx:23`) | **5.90:1** | 4.5:1 (SC 1.4.3) | pass |
| white label | `#5e6ad2` fill | **4.70:1** | 4.5:1 | pass |
| rejected CRM green `#006b4f` | `#0f0f0f` | **2.94:1** | 3:1 | **fail** — the ADR 0002 ruling, re-derived |

Both candidate dark brands clear every applicable floor. `#5B7FFF` is brighter
(5.51 vs 4.16 on card) and neither is close to failing. There is no accessibility
argument between them, which is precisely why this had to be decided on
something other than accessibility.

## Decision — code wins

`--brand-primary: #2c4bff` (light, `index.css:35`) and `--brand-primary: #5e6ad2`
(dark, `index.css:195`) are law. `#5B7FFF` is not adopted.

Reasons, in order:

1. **Code is shipped and reviewed; the doc is not.** `#5e6ad2` is what every
   user has seen in dark mode, what the Round-1 screenshots baseline, and what
   the sibling tokens were tuned against — `--brand-primary-hover: #7882e7`
   (:196), `--brand-primary-press: #4d58ba` (:197),
   `--brand-primary-tint: rgba(94, 106, 210, 0.18)` (:198),
   `--brand-gradient-start/end` (:200-201). Adopting `#5B7FFF` means re-deriving
   five tokens and re-baselining the dark screenshots to satisfy a document.
2. **The amendment's substance is already satisfied.** The requirement was
   "theme-specific brand values that each pass WCAG". `#2c4bff` / `#5e6ad2`
   passes, measured above.
3. **The doc's ground does not exist — and neither does most of its dark
   table.** `DESIGN-v1-brand.md:62-78` lists `--surface-page: #0D0F1A`,
   `--surface-card: #161922`, `--surface-sidebar: #11131C`,
   `--fg-primary: #E8EAF0`; the code ships `#010102` (:218), `#0c0c0e` (:219),
   and `#f8fafc` (:229). The document describes a dark theme BidStack does not
   have. `#5B7FFF` was tuned against surfaces we do not ship, so it is not
   evidence about the theme we do ship — it is one row of a stale table.
4. **The failure this token system exists to prevent is a contrast failure**
   (ADR 0002 Decision 5, the `#006b4f` rejection). Neither candidate is one.
   With the safety question settled, the tie-break is blast radius, and blast
   radius says: change nothing.

`docs/design-system/DESIGN-v1-brand.md` is superseded on this row and updates to
`#5e6ad2` in the DESIGN v2 amendment. Until it does, this ADR is the answer.

## Alternatives considered

1. **Adopt `#5B7FFF` because the amendment says amendments override the plan.**
   Rejected — amendments override the *plan*, not the shipped product. The
   amendment's intent (each theme's brand passes WCAG) is met either way, so
   overriding buys a re-baseline and nothing else.
2. **Adopt `#5B7FFF` for the extra 1.35:1 of headroom.** Rejected — 4.16:1
   already clears the 3:1 UI floor with 39% margin, and the brighter blue would
   need `--brand-primary-hover` above `#7882e7`, which starts to lose the
   Linear-style restraint the dark theme was designed around.
3. **Introduce a third value that satisfies both documents.** Rejected — a
   compromise hex nobody chose, invalidating both the code baseline and the doc.
4. **Leave it undecided and let each new file pick.** Rejected — that is the
   current state, and it is what produced this ADR.

## Consequences

- **All new CSS and all new components write `var(--brand-primary)`.** No
  literal brand hex in a component, a class string, or a stylesheet. Theme
  switching stays a token-value change (ADR 0002 Decision 3), so the light/dark
  pair keeps working for free.
- **This is not fully machine-enforced, and the gap is named.**
  `bidstack-design/no-raw-hex-in-classname` is configured **`'warn'`**, not
  `'error'` (`eslint.config.js:171`, with the reason: pre-existing hex debt in
  login Hero/DemoSignIn and TerritoryPanels), and its pattern
  `/\[#[0-9a-fA-F]{3,8}\]/` (`packages/eslint-rules/design-law.js:84`) only
  matches Tailwind arbitrary-value syntax inside TS/TSX strings. A raw
  `#5e6ad2` written in a `.css` file is invisible to it. Round-2 discipline for
  new CSS is therefore review-enforced; the concrete follow-up is a CI grep for
  brand hex literals outside the two token blocks in `index.css`, and raising
  the lint rule to `'error'` once the named legacy files migrate.
- **Screenshot baselines and the Tailwind-stable diff stay valid.** Nothing
  changes visually, which is the point: the Phase-0 Tailwind bump can claim
  pixel-identical without a brand change confounding it.
- **Out-of-scope finding, recorded so it is not lost.** The dark primary button
  is a gradient, not a flat fill:
  `dark:bg-gradient-to-r dark:from-[var(--brand-gradient-start)] dark:to-[var(--brand-gradient-end)]`
  (`apps/web/src/components/ui/Button.tsx:23-24`), with
  `--brand-gradient-end: #7882e7` (`index.css:201`). White label text measures
  **4.70:1** at the gradient's start, **3.99:1** at its midpoint, and
  **3.42:1** at its end — below the 4.5:1 floor for normal text over the right
  portion of every dark primary button. This predates Round 2, is not caused by
  this decision, and is not fixed here (this ADR touches no code). It needs its
  own change: either darken `--brand-gradient-end` until white clears 4.5:1
  across the whole fill, or drop the gradient in favour of the flat
  `--brand-primary`. Filed as a follow-up rather than smuggled into a
  token-reconciliation ADR.

## Follow-ups

- `docs/design-system/DESIGN-v1-brand.md` → v2: the whole Dark Mode table
  (:62-78) re-derived from the live `[data-theme='dark']` block
  (`index.css:193-351`), not just the `--brand-primary`
  row. Every row there is currently wrong, which is a bigger doc-debt item than
  this ADR settles.
- CI grep for brand hex literals outside `index.css`'s theme blocks; raise
  `no-raw-hex-in-classname` to `'error'` after the legacy files migrate.
- Dark primary button gradient contrast (see above) — its own change, its own
  before/after measurement.
