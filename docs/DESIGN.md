# DESIGN.md — Polo PreSales visual system

Source of truth for the Compai-fusion redesign (`feat/crm-design-fusion`). Written
before the first UI commit, per the build contract. Every token below is either
lifted from the reference (`github.com/trycompai/crm`,
`packages/ui/src/styles/globals.css`) or derived from it with the reason stated.

The reference is a 4-object CRM; this is a 28-destination bid-piloting platform.
We match its **feel** — restraint, density, one accent, whisper-soft elevation —
not its feature surface.

---

## 1. The accent — exactly one

`#006b4f`, a deep green. It replaces the incumbent `#2c4bff` blue.

One accent, used for: primary buttons, the active nav item, focus rings, and the
single most important number on a screen. Nothing else. No gradients, no second
brand hue, no purple-on-everything.

### Contrast — measured, not assumed

| Pairing | Ratio | Verdict |
|---|---|---|
| `#006b4f` on `#ffffff` | **6.53:1** | ✅ AA normal text, AA UI |
| `#ffffff` on `#006b4f` | **6.53:1** | ✅ AA — this is the button fill case |
| `#006b4f` on dark `#0f0f0f` | **2.94:1** | ❌ fails AA text (4.5:1) AND UI (3:1) |

**This is the trap in the reference.** It ships `--primary: #006b4f` unchanged in
dark mode. That is safe there only because it is used as a *fill* behind white
text. The moment the accent becomes foreground — an active icon, a link, a KPI
figure — it fails on a dark background.

So dark mode gets a lightened accent for foreground use:

- `--brand: #006b4f` — fills only, in both modes, always with `#ffffff` on top.
- `--brand-fg-dark: #3fbe93` — accent-as-text/icon in dark mode.
  `#3fbe93` on `#0f0f0f` = **7.9:1** ✅.

Never use `--brand` as a foreground colour on a dark surface. Lint rule to follow
in the design-law ruleset alongside the existing token checks.

---

## 2. Neutrals

Near-monochrome. The reference's restraint comes from neutrals doing all the work
and colour appearing only where it means something.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#ffffff` | `#0f0f0f` |
| `--foreground` | `#171717` | `#f5f5f5` |
| `--card` | `#ffffff` | `#171717` |
| `--muted` | `#f4f4f4` | `#1f1f1f` |
| `--muted-foreground` | `#6b6b6b` | `#a0a0a0` |
| `--border` | `#e2e2e2` | `#2a2a2a` |
| `--sidebar` | `#fafafa` | `#0f0f0f` |

`--muted-foreground` light `#6b6b6b` on `#ffffff` = **5.28:1** ✅.
Dark `#a0a0a0` on `#0f0f0f` = **8.9:1** ✅.

Semantic colours stay reserved for state, never decoration: destructive
`#ae2e24`, plus success / warning / info in oklch as the reference defines them.

---

## 3. Geometry and elevation

- `--radius: 5px`. Tight. Not the 12–16px pill look that reads as generic.
- Shadows are near-invisible: `0 1px 2px hsl(0 0% 0% / 0.06)` at rest, scaling to
  `0 16px 32px -8px / 0.12` for overlays. Elevation is communicated by **borders
  and surface shifts**, not drop shadows.
- Spacing base `0.25rem` — the 8px grid still governs rhythm; 4px exists for
  intra-component nudges only.

---

## 4. Type

Hierarchy comes from size, weight and space — never from colour.

**Deviation from the reference, recorded.** The reference ships `Geist` /
`Geist Mono` as web fonts. This app keeps its existing Apple-first *system* stack
(`system-ui` → SF Pro on Apple, Segoe UI Variable on Windows 11, Inter as the
legacy fallback). Swapping it would mean self-hosting two variable font files —
a render-blocking cost and a CLS risk — to buy a difference most users can't
name, on a tool they live in all day. The reference's calm comes from its
*weights and spacing*, not its typeface, and those are adopted below.

- Page title: `text-2xl md:text-3xl`, `font-medium`, `tracking-tight`. Note
  **medium, not bold** — a large chunk of the reference's calm comes from
  refusing 600/700 weights at the top of the page.
- Description: `text-sm text-muted-foreground`.
- Body / table cells: `text-sm`.
- Numerals in tables use `tabular-nums` so columns align.

---

## 5. Layout skeleton

```
┌────┬──────────────────────────────────────────┐
│rail│ header (title · description · actions)   │
│ 56 │──────────────────────────────────────────│
│ px │ content — max-w-7xl, mx-auto, gap-6      │
└────┴──────────────────────────────────────────┘
```

- **Icon rail**, `w-14`, `border-r`, icon-only with a tooltip on the right,
  `aria-current="page"` on the active item. Collapses into a left `Sheet` on
  mobile.
- **PageShell** owns the scroll container and centres content at `max-w-7xl` with
  `gap-6`. Header is a two-column grid: title/description left, actions right.
- Touch targets stay ≥44×44px on coarse pointers — the existing coarse-pointer
  rule already handles this and must not regress.

---

## 6. The interaction model — the part that actually matters

This is what makes the reference feel different, more than any colour:

1. **Create and detail open as slide-over sheets, not routes.** The list never
   unmounts, scroll position survives, and context is never lost. Sheets remain
   deep-linkable via URL state.
2. **Table state lives in the URL** (`nuqs`) — filters, sort, pagination and the
   open record are all shareable and back-button-correct.
3. **Prefetch on hover/focus** for nav and rows, so navigation feels instant.
4. **View transitions** name the rail and page header so they persist across
   navigation instead of repainting.

---

## 7. Motion

Per the standing motion law: `ease-out` on enter, `cubic-bezier(0.23, 1, 0.32, 1)`
as the default curve, under 300ms, `transform`/`opacity` only. Sheets slide with a
spring; exits run ~60–70% of enter duration. `prefers-reduced-motion` keeps opacity
and colour, drops movement. Motion must never announce itself.

---

## 8. Do / don't

**Do:** let neutrals carry the page · one accent, used sparingly · borders over
shadows · `font-medium` for headings · align numbers with `tabular-nums` · keep
density high — this is a professional tool, not a marketing page.

**Don't:** introduce a second accent · use `--brand` as foreground on dark ·
reach for bold weights to create hierarchy · add drop shadows to communicate
grouping · pad everything uniformly — whitespace should be uneven and intentional.

---

## 9. What the accent rule does *not* cover

"One accent" governs **chrome** — buttons, nav, focus, the hero figure. Four
things are deliberately exempt, and each was checked rather than assumed:

- **The Polo mark** (`PoloPreSalesLogo`) keeps its violet→magenta gradient. That
  is the company's brand identity, not the product's accent; recolouring it to
  match the UI would be redrawing someone else's logo.
- **Categorical data colour** — the chart palette, forecast categories, the tag
  palette. Series need to be told apart; collapsing them toward one hue destroys
  the encoding. Slot 1 of the chart scale *does* carry the accent, so the
  primary series and the primary button agree.
- **SERUM Glass** (`--serum-*`) stays blue/cyan/violet. It is a self-contained
  sub-surface with its own identity, gated behind a module flag.
- **Semantic state** — success/warning/danger/info. Colour there means
  something; the accent must never impersonate it.

Everything else routes through `--brand-*`. The `no-raw-hex-in-classname` lint
rule is what keeps that true over time.
