/**
 * SSRF guard.
 *
 * The implementation now lives in `@bidstack/shared` (`utils/ssrf.ts`) so the API
 * routes and the worker — which cannot import from `apps/api` — share one source
 * of truth. Re-exported here so existing `../lib/ssrf-guard.js` imports keep working.
 *
 * Use `isPublicHostname` before storing or fetching any user-supplied URL to
 * prevent Server-Side Request Forgery (SSRF) attacks against internal services.
 *
 * @example
 * ```ts
 * if (!isPublicHostname(new URL(userUrl).hostname)) {
 *   throw new Error('URL must not point to an internal address');
 * }
 * ```
 */
export { isPublicHostname, assertPublicHttpUrl } from '@bidstack/shared';
