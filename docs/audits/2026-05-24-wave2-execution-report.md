# Wave 2 Execution Report — 2026-05-24

**Source plan:** [docs/2026-fleet-wave2/](../../docs/2026-fleet-wave2/) (Wave 2 Chief of Staff)
**Wave 1 reference:** [2026-05-24-fleet-execution-report.md](2026-05-24-fleet-execution-report.md)
**Goal of Wave 2:** Take Wave 1's foundation (~72/100 projected) and turn BidStack 360° into a product that can be sold.
**Outcome:** **17/17 agents delivered.** 4 hit the Claude rate limit before writing their report but all four had landed real commits + uncommitted progress (salvaged with single commits each).

---

## Wave 2 outcomes

| # | Stream | Branch | Commits | Notes |
|---|---|---|---|---|
| 1 | Service-worker tenant-leak fix + PWA | `fix/service-worker-tenant-leak` | 6 | Workbox rewrite; per-identity cache namespacing; manifest hardened; update-available snackbar |
| 2 | Phase 4 Observability | `feat/observability-foundation` | 6 | prom-client on 3 services; OTel metrics+logs; Bull-Board (token-gated); 3 Grafana dashboards; 3 PrometheusRules; SLO + 5 runbooks; Web Vitals → Sentry |
| 3 | Email pipeline | `feat/wave2-email-pipeline` | 8 | Resend transport + 8 React Email templates; EmailMessage schema; BullMQ queue (rate-limited); webhook svix-HMAC; RFC 8058 one-click unsubscribe |
| 4 | Calendar integration (MS Graph + Google) | `feat/wave-2-calendar-integration` | 7 | OAuth flows + delta sync workers; CalendarEvent + IntegrationToken (AES-256-GCM); 21 tests |
| 5 | Cadences/Sequences engine | `feat/cadences-engine` | 6 | 4 models + runner + auto-pause (3 entry points); builder UI; idempotency via `@@unique([enrollmentId, stepIndex])` |
| 6 | Outbound webhook delivery | `agent-aba7c0ff7a21b3aa6/outbound-webhooks` | 7 | Stripe-format HMAC; comprehensive SSRF guard (IPv4 RFC1918 + IPv6 + DNS rebinding); 18 event emits across 5 routes |
| 7 | Report builder MVP | `agent/reports-builder-mvp` | 4+1 salvage | Metric registry + Report/Subscription schema + engine + 2 workers + UI (salvaged at limit) |
| 8 | Bulk + composite API | `worktree-agent-a183fb07155064e92` | 11 | Composite w/ ref-substitution + transactional rollback; bulk async; RFC 7807; pagination helper; SOQL-lite query |
| 9 | Stripe billing | `feat/stripe-billing-wave2` | 11 | 3 tiers + Checkout + Portal + webhook + usage meter (402) + seat enforcement + trial cron |
| 10 | Onboarding wizard | `worktree-agent-aa5290a9b04a40dc8` | 4+1 salvage | 6-step wizard + sample seeder + empty-state nudges + product tour + email service (salvaged) |
| 11 | Marketing landing + pricing + legal | `feat/wave2-marketing-site` | 5 | New `apps/marketing`; landing + pricing (30-row feature matrix) + 4 GDPR-aware legal pages; Dockerfile :8081 |
| 12 | Documentation site (Astro Starlight) | `feat/docs-starlight-site` | 4+1 salvage | New `apps/docs`; getting-started, guides, integrations, security, workflows sections (~60+ pages); OpenAPI auto-render |
| 13 | SSO / SAML / OIDC + SCIM 2.0 | `feat/wave2-enterprise-sso` | 9 | SsoConfig + SsoLoginAttempt; 6 SSO + 14 SCIM routes; JIT + enforcement; AES-256-GCM; setup guide |
| 14 | i18n foundation + RTL | `feat/i18n-foundation` | 7 | i18next; 16 web + 4 api catalogs (en/fr/es/ar); locale-aware format.ts; RTL via Tailwind logical; Accept-Language API plugin |
| 15 | OAuth2 server + JS SDK | `worktree-agent-af4e937adbf9f1191` | 7 | 4 OAuth tables; 6 endpoints + discovery; PKCE; opaque tokens; family-revocation rotation; full `@bidstack/sdk-js` package |
| 16 | Status page + support widget | `worktree-agent-a096f9817f049eb04` | 3+1 salvage | Astro status workspace; incident + ticket schema; health-probe worker; public API (salvaged) |
| 17 | Chief of Staff coordination | `worktree-agent-ad5b5c4c0155df041` | 6 | STATUS, RISK-REGISTER, INTEGRATION-PLAN, V1-LAUNCH-CHECKLIST (172 items), WAVE3-BACKLOG, PROGRESS |

