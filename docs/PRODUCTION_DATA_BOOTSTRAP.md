# Real data, day one — bootstrap, import, de-demo

How to take a Polo PreSales database from zero (or from a demo-polluted state) to
holding real production data. Companion to `docs/AZURE_GO_LIVE_CHEATSHEET.md`
(hosting) — this doc covers the DATA side only.

---

## 1. The plug-and-play sequence (fresh production database)

**Fully automatic path (recommended):** wire the Clerk webhook once and new
organizations bootstrap themselves the moment they're created in Clerk.

1. Clerk Dashboard → Webhooks → Add endpoint: `https://<api-domain>/webhooks/clerk`,
   subscribe to the **organization** events, copy the signing secret into
   `CLERK_WEBHOOK_SECRET` (Key Vault → api Container App).
2. `pnpm db:migrate:deploy` (the Azure migrate Job runs exactly this — never seeds).
3. Create the organization in Clerk → the webhook creates the Org row + seeds
   system roles/permissions (`organization.created`; name edits sync via
   `organization.updated`; `organization.deleted` deliberately deletes NOTHING).
4. Sign in — users JIT-provision; Clerk org-admins get the Admin role automatically.
5. Load real data (Settings → Data import): CSV wizard (companies / contacts /
   leads / opportunities), HubSpot migration, or integrations.

**Manual fallback (no webhook configured, or org created before the webhook):**

```bash
pnpm db:seed:prod -- --clerk-org org_2abc... --name "Mantu"
```

Why one of the two is mandatory: there is no other org provisioning. Until the
Org row exists, every sign-in gets `404 Organization not registered`
(`apps/api/src/plugins/auth.ts`); until the org's system roles are seeded, the
JIT admin grant skips itself and every permission gate returns 403. Both paths
create identical rows and are idempotent — safe to re-run/redeliver.

Everything else about a brand-new org is automatic: locale/currency defaults are
code-level, pipeline stages are enum-backed (stage table rows auto-create
lazily), dashboards/views/workflows have real empty states, and the Dashboard
swaps to a Getting-Started screen with first-move links on an all-zero org.

## 2. Keep demo pathways OFF in production

| Pathway | Off when | Notes |
| --- | --- | --- |
| `pnpm db:seed` (fixture org `org_seed_mantu` — fake @mantu.com users, OP-* opps) | just don't run it | Refuses to run with `NODE_ENV=production` unless `BIDSTACK_ALLOW_FIXTURE_SEED=true`. Also auto-runs from `pnpm db:migrate` / `db:reset` (prisma seed hook) — use `db:migrate:deploy` against prod, never `db:migrate`/`db:reset`. |
| `pnpm db:seed:demo` (demo_org_* with curated Siemens/IKEA/Sanofi data) | just don't run it | Demo rows carry NO per-row marker — the org's `demo_org_` prefix is the only gate key. |
| DEMO_MODE public sign-in (provisions a seeded demo org per visitor email) | `DEMO_MODE` unset/false | Mutually exclusive with Clerk at boot; production additionally requires `DEMO_PUBLIC_DEPLOYMENT_ACK=true` to even start in demo mode. |
| E2E/stub auth (writes E2E fixtures into `org_seed_mantu`) | prod boot refuses stub auth | Only reachable when `CLERK_SECRET_KEY` is absent AND NODE_ENV is development/test, loopback-only. |
| Onboarding **sample data templates** (QuickStart "install template") | allowed — by design | The ONE sample-data writer available to real orgs. Rows are tagged (`intel.isSample`, `SAMPLE-*` codes) and the same screen offers "Remove sample data" (soft-delete purge endpoint). Fine for evaluation; remove before reporting on real numbers. |

## 3. De-demo an existing database (purge)

Dry-run first — nothing deletes without `--apply`:

```bash
pnpm db:purge:demo -- --seed-org --demo-orgs --test-orgs          # report only
pnpm db:purge:demo -- --seed-org --demo-orgs --test-orgs --apply  # delete
```

- `--seed-org` — the `org_seed_mantu` fixture workspace (also removes the E2E
  residue and `rfp-load-test-*.pdf` attachments that live inside it).
- `--demo-orgs` — every `demo_org_*` org (CLI-seeded or demo-sign-in leftovers).
- `--test-orgs` — leftover isolated integration-test orgs
  (`org_<label>_t<12-hex>`; teardown is best-effort, aborted runs accumulate).
- `--synthetic <clerkOrg|orgId>` — synthetic E2E companies (SCOPE-*, E2E *,
  Audit Company, …) that leaked into an org you are KEEPING. Pattern list is
  mirrored from `apps/web/src/pages/accountsPage/testDataFilter.ts`.

Take a backup before `--apply`. Org deletion rides the schema's cascades; any
non-cascading relation aborts THAT org's delete loudly (P2003) instead of
half-deleting.

## 4. Dev-database hygiene (why your dev DB fills with junk)

- Playwright E2E and four remaining integration suites write through the live
  API into the shared `org_seed_mantu`; most API integration suites use
  throwaway `org_<label>_t<hex>` orgs with best-effort teardown.
- The UI additionally hides known synthetic account names from Key/Top account
  views (`testDataFilter.ts`) — display-level defense only, the rows still exist.
- Periodically: `pnpm db:purge:demo -- --test-orgs --apply`, or reset the whole
  dev DB (`pnpm db:reset` re-seeds fixtures by design).
