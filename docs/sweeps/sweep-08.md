# Sweep 08 — auth, session, and roles

Lens: login, stub login, factor-two, logout, session expiry and refresh, multiple tabs, a role change mid-session, member versus admin versus owner on settings, import, export, delete, and integration actions, the demo-data toggle, CSRF and same-site cookies, and login rate limiting.

Date: 2026-11-21. Base: `main` at `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.

Stack: PostgreSQL 16 and Redis on this VM. Database `bidstack`, synthetic seed (`pnpm db:seed`, org Mantu, Jane Smith). No Clerk key, no provider keys, no deploy, no `polo-preview` process, no R2. The API listened on `127.0.0.1:4000` in stub mode. The web app listened on `127.0.0.1:38081`. Browser checks used that origin at 1280×900, 820×900, and 390×844.

There is no separate Owner role. `settings:write` is the org-admin override and the seed grants it to Admin only. Jane Smith is that Admin. Seller roles below are Account Executive, SDR, Sales Manager, and Customer Success.

## Fixed

### 1. High — a seller can mint an org API key, install a plugin, and tear down Slack

`integrations:write` is the grant those seller roles hold so they can send mail and SMS. `POST /api/v1/integrations/api-keys` used only that grant and accepted `scopes: ["settings:write"]` with `readOnly: false`. `POST /api/v1/plugins` and `DELETE /api/v1/integrations/slack/disconnect` used it too. Slack disconnect deletes `SlackWorkspace` by org id. The OAuth callback upserts that same row, so starting the handoff replaces the org bot.

Dust credential routes already require the Admin role as well. These did not.

Red, on an isolated org: Account Executive received 201 for the key, 201 for the plugin, and 204 for Slack disconnect. The workspace row was gone.

- PR: https://github.com/mysticalsin/bidstack-360/pull/422
- Head: `7c46e2fd430525c87339d818b893bfb6a9c69997`
- Tests: `apps/api/src/routes/integrations/org-admin-actions.authz.integration.test.ts` and `slack.disconnect.integration.test.ts`. 8 passed. Sellers are 403. An admin can create the key and the seller cannot revoke it. A dust resync is still 202.

On the running API the Account Executive call returned `Requires one of: admin`. A read-only caller is still stopped at `integrations:write`.

### 2. High — stub auth treated a network browser as localhost

Stub auth checks `req.ip` for loopback. The dev server was bound on every interface and proxied `/api` from its own loopback socket. `GET http://172.30.0.2:38081/api/v1/me` returned 200 as `jane.smith@mantu.com`.

Production still refuses to boot stub auth. This is the local dev server.

Red: `GET /api/v1/me` with a loopback socket and `X-Forwarded-For: 203.0.113.8` returned 200.

- PR: https://github.com/mysticalsin/bidstack-360/pull/424
- Head: `df6600569543a089193c7b19efa7eac05861fa5a`
- Tests: `apps/api/src/plugins/auth.stub-forwarded.integration.test.ts` and `auth.test.ts`. 20 passed. The public forwarded address is 403 and the body does not contain that address. Loopback with no header, and `X-Forwarded-For: 127.0.0.1`, stay 200.

After the dev server restart, the same public forwarded address against `127.0.0.1:4000` was 403. `http://127.0.0.1:38081/api/v1/me` was 200 as Jane Smith. `http://172.30.0.2:38081` did not connect.

### 3. Medium — Sign out did not leave the other tab

Sign out writes the session marker in the tab that clicked it. The stub and demo providers did not listen. Two dashboard tabs, desktop width. Sign out in one. The other stayed on `/dashboard` with Jane Smith and the Sign out button. `localStorage` already had `bidstack:stub-signed-out=true` and no session marker. A reload of that tab did go to `/login`.

Stub auth has no server session, so the open tab kept receiving the seed workspace.