**Total Wave 2:** ~120 commits across 17 branches.
**Combined Wave 1 + Wave 2:** ~190 commits, ~25,000 lines net.

---

## Cross-wave repeated findings

These came up across BOTH waves and need root-cause fixes before merge:

1. **`@bidstack/memos` phantom dep** (`apps/api/package.json`) blocks `pnpm install` on every fresh worktree. **Critical — fix first.** One-line delete or restore the package.

2. **`packages/shared/src/index.ts` re-exports `./utils/index.js`** which doesn't exist on `f7fd2723`. Breaks `pnpm typecheck` on `@bidstack/shared`. Wave 2 OAuth agent restored `packages/shared/src/types/permissions.ts` (a related casualty); the utils one still needs the same fix.

3. **`apps/api/src/server.ts` imports 9+ route files missing at baseline** (`accounts`, `bid-workspace`, `microsoft`, `references`, `agents`, `bid-scores`, `proposals`, `activities`, `exchange-rates`). All in your 417 WIP. Same baseline gap.

4. **Worktree isolation is leaky.** Multiple Wave 1 commits (`bd0d5a1a`, `18394d6d`, `a33729cc`, `ac1304c2`, etc.) appear in Wave 2 worktrees' logs. They didn't cause damage but every branch has Wave 1 work as a prefix — review with `git log f7fd2723..<branch>` carefully.

