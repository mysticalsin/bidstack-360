# ADR 0002 — Design tokens: brand, geometry, and vocabulary discipline

Date: 2026-08-03 · Status: Accepted · Supersedes: nothing (amends `DESIGN.md` direction)
Evidence: `D:\CRM\docs\BIDSTACK-FUSION-VALIDATION.md` (Amendment 2, ruling O2, challenges S1/S2)

## Decision 1 — Keep BidStack's brand blues

We keep `--brand-primary: #2c4bff` (light) and the elevated dark value, and do NOT
import the CRM's `#006b4f` green. The validation doc measured `#006b4f` on `#0f0f0f`
at **2.94:1** — below the 3:1 floor of WCAG 2.2 SC 1.4.11 for UI boundaries. A
primary button you cannot locate fails AA even when its white label reads at 6.53:1.

## Decision 2 — Theme-invariant geometry and material

Dark mode changes **colour, never shape**. Radius, borders, shadows-as-material,
blur, and glow are identical in both themes; every visual difference flows through
token *values* (`--surface-card`, `--shadow-*`, `--border-*`). Removed in this ADR's
implementing change: `dark:rounded-*` morphs (Card, Button, Toast, Input, Dialog),
`dark:backdrop-blur-*` glass swaps, `dark:inner-glow`, glow box-shadows, and the
dark-only 999px sidebar pill + hidden active rail. Calibrated against the CRM's
rhythm (one radius scale, restrained 1–2px low-opacity shadows) — rhythm only;
no names, no colours were copied.

## Decision 3 — Token value changes only, never renames

Any palette or surface adjustment edits the *value* of an existing token in
`apps/web/src/index.css`. Renaming is forbidden: value-only changes keep the blast
radius at one revertible commit instead of a 236-file sweep (validation ruling O2).

## Decision 4 — No second vocabulary

BidStack's token names (`--surface-*`, `--fg-*`, `--brand-*`, `--border-*`,
`--danger`, `--success`) are the only legal spellings. shadcn semantic classes
(`bg-card`, `text-muted-foreground`, `bg-popover`, `border-input`, `bg-accent`)
must not enter `apps/web` — grafted CRM components get rewritten to BidStack names
at import time (validation challenge S2).

## Decision 5 — Contrast floor: 3:1 for UI boundaries

Every interactive boundary token must measure ≥3:1 against its ground in both
themes. Measured for this ADR (WCAG relative luminance):

| Token | Ground | Ratio |
|---|---|---|
| `--brand-primary` light `#2c4bff` | `#ffffff` card | 5.90:1 |
| `--brand-primary` dark `#5e6ad2` | `#0c0c0e` card | 4.16:1 |
| `--danger` light `#b82032` | `#ffffff` | 6.38:1 |
| `--danger` dark `#fb7185` | `#0c0c0e` | 7.26:1 |
| Rejected CRM `#006b4f` | `#0f0f0f` | **2.94:1** ✗ |

No danger-token lift was needed; both themes already clear the floor.

Note: the dark brand in code is `#5e6ad2`, not the `#5B7FFF` the validation doc
quotes from `DESIGN.md` (5.38:1 on `#0D0F1A`). Both pass; reconciling code vs
`DESIGN.md` is deferred to the DESIGN.md v2 amendment (validation Amendment 4).
