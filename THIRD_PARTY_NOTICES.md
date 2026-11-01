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

## motion-primitives (the MIT origin of the 21st.dev listings used)

- Source: https://github.com/ibelick/motion-primitives, commit 120f64f
  (also listed on https://21st.dev; vendored from origin because the 21st
  install route needs an API key)
- Taken: `animated-number`, `border-trail` into
  `apps/web/src/components/motion-primitives/`
- Polo changes: no `motion.create()` in render, `format` prop, count-up from 0,
  sr-only final value with aria-hidden digits, instant under reduced motion;
  BorderTrail uses the brand token, is aria-hidden and is not rendered under
  reduced motion.
- Used for: dashboard hero numbers and account header key numbers
  (AnimatedNumber); the brief "generating" panel (BorderTrail).
- Considered, not used: `animated-group` (the Needs-you list already staggers
  with a CSS `--i` delay; a second motion layer adds weight, not clarity).
- Licence: MIT
- v21: also took `transition-panel` (same commit, MIT) into
  `apps/web/src/components/motion-primitives/transition-panel.tsx` for the
  account pulse driver drill and the timeline detail. Polo changes: default
  variants are a 6px rise with opacity, 200ms on the Polo easing, and a plain
  instant fade under reduced motion. Considered, not used: `sliding-number`
  (needs react-use-measure, a new dependency for one digit effect).
- v21 also considered kokonutui `metric-card` (MIT, 4d497b7) and deferred it:
  867 lines for a card the pulse hero already covers with AnimatedNumber and
  the bklit AreaSparkline.

```
MIT License

Copyright (c) 2024 ibelick

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

## React Flow (@xyflow/react 12.12.0, @xyflow/system 0.0.83)

- Source: https://github.com/xyflow/xyflow (npm @xyflow/react)
- Used for: account org chart canvas (pan/zoom, nodes, curved edges, mini-map), apps/web/src/pages/accounts/OrgChartPage.tsx
- Dependencies: zustand (MIT), classcat (MIT), d3-zoom/d3-drag/d3-selection/d3-interpolate/d3-timer/d3-color v3 (ISC), d3-ease (BSD-3-Clause). All permissive; no copyleft.
- Licence: MIT, Copyright (c) 2019-2025 webkid GmbH (same MIT terms as above)
- Note: the "React Flow" attribution badge is hidden via proOptions; the MIT licence allows this (xyflow asks commercial users to consider a Pro subscription, it is not a licence condition).

## dagre (@dagrejs/dagre 3.1.3, @dagrejs/graphlib 4.0.6)

- Source: https://github.com/dagrejs/dagre
- Used for: top-down tree layout of the org chart, apps/web/src/lib/orgchart/layout.ts
- Licence: MIT, Copyright (c) 2012-2014 Chris Pettitt (same MIT terms as above)