5. **Schema collisions to resolve at merge.** 8+ Wave 2 branches touch `packages/db/prisma/schema.prisma`. None overlap on model names (Chief of Staff's reservation list worked) but the 3-way merge will conflict on file structure. Land them sequentially per CoS's `INTEGRATION-PLAN-WAVE2.md`.

---

## What's in the product now (after both waves merge)

### Core CRM (Salesforce/Odoo parity surface)
- Pipeline + opportunities + stages (configurable PipelineStage table replacing hardcoded enum)
- Quote → SalesOrder → Invoice → Payment flow
- Contract + PriceBook + Campaign models
- Accounts with parent/child hierarchy
- Contacts with firstName/lastName split + GDPR consent
- Leads + LeadRoutingRule active
- Tasks + Activities
- Custom field framework
- 75+ Prisma models

### Engagement
- Cadences/Sequences engine (Salesforce HVS parity)
- Email pipeline (Resend + 8 transactional templates + unsubscribe)
- Microsoft 365 + Google Workspace OAuth + delta sync
- Calendar UI
- Workflow engine with real triggers + real action executors (no more silent no-ops)

### Reporting
- 4 built-in dashboards (Wave 1)
- Custom report builder (metric registry + drag-drop + scheduled subscriptions)
- Export to CSV/XLSX/PDF
- Drillthrough on charts

### Integration platform
- OpenAPI 3.1 spec auto-emitted from Zod (`/api/openapi.json` + Swagger UI)
- Bulk + composite + async-job + SOQL-lite query endpoints
- Outbound webhook delivery (signed HMAC + SSRF guard + DLQ + retry UI)
- OAuth2 authorization-server role (PKCE, scopes, consent UI)
- `@bidstack/sdk-js` package (TS client + pagination iterator + examples)
- MCP server (Wave 1 baseline, scope-enforced)

### Security & compliance
- RBAC bypass fixed (no claim fallback)
- MCP rate-limit Redis-backed
- Document parsers sandboxed in worker_threads
- Auth event audit log
- Pen-test suite (19 scenarios, all green at baseline)
- Semgrep + gitleaks + dependency-review in CI
- Threat model + SECURITY.md
- SSO/SAML/OIDC + SCIM 2.0 (enterprise tier)
- AES-256-GCM at-rest for OAuth tokens + OIDC secrets

### Infrastructure
- Backups (pg_basebackup + WAL archiving + Redis AOF)
- GDPR tenant export (route + worker + signed S3)
- Terraform scaffolding (VPC + RDS Multi-AZ + ElastiCache + ECS + S3 + ALB modules)
- Docker hardening (USER non-root, tini, nginx-unprivileged)
- CI: Docker build/push + Trivy + CodeQL + Semgrep + gitleaks + dependency-review + changesets
- Disaster recovery runbooks + SLO doc + 5 alert runbooks

### Observability
- prom-client `/metrics` on api/worker/mcp-server
- OTel traces + metrics + logs exporters
- Bull-Board admin dashboard
- 3 Grafana dashboards + 3 PrometheusRules
- Web Vitals → Sentry RUM

### Commercialization
- Stripe billing (Free / Pro / Enterprise tiers + Checkout + portal + webhook + usage meter + trial)
- Onboarding wizard (6 steps + sample data seeder + product tour + resume banner)
- Marketing landing + pricing page (3 tier cards + 30-row feature matrix + 10-question FAQ)
- 4 GDPR-aware legal pages (Terms, Privacy, DPA, Security)
- Documentation site (Astro Starlight, ~60+ pages with OpenAPI auto-render)
- Status page + incident management + RSS feed
- In-app support widget + ticket system
- Analytics stub (PostHog/Plausible)

### Frontend depth
- Lazy routes + route config table
- Virtualization on Opportunities (deferred on kanban + tasks due to DnD complexity)
- Server-persisted saved views
- Skip-link (WCAG 2.4.1)
- Modulepreload first-paint chunks
- i18n: 4 locales (en/fr/es/ar) + RTL + locale-aware formatters
- Service worker per-identity cache namespacing
- Update-available snackbar

### Testing
- Coverage gate (75/70/75/75) on every workspace
- `packages/test-factories` workspace with entity factories + MSW handlers
- Transaction-isolated tests via `withTx` helper (5 tests migrated)
- 6 new Playwright E2E specs with `// Why:` comments
- OpenAPI conformance gate in CI

---

## What's STILL missing for a "sellable" v1

Per Chief of Staff's WAVE3-BACKLOG and my own assessment, Wave 3 should address:

### Engineering (Wave 3 fleet)
1. **Notification engine** — dedicated `Notification` table + in-app bell + email digest + web-push (currently falls back to AuditLog)
2. **Approval chains** — multi-step with quorum + escalation + delegation (schema exists, runtime doesn't)
3. **Workflow no-code builder UI** — drag-drop trigger + condition tree + action list (today it's a 75-line read-only grid)
4. **Calendar two-way sync** — write internal events to MS/Google (today ingest-only)
5. **Calendly-style booking page**
6. **Notification table + push** (VAPID)
7. **`pdf-parse → unpdf` migration** (sandbox is done, parser quality is next)
8. **Account hierarchy UI** (schema is done)
9. **Cadence step → email-send queue wire-up** (one-branch swap once both branches land together)
10. **Auto-pause hook integrations** (1-line per call-site, deferred by Cadences agent)
11. **Real ClamAV/VirusTotal scan on file upload** (today defaults to scan_required=false)
12. **Custom objects** (Salesforce parity for advanced tenants)
13. **Mobile apps** (React Native or Expo)
14. **Real Salesforce/HubSpot migration connectors**
15. **Field-level encryption for PII**

### Operations (your decisions this week to hit launch)
1. Fix `@bidstack/memos` phantom dep (Engineering — 5 min)
2. Pick legal review vendor (~€3-10k, 10-day turnaround)
3. Pick pentest vendor (HackerOne/Cobalt/Bishop Fox, ~€5-15k)
4. Recruit 20 design partners
5. Choose Stripe live-mode legal entity
6. Designate GDPR DPO (internal or external)
7. Provision domains + ACM certs: `app/api/mcp/docs/status/www.bidstack.dev`
8. Configure Resend sending domain DNS (SPF, DKIM, DMARC)
9. Designer: PWA icons (192/512/maskable-512), OG image PNG, marketing/docs assets
10. Replace `[COMPANY NAME]` / `[JURISDICTION]` / `[EFFECTIVE DATE]` placeholders in legal pages
11. Real testimonials/case studies (3 needed for landing)
12. Calendly setup for demo booking
13. Translation review pass for FR/ES/AR (DeepL-paraphrase placeholders need professional polish)

### Pre-merge cleanup
1. **Disentangle `sec/audit-2026-05-24`** — Wave 1 leftover: Security HIGHs + Cybersec + part of CRM core schema all share that branch in main worktree. Cherry-pick into clean branches.
2. **Resolve schema collisions** — 11 branches touch `schema.prisma`. Merge in CoS's recommended order. Reservation list prevented model-name collisions.
3. **Reconcile your 418 WIP files** — every Wave 2 agent flagged the same missing files. Either commit them as a checkpoint after fixing the lint-staged hook, or stash and reapply post-merge.
4. **Run `pnpm install` + `pnpm db:generate` + `pnpm db:migrate`** between sessions (Windows DLL lock per `feedback_prisma-dll-lock-windows.md`).

---

## Projected scorecard after BOTH waves merge

| Audit dimension | Baseline | Wave 1 | Wave 1+2 |
|---|---|---|---|
| Frontend | 79 | 86 | 88 |
| Backend / API | 86 | 88 | 92 |
| Database | 78 | 90 | 92 |
| Server runtime | 76 | 76 | 80 |
| Networking / API design | 64 | 72 | 88 (OpenAPI + bulk + composite + OAuth2) |
| Cloud Infrastructure | 28 | 55 | 65 |
| CI/CD | 52 | 78 | 88 |
| Security | 78 | 92 | 95 |
| Containerization | 58 | 82 | 85 |
| CDN / static | 56 | 60 | 78 (SW fix + i18n + marketing perf) |
| Monitoring & Logging | 48 | 48 | 88 (Phase 4 landed) |
| Backups & Recovery | 6 | 55 | 65 |
| Sales Pipeline | 47 | 70 | 75 |
| Accounts/Contacts/Leads | 52 | 65 | 70 |
| Activities/Email/Calendar | 38 | 38 | **82** (email + calendar + cadences) |
| Reporting & Analytics | 51 | 55 | 80 (builder + subscriptions) |
| Workflow Automation | 22 | 70 | 72 (executors real; no-code builder Wave 3) |
| Integrations | 38 | 50 | 90 (OpenAPI + SDK + outbound webhooks + OAuth2 server) |
| A11y & i18n | 71 | 73 | 88 (i18n landed + skip-link) |
| Testing & Quality | 62 | 80 | 82 |
| **Commercialization (NEW)** | — | — | **80** (Stripe + onboarding + marketing + docs + status) |
| **SSO / Enterprise (NEW)** | — | — | **85** (SAML/OIDC + SCIM) |

**Composite projection: 55 → ~82/100** (Wave 1+2 combined, after merge).

To reach 90+/100 ("Salesforce-grade"), Wave 3 needs: notification engine, workflow builder UI, approval chains, calendar two-way + booking, custom objects, ClamAV upload scan, account hierarchy UI, mobile apps, real migration connectors.

---

## Bottom line

You can plausibly start selling this on the **Pro tier** (€49/user/month per current pricing model) after Wave 1+2 merge cleanup + the 13 operational items above. Most enterprise prospects will need at least Wave 3 to commit (custom objects, workflow builder, approval chains, notification engine).

**Critical path to first paying customer: ~3-6 weeks** of merge + cleanup + ops work, assuming the operational decisions get made this week. Wave 3 engineering can run in parallel (another fleet of ~12-15 agents).
