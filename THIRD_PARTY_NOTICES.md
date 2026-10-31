# Third-party notices

Polo vendors a small amount of third-party UI source code. Each entry lists
what was taken, where it lives in this repo, how it was installed, and the
licence it is used under. npm dependencies keep their own licence files in
`node_modules`; only vendored source and UI-defining packages are listed here.

## bklit-ui (charts)

- Source: https://github.com/uixmat/bklit-ui (`packages/ui`, registry at https://bklit.com/r), commit 924e793
- Taken: chart primitives in `apps/web/src/components/charts/` (area, line, bar,
  ring, funnel, pie, sankey, grid, axes, tooltip and their helpers),
  `apps/web/src/components/shimmering-text.tsx`
- Install route: `shadcn add @bklit/<chart>` (registry in `apps/web/components.json`).
  The first batch (funnel, pie, sankey and shared helpers) arrived in 9caeefb9;
  area/line/bar/ring/sparkline arrived with this notice.
- Polo changes: `sparkline.tsx` renamed `bklit-sparkline.tsx` (case clash with
  Polo's `Sparkline.tsx`); React 18 `RefObject` casts; a post-render ref sync for
  the react-hooks lint rules; colours come from Polo tokens (`--chart-*` in
  `src/index.css`) through `src/components/viz/bklit-adapters.tsx`.
- Not taken: anything from `packages/studio`, which is under the separate,
  all-rights-reserved Bklit Studio License (`LICENSE-STUDIO.md`).
- Licence: MIT

```
MIT License

Copyright (c) 2026 uixmat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## thinking-orbs (animated orbs)

- Source: https://orbs.jakubantalik.com, https://github.com/Jakubantalik/Libraries.dev (`packages/thinking-orbs`)
- Taken: npm package `thinking-orbs@^0.3.2` (dependency, not vendored source),
  wrapped by `apps/web/src/components/viz/PulseOrb.tsx` as the watchdog /
  account-health pulse (dashboard hero, account header)
- Polo changes: none to the package; the wrapper maps health to orb state and a
  Polo token colour, hides it from assistive tech (adjacent text carries the
  meaning) and pauses it under `prefers-reduced-motion`
- Licence: MIT, Copyright (c) 2026 Jakub Antalik (full text ships in
  `node_modules/thinking-orbs/LICENSE`; same MIT terms as above)

## kokonutui (animated components)

- Source: https://kokonutui.com, https://github.com/kokonut-labs/kokonutui, commit 4d497b7
- Taken: `ai-text-loading`, `command-button`, `smooth-tab` into
  `apps/web/src/components/kokonutui/`
- Install route: `shadcn add @kokonutui/<name>` (registry in `apps/web/components.json`)
- Polo changes: React 18 typings (no `<style href precedence>`, `inert` spread,
  index guards), post-render ref sync and lazy platform read for the
  react-hooks lint rules, Polo tokens instead of zinc + `dark:` variants,
  a `tone="primary"` on CommandButton, SmoothTab without its own border
  (it sits inside a Polo card), `document.fonts` guarded.
- Used for: Generate brief (CommandButton, Shift+B), brief generating state
  (AITextLoading), dashboard Performance card (SmoothTab).
- Considered, not used: `notification-stack` for "Needs you" (it collapses items
  behind each other, which hides work the list exists to show).
- Licence: MIT, Copyright (c) 2025 kokonutUI (same MIT terms as above)
