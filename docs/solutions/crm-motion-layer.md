# CRM Motion Layer

**Problem:** BID/presales CRM dashboards need rich motion without becoming decorative noise or breaking dense enterprise layouts.

**Fix:** Use local motion primitives instead of installing one-off animation libraries:

- `AnimatedMetric` for count-up KPI/source values. Keep prefix, number, and suffix inside one no-wrap wrapper.
- `SpotlightSurface` for ReactBits-style cursor spotlight on account cards and dashboard stats.
- CSS-only rail, scan, sweep, sheen, and pulse keyframes for integration flow, mesh status, card hover, and health ring motion.
- Animated progress fills for platform pulse and pipeline-by-stage rows. Keep fill width controlled by CSS variables so data stays deterministic while the entrance animates.
- Staggered rows for business snapshot, risks/compliance, contacts, and recent opportunities.
- Framer Motion remains the controlled runtime for entry, hover, stagger, and reduced-motion-aware transitions.

**Why it works:** The CRM gets a premium animated feel while preserving accessibility, existing design tokens, and predictable bundle size. All animation routes are covered by `prefers-reduced-motion` and the app's `data-motion="reduced"` override.

**Validation:** Run `pnpm --filter @bidstack/web typecheck`, `pnpm --filter @bidstack/web lint`, `pnpm --filter @bidstack/web test`, `pnpm --filter @bidstack/web build`, `pnpm format:check`, then browser-smoke `/dashboard` and `/accounts/:id` for console errors and visual wrapping.
