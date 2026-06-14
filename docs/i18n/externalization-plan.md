# UI string externalization — staged program

**Goal:** every user-facing string flows through react-i18next so the language
switch (already wired) visibly translates the whole app, and Crowdin can manage
the translations at scale.

**Baseline (run `npx tsx apps/web/scripts/i18n-coverage.mts`):** 5.6% localized
(20/356 components). The switcher + i18next pipeline + en/fr/es/pt/it/zh JSON
already work — what's missing is wrapping the remaining ~336 components' strings.
This is a **staged sweep**, not a single change.

## Conventions

- **Hook:** `const { t } = useTranslation('<namespace>')` per component.
- **Namespaces** (already defined in `apps/web/src/i18n/index.ts`):
  `common` (nav/buttons/generic), `auth`, `crm` (entity labels/stages/KPIs),
  `settings`, `onboarding`, `ai`, `reports`, `signatures`, `integrations`, `rfp`.
  Add a new namespace only for a large, self-contained surface; otherwise reuse.
- **Keys:** dot-namespaced by feature, e.g. `t('opportunities.table.header.stage')`.
  Reuse `common` for shared verbs (`common:actions.save`, `common:actions.cancel`).
- **Source of truth:** add every new key to `apps/web/public/locales/en/<ns>.json`.
  Other locales fall back to en automatically until Crowdin (or a translator)
  fills them — do NOT hand-translate in the sweep; that's Crowdin's job.
- **Interpolation:** `t('x.greeting', { name })` → `"greeting": "Hi {{name}}"`.
  Pluralization via i18next `_one`/`_other` keys.
- **Don't translate:** code identifiers, log messages, test ids, enum values on the
  wire, brand names.
- **Tests:** components under test already mock `react-i18next` to return the key;
  adding `useTranslation` keeps them green (assert on keys or update the mock).

## Batch order (highest visibility first)

The switch should *feel* global ASAP, so do shared chrome before deep pages:

1. **Chrome (seen on every page):** `components/layout/Sidebar`, `Topbar`,
   `MobileNav`, `Breadcrumbs`, command palette, `PageHead`. ~visible everywhere.
2. **Core list pages:** Opportunities, Leads, Contacts, Tasks, Accounts, Calls.
3. **Detail surfaces:** account cockpit cards, opportunity detail, contact detail.
4. **Settings + admin:** the settings sections, custom-object admin, integrations.
5. **Specialist surfaces:** RFP pipeline, reports builder, territories, signatures.
6. **Long tail:** modals, empty states, toasts, validation messages.

Track progress each pass with the coverage script (filter by path, e.g.
`npx tsx apps/web/scripts/i18n-coverage.mts pages/`).

## Per-batch checklist

1. Pick N components from the current tier (coverage script lists biggest first).
2. For each: add `useTranslation(ns)`, replace literals with `t()`, collect keys.
3. Add the new keys to `en/<ns>.json` (grouped, alphabetical within a group).
4. `pnpm --filter @bidstack/web typecheck && eslint <files>` + run affected tests.
5. Commit the batch; re-run the coverage script to confirm the number moved.
6. Periodically `crowdin upload sources` so translators get the new keys.

## Optional enforcement (later)

Once coverage is high, add `eslint-plugin-i18next`'s `no-literal-string` rule as a
**warning** (scoped to `pages/` + `components/`) to stop regressions. Don't enable
it as an error until the sweep is near-complete or it will flood CI.

## Why staged, not one commit

336 files × careful string review + key design is multi-pass work; doing it in
verified batches keeps each commit green and reviewable, and lets translation
(Crowdin) start on the early namespaces while later ones are still being wrapped.
