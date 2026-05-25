# Apple-Mode UX Accessibility Pass

**Problem:** Premium CRM polish breaks down when labels describe implementation details, dense controls hide state from assistive tech, or dashboard metrics look authoritative while using placeholder values.

**Fix:**

- Rename navigation and page labels around user intent: Strategic Accounts, Account Ranking, Company Directory, Accounts, and Open account cockpit.
- Keep quick actions literal. If a control opens a list, label it as opening that list; reserve "New" for routes or dialogs that actually create records.
- Derive dashboard metrics from real data. Win rate uses closed-won and closed-lost stage counts from the pipeline report and shows a no-closed-bids state when no data exists.
- Put sortable table state on the owning `th` with `aria-sort`; nested buttons announce the current state and next action.
- Use `role="group"` plus `aria-pressed` for filter chips unless true tab panels and roving focus exist.
- Use the shared Radix dialog primitive for modals so focus trap, Escape, focus restore, and labels are consistent.
- Scope appearance/background preferences to the signed-in browser profile and sync cross-tab updates.

**Validation:**

- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web lint`
- `pnpm --filter @bidstack/web test`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/web e2e -- accounts.spec.ts contacts.spec.ts bulk-actions.spec.ts settings.spec.ts smoke.spec.ts --project=chromium-desktop --reporter=list --trace=off`
