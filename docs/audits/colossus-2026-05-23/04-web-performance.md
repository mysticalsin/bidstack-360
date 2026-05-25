# Web Performance Audit

> Scope: `apps/web` bundle, entry point, lazy loading, timers, images, PWA.
> Date: 2026-05-23

## Bundle Analysis

Largest emitted chunks (`pnpm build` tail):

| Chunk | Raw | Gzip | Notes |
|---|---|---|---|
| `motion-D7ySERch.js` | 260.44 kB | 85.21 kB | framer-motion aggregate |
| `index-DtcJSTmB.js` | 170.29 kB | 46.52 kB | **Entry chunk** (main.tsx → App.tsx) |
| `vendor-gNPkRDay.js` | 133.01 kB | 46.89 kB | Catch-all vendor bucket |
| `react-dom-Cf8ZQ_rp.js` | 130.44 kB | 41.80 kB | React DOM |
| `DashboardPage-CKNErJ5F.js` | 95.85 kB | 25.93 kB | Heaviest route chunk |
| `clerk-CGLfyfss.js` | 95.40 kB | 24.61 kB | @clerk/* family |
| `TerritoriesPage-BW0tEeWQ.js` | 84.70 kB | 26.90 kB | Geo/map deps (lazy) |
| `zod-DjIe02Na.js` | 54.01 kB | 12.32 kB | Validation lib |
| `SettingsPage-DVJMTCux.js` | 47.03 kB | 11.37 kB | Settings UI |
| `radix-BUCJJbxP.js` | 42.73 kB | 13.92 kB | @radix-ui primitives |

## Summary

- **Entry chunk size:** 170 kB raw / **46.5 kB gzipped**
- **Total eager payload (estimated):** ~300 kB gzipped (index + react-dom + vendor + motion + clerk + radix + tanstack + zod + sentry + router)
- **Lazy-loaded routes:** 40
- **useEffect count:** 52 (potential re-render issues)
- **setInterval/Timeout without cleanup:** 1 confirmed (`ApiKeysSection.tsx` event handler)
- **Top risk:** Eager first-party JS payload >300 KB gzipped blocks FCP/LCP before any route renders.

## Findings

| Severity | File / Chunk | Issue | Evidence | Fix |
|---|---|---|---|---|
| **Critical** | `index-DtcJSTmB.js` + eager vendor chunks | Entry payload bloat: ~300 KB gzipped of blocking JS on first paint. | `main.tsx` eagerly mounts `AuthProvider`, `QueryClientProvider`, `BrowserRouter`, `App`, plus all layout chrome (`AppShell`, `CommandPalette`, `Toaster`, etc.). Build shows motion (85KB), vendor (47KB), react-dom (42KB), clerk (25KB), and index (47KB) all load before first route chunk. | Defer non-critical deps: load Clerk via dynamic import when `publishableKey` is present (stub mode should pay zero bytes), lazy-load `CommandPalette`/`HelpDrawer`/`QuickAddMenu` until first interaction, and consider a server-component-like shell that streams layout. |
| **High** | `motion-D7ySERch.js` | Framer-motion chunk is 260 KB raw / 85 KB gzip — largest single file. | `App.tsx` imports `AnimatePresence` + `MotionConfig`; `PageTransition`, `RouteProgress`, `SavedFlash`, etc. pull in `motion`. Vite manualChunks isolates it, but it still blocks initial render. | Audit for `motion` vs `m` exports; replace simple fade/slide transitions with CSS `transition` + `opacity`/`transform` to shrink or eliminate the chunk. |
| **High** | `apps/web/index.html` | No `modulepreload` or `preload` hints for the entry module or critical CSS. | `index.html` has `preconnect` for Google Fonts, Clerk, and Sentry, but no `<link rel="modulepreload" href="/assets/index-…js">` or `prefetch` for likely next routes. | Add `modulepreload` for the entry JS and `prefetch` for high-probability routes (e.g., `/dashboard`). Verify `vite-plugin-pwa` or `rollup-plugin-html` injects preload links automatically. |
| **Medium** | `vite.config.ts` | PWA is hand-rolled, not using `vite-plugin-pwa`; no automatic chunk precaching. | `vite.config.ts` plugins: `react()`, `tailwindcss()`, `visualizer()` only. `public/sw.js` exists (88 lines) and `main.tsx:104` registers it manually, but Workbox precaching of emitted chunks is absent. | Add `vite-plugin-pwa` with `injectRegister: false` (keep manual SW registration) so the build pipeline generates a precache manifest for all lazy chunks and assets. |
| **Medium** | `DashboardPage-CKNErJ5F.js` | Heaviest route chunk at 96 KB raw / 26 KB gzip. | Dashboard is the default landing route after login. No sub-chunk split for widgets/tables/charts inside the page. | Introduce nested `React.lazy` boundaries for dashboard widgets (e.g., charts, recent-activity feeds) so the shell renders before heavy data-viz libs parse. |
| **Medium** | `apps/web/src/**/*.tsx` | `<img>` tags lack responsive images / modern formats. | Grep found 8+ `<img>` usages (`PageHead`, `CompanyLogo`, `Avatar`, `AccountsPage`, `CompanyDetailPage`, etc.). Only `SmartCompanyDialog.tsx:180` uses `loading="lazy" decoding="async"`. | Add `srcset` + `sizes` for all logos/avatars; serve WebP/AVIF with `<picture>` fallbacks; ensure `loading="lazy"` is on below-the-fold images. |
| **Low** | `ApiKeysSection.tsx:85` | `setTimeout` leak in event handler — calls `setCopied(false)` after 2 s with no cleanup. | `copySecret` handler: `setTimeout(() => setCopied(false), 2000);`. If the component unmounts before the timer fires, React 18 will silently drop the update, but it still wastes a macrotask slot. | Use `useRef` to store the timer ID and clear it in `useEffect` cleanup, or move the reset logic into a `useEffect` that watches `copied`. |
| **Low** | `apps/web/src` (52 files) | High `useEffect` density across the app. | 52 `useEffect` usages grep’d. Dense effects increase re-render surface area and risk stale closures or missing dep arrays. | Run an ESLint pass with `react-hooks/exhaustive-deps`; convert derived-state effects to memoized computations where possible. |
| **Low** | `zod-DjIe02Na.js` | Zod (54 KB raw / 12 KB gzip) may load eagerly if shared schemas are imported by layout components. | `manualChunks` isolates zod, but if `@/lib/api` or `@/lib/auth` imports a shared schema, the chunk joins the initial request waterfall. | Ensure validation schemas are co-located with route chunks only; never import zod schemas in `main.tsx`, `App.tsx`, or layout shells. |
| **Low** | `main.tsx:20-36` | Sentry chunk is split but still parsed/executed on boot. | `@sentry/react` and `@sentry/browser` are statically imported at the top of `main.tsx`. The `requestIdleCallback` wrapper defers `init()`, but the module is still in the critical path. | Load Sentry via `await import('@sentry/react')` inside the `requestIdleCallback` callback so the parser does not evaluate the chunk until the browser is truly idle. |

---
*End of audit. No files modified.*