- PR: https://github.com/mysticalsin/bidstack-360/pull/423
- Head: `21b4f0f3c24cfa3dadac9fa960ce70ef176b4a04`
- Tests: `apps/web/src/lib/auth.test.tsx`. 16 passed. After the fix, the other tab's URL was `/login`, Enter workspace was shown, and the demo banner and Sign out button were gone.

## Duplicates

| # | What this sweep saw | Status |
| --- | --- | --- |
| 4 | CSV start with a valid one-row body. Account Executive, Read-only, Sales Manager, and Manager received 403 `Requires permission: settings:write`. Admin received 201. The preHandler on `migrationRoutes` already enforces that for every non-GET. | Open PR #383 also declares `config.permission: settings:write` on those routes. Not edited again. |
| 5 | `/login` is outside the CRM shell. `/login/factor-two` and `/book/test-slug` render inside it: demo banner, Jane Smith, navigation, Jarvis. `App.tsx` treats only the exact path `/login` and `/sign/` as shell-less. | Open PR #392. Not edited again. |
| 6 | Sign out is in the top bar at 1280×900. At 820×900 and 390×844 the button is not in the tree. `.tb-signout { display: none }` covers both the phone rule and the 768–900px rule. | Open PR #402. Not edited again. |
| 7 | Identity settings show Data mode as a badge, Demo, with no switch. There is no demo-data toggle route on `main`. The nav item is admin-only. Tony's card t1804s7435 is the server-enforced switch, hidden from members. | Open PR #364. Sweep 03 also pointed at #367 for the runtime-mode gate. Not edited again. |
| 8 | Caller-supplied email click `?url=` copied into `Location`. | Open PR #387. Login and OAuth redirects use fixed paths (`/dashboard`, `PUBLIC_BASE_URL`). Not reopened. |

## Checked, no new defect

- Role change mid-session. Jane's Admin `UserRole` was revoked through `DELETE /api/v1/users/:id/roles/:roleId` (204). The next `POST /api/v1/integrations/api-keys`, with no role header, was 403 `Requires permission: integrations:write`. The grant was restored and `GET /api/v1/org-settings/locale` was 200 again. The RBAC decision cache does not keep the old allow. Clerk org-admins are re-granted the Admin role on the auth-cache miss (`ensureAdminRoleGrant`). That is the Clerk source of truth, not an in-app demotion that sticks. This run had no Clerk key, so that path was not exercised live.
- Settings, export, delete. `PUT /api/v1/org-settings/locale` was 200 for admin and 403 `settings:write` for Account Executive. `POST /api/v1/orgs/:orgId/export` was 201 for admin and 403 for Account Executive and Read-only. `DELETE /api/v1/companies/:id` was 204 for admin and 403 `companies:write` for Account Executive and Read-only. The deleted synthetic company row was restored.
- Login rate limit. `POST /api/v1/demo/session` declares `rateLimit: { max: 5, timeWindow: '1 minute' }` and is mounted only when `DEMO_MODE=true`. This API was in stub mode, so that route was not mounted. The same route config under the global limiter (dev max 10,000, `skipOnError: true`) returned 200 five times and 429 twice for one client address. There is no password login on this API. Stub sign-in is a local button, not a POST.
- CSRF and cookies. The only cookie on the origin was `bidstack-locale=en-US`. The language switcher sets `SameSite=Lax`. API auth is `Authorization: Bearer` or `x-api-key`. No session cookie is set by the API. A cross-site page cannot attach the bearer.
- Session expiry. Demo tokens are 7 days and `verifyDemoToken` rejects an expired token on the request path. The client clears a 401. This run did not wait out a 7-day token. Stub sessions do not expire. That is the local door, and finding 2 keeps it on localhost.
- Factor-two as a Clerk step was not executed. There is no Clerk key. The route still mounts inside the shell, which is finding 5.
- Owner versus admin versus member on the actions above is the Admin role versus the seller roles versus Read-only. Read-only is 403 on the writes. Sellers are 403 on settings, import, export, company delete, and, after #422, on org API keys, plugins, and Slack. They can still request a dust resync.

`polo-preview` was not started and was not edited.
