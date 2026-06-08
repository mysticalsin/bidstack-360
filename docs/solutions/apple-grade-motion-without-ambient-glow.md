# Apple-Grade Motion Without Ambient Glow

**Problem:** Enterprise CRM motion should make the app feel responsive, but automatic pulse, shimmer, and neon glow loops make dense workflows feel noisy and decorative.

**Fix:**

- Keep route progress GPU-friendly by animating `transform: scaleX` instead of width.
- Use tactile hover/press feedback on shared buttons, icon buttons, sidebar items, flyouts, and interactive cards.
- Do not attach continuous `pulse-glow` or `card-shimmer` classes to shared controls or shared card primitives.
- Keep dark-mode headline gradients static on CRM pages; avoid looping title animations.
- Use neutral elevation shadows for hover states. Reserve semantic purple for badges/status tones, not ambient motion.
- Respect `prefers-reduced-motion` and `data-motion="reduced"` for every shared motion path.

**Validation:**

- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web build`
- Browser smoke `/dashboard`, `/pipeline`, `/accounts`, `/opportunities`, `/settings`, `/integrations`
- Mobile browser smoke `/dashboard`, `/pipeline`, `/settings`

