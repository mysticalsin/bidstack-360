import '@/components/agreements/agreements.css';

import { Link } from 'react-router-dom';

import { useMsaLeverageSummary } from '@/hooks/useMsaLeverage';

export function HemaLeverageTile() {
  const q = useMsaLeverageSummary();
  if (!q.data) {
    if (q.isError) {
      return (
        <div className="agr-dash-tile" role="alert" data-testid="hema-leverage-error">
          <span className="l">Could not load under-leveraged MSAs.</span>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center justify-self-start rounded-md px-3 text-sm font-medium text-[var(--brand-primary)] dark:text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            onClick={() => void q.refetch()}
          >
            Retry
          </button>
        </div>
      );
    }
    return null;
  }
  const count = q.data.hemaPharmaAccounts;
  return (
    <Link
      to="/accounts?leverage=hema"
      className="agr-dash-tile"
      data-testid="hema-leverage-tile"
      aria-label={`${count} under-leveraged HEMA or pharma MSAs`}
    >
      <span className="l">Under-leveraged HEMA / pharma MSAs</span>
      <span className="v">{count}</span>
      <span className="l">
        {count === 1
          ? 'Active MSA via HEMA or pharma, no IT / engineering / digital yet'
          : 'Active MSAs via HEMA or pharma, no IT / engineering / digital yet'}
      </span>
    </Link>
  );
}
