# AppFlowy "Collaborate" workspace — embed, deploy, caveats

The Collaborate section (`/workspace`) embeds an external AppFlowy instance in an
iframe. It is an **embed boundary, not a data-integrated module**. Gated per-org
by `OrgSettings.appModules` (admin toggle in Settings → Modules).

## What was built (in-repo)
- `OrgSettings.appModules` JSON: `{ agentStudioEnabled, appflowyEnabled, appflowyUrl }`.
- `GET/PUT /api/v1/org-settings/app-modules` (read = `settings:read`; write = `settings:write` + `admin`, audited).
- Settings → **Modules** (admin) toggles agent-studio visibility + enables Collaborate + sets the AppFlowy URL.
- A **Collaborate** nav item (under Workspace) + `/workspace` page that iframes `appflowyUrl` when enabled, else a setup state. Nav items are hidden until their module is enabled (`isNavItemVisible`).
- agent-studio is now **hidden by default**; an admin enables it in Settings → Modules.

## Operator steps (NOT done in-repo — required to make Collaborate functional)
1. **Deploy AppFlowy.** Either self-host `appflowy-cloud` (Rust backend + Postgres + Redis + GoTrue + S3 + the `appflowy-web` client) or use a hosted AppFlowy. Get a URL that renders the workspace UI.
2. **Allow embedding.** AppFlowy must send framing headers that permit BidStack's origin — set `Content-Security-Policy: frame-ancestors <bidstack-origin>` (and no blocking `X-Frame-Options: DENY`) on the AppFlowy web client. Without this the iframe renders blank.
3. **Set the URL.** Admin pastes it in Settings → Modules and enables Collaborate.
4. **SSO (separate project).** AppFlowy authenticates via its own GoTrue, not Clerk. Users will log in to AppFlowy separately unless an SSO bridge (e.g. GoTrue OIDC ↔ Clerk) is built. Not in scope here.

## ⚠️ Legal + governance (confirm with PO/legal BEFORE enabling)
- **AGPL-3.0.** AppFlowy (incl. `appflowy-cloud`) is AGPL-3.0. Self-hosting/modifying and offering it over a network triggers source-disclosure obligations for the combined/served work. For a proprietary commercial product this is a material decision — get sign-off.
- **Data governance.** Collaborative content created in AppFlowy lives in **AppFlowy's data store**, outside BidStack's Postgres, Clerk tenancy, RBAC, audit log, and GDPR export/erasure tooling. Mantu account/client content placed there leaves your governed data plane.

## Why not native?
BidStack already has a Y.js CRDT collaborative stack (`YjsDocument`/`YjsUpdate`, `UserPresence`, `Comment`/`Mention`, `CollaborativeRichTextEditor`). A native collaborative-docs section on that stack would be fully integrated (Clerk auth, org RBAC, your DB, the design system) with no second platform, SSO bridge, or AGPL exposure. Recorded here because the embed path was an explicit product decision; revisit if the governance/SSO cost proves high.
