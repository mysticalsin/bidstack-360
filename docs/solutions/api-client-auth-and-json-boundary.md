# API client auth and JSON boundary

**Problem:** BidStack's frontend API wrapper owns JSON serialization and always sends cookies, but production Clerk auth also needs a bearer token. Individual hooks had started passing `JSON.stringify(...)` into `api()`, which double-encoded mutation bodies and made admin/webhook/import flows fail at the API boundary.

**Fix:**

- Keep `api(path, opts)` as the single JSON serialization boundary.
- Add a module-level token provider (`setApiTokenProvider`) so the auth provider can supply Clerk `getToken()` without calling React hooks inside the API utility.
- In stub/dev mode, clear the token provider and keep `credentials: 'include'`.
- In Clerk mode, bridge `auth.getToken()` from the existing Clerk subtree into the API client and attach `Authorization: Bearer <token>` when available.
- Mutation hooks must pass plain objects to `body`; never pre-stringify.

**Why it works:** React hook order remains stable because Clerk hooks still live only inside the Clerk provider subtree, while the non-React API wrapper can still attach production auth. Keeping one serialization boundary prevents string bodies from being encoded twice.

**Validation:**

- Unit-test the wrapper with and without token providers.
- Unit-test representative mutation hooks to assert plain-object bodies.
- Run `pnpm --filter @bidstack/web typecheck`, targeted web tests, lint, build, and browser smoke for affected routes.

**Related UX note:** Premium table animation must not harm dense CRM scanning. Avoid dimming whole interactive rows during search; highlight matching rows with a subtle static background or left inset instead. Keep decorative table motion out of dense data surfaces unless explicitly gated by a user preference.
