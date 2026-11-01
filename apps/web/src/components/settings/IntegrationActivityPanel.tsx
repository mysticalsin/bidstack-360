// v24: integration activity lives here (Settings > Integrations, admin), not
// on account pages. Provider health for the whole workspace, plus the sources
// Polo listens to for one account, filtered by account.
import '@/components/signals/signals.css';

import { useId, useMemo, useState } from 'react';

import { useAccountPulse, usePortfolioMomentum } from '@/hooks/useAccountSignals';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { IntegrationMotionRail } from '@/pages/accountsPage/AccountDashboardWidgets';

function AccountSources({ companyId }: { companyId: string }) {
  const q = useAccountPulse(companyId);
  if (q.isLoading) return <div className="sg-skel" style={{ minHeight: 40 }} aria-busy="true" />;
  if (q.isError || !q.data) return <p className="sg-empty" role="alert"><span>Couldn&apos;t load this account&apos;s sources</span></p>;
  const sources = q.data.sources;
  const on = sources.filter((s) => s.active).length;
  return (
    <div className="sg" data-testid="account-sources">
      <p className="sg-meta" style={{ margin: '0 0 8px' }}>{on} of {sources.length} sources active for {q.data.companyName}</p>
      <ul className="sg-sources" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {sources.map((s) => (
          <li key={s.id} className="sg-source" data-on={s.active}>
            <i aria-hidden />
            {s.label}
            <span className="sr-only">{s.active ? ' (on)' : ' (off)'}</span>
          </li>
        ))}
      </ul>
      {sources
        .filter((s) => s.hint)
        .map((s) => (
          <p key={`hint-${s.id}`} className="sg-source-hint" style={{ marginTop: 6 }}>
            {s.hint}
          </p>
        ))}
    </div>
  );
}

export function IntegrationActivityPanel() {
  const selectId = useId();
  const dashboard = useCrmDashboard();
  const portfolio = usePortfolioMomentum(200);
  const accounts = useMemo(() => [...(portfolio.data?.accounts ?? [])].sort((a, b) => a.companyName.localeCompare(b.companyName)), [portfolio.data]);
  const [picked, setPicked] = useState('');
  const companyId = picked || accounts[0]?.companyId || '';
  const providers = dashboard.data?.providerHealth ?? [];
  const healthy = providers.filter((p) => p.status === 'healthy').length;
  return (
    <section
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-5 shadow-[var(--shadow-xs)]"
      aria-labelledby="int-activity-h"
      data-testid="integration-activity"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="int-activity-h" className="text-base font-semibold text-[var(--fg-primary)]">Integration activity</h2>
        <span className="text-xs text-[var(--fg-tertiary)]">
          {providers.length ? `${healthy} of ${providers.length} providers healthy` : 'Provider health loading'}
        </span>
      </div>
      <div className="mt-3">
        <IntegrationMotionRail providers={providers.map((p) => ({ name: p.provider, status: p.status }))} />
      </div>
      <div className="mt-5 grid gap-2">
        <label htmlFor={selectId} className="text-sm font-medium text-[var(--fg-primary)]">
          Sources by account
        </label>
        <select
          id={selectId}
          className="h-10 max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 text-sm text-[var(--fg-primary)]"
          value={companyId}
          onChange={(e) => setPicked(e.target.value)}
          disabled={!accounts.length}
        >
          {accounts.length ? null : <option value="">No accounts yet</option>}
          {accounts.map((a) => (
            <option key={a.companyId} value={a.companyId}>
              {a.companyName}
            </option>
          ))}
        </select>
        {companyId ? <AccountSources companyId={companyId} /> : null}
      </div>
    </section>
  );
}

export default IntegrationActivityPanel;
