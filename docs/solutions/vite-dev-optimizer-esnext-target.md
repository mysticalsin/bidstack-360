# Vite Dev Optimizer: Modern Dependency Target

Date: 2026-06-13

## Problem

Local `pnpm --filter @bidstack/web dev` can fail during Vite dependency optimization when modern dependencies contain syntax esbuild refuses to transform to the configured legacy optimizer target.

Observed error shape:

```text
Transforming destructuring to the configured target environment ... is not supported yet
```

The failure surfaced through route-only dependencies such as motion, Sentry, Tiptap, ProseMirror, Recharts, and related packages.

## Cause

Vite dev dependency optimization does not automatically inherit the production build target. The app can build, but the dev prebundler can still attempt an older transform target and fail before the UI is usable.

## Fix

Set the dependency optimizer esbuild target to native modern syntax in `apps/web/vite.config.ts`:

```ts
optimizeDeps: {
  esbuildOptions: {
    target: 'esnext',
  },
},
```

## Verification

- Restart web dev server with a forced optimizer refresh.
- Confirm `http://localhost:5173/dashboard` returns `200`.
- Confirm fresh web dev logs no longer contain optimizer transform failures.
- Run `pnpm --filter @bidstack/web build` to ensure production remains green.
