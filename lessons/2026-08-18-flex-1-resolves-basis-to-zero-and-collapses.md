---
title: flex-1 resolves flex-basis to 0 — next to an unshrinkable sibling it collapses to a character-per-line column
date: 2026-08-18
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, css, flexbox, ui, verification]
---

## Lesson — `min-w-0 flex-1` is a collapse waiting for a wide enough sibling

**Rule (ALWAYS):** When a flex child must shrink, give it a real **flex-basis**
(`basis-56`, `flex: 1 1 8rem`), not bare `flex-1`. And put `flex-wrap` on the row.
`flex-1` is shorthand for `flex: 1 1 0%` — a basis of **0** — which has two consequences
people rarely connect:

1. The child contributes **nothing** to the parent's wrap calculation, so a row that
   *could* have wrapped never does.
2. Every flex sibling defaults to `min-width: auto` and cannot shrink below its
   min-content width. The entire deficit therefore lands on the `flex-1` child — and
   `min-w-0`, added to "fix truncation", is precisely what lets it shrink to nearly zero.

The result is not a subtle misalignment. The box renders a few pixels wide and hundreds
tall, wrapping its text **one character per line**.

**What happened:** A user reported one page as "broken". It was: the opportunity title
rendered 5px × 242px, colliding with the toolbar — on *every* opportunity, at a normal
1600px desktop width. The header row was `flex flex-wrap justify-between` with
`min-w-0 flex-1` on the title and an action toolbar that measured 1140px at min-content.
The toolbar took 1140 of 1174px; the title got the 5px remainder.

Sweeping all 51 routes at 1600 / 1137 / 853 / 555 / 390px found **three more**, each with a
different unshrinkable sibling:

| surface | collapsed to | at | sibling that refused to shrink |
|---|---|---|---|
| OpportunityDetailPage | 5 × 242 | 1600px | action toolbar (min-content 1140px) |
| CalendarPage | 31 × 140 | 555px | 44px nav buttons + filter group, row had no `flex-wrap` |
| TaskRow | 36 × 216 | 390px | `shrink-0` reorder controls + trailing actions |
| KpiRow | 27 × 95 | 853px | fixed icon + badge column |

**Root cause of the *class* of bug:** `min-w-0 flex-1` reads like "let this shrink
gracefully". It actually means "let this absorb 100% of any shortfall, down to zero". It
is safe only while no sibling is wide — so it ships green and breaks later when someone
adds a button.

**How to apply:**
- Detect the **symptom**, not the pattern. Grepping for `flex-1` found 117 uses, almost all
  fine. A browser sweep flagging any text box with `width < 70 && height > 90 && height/width > 3`
  found the four real ones in minutes, and works regardless of which class caused it.
- Sweep at **several viewport widths**. Three of the four only appear below 900px; one only
  above 1500px. A single-width check finds none of them reliably.
- An inline `style={{ flex: 1 }}` **overrides** a class basis. KpiRow had the basis in CSS
  *and* a contradicting inline style; only removing the inline one worked.
- Regressions for layout belong in a **source-contract** test. happy-dom does not run flex
  layout, so asserting geometry in jsdom-family tests proves nothing — verify geometry in a
  real browser, then pin the classes that produce it and record the measured before/after
  in the test so a future "cleanup" cannot silently undo it.
- **Look at the screenshot.** Every automated check passed on these pages: routes rendered,
  headings present, zero console errors, no horizontal overflow. Only a rendered image
  showed the text stacked one letter per line.
