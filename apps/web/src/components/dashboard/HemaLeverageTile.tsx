import '@/components/agreements/agreements.css';

import { Link } from 'react-router-dom';

import { useMsaLeverageSummary } from '@/hooks/useMsaLeverage';

export function HemaLeverageTile() {
  const q = useMsaLeverageSummary();
  // A refresh that fails still holds the last count. Clearing the slot reads
  // as an empty HEMA book, including the demo synthetic count of one.
  if (q.isError && q.data) {
    const count = q.data.hemaPharmaAccounts;
    return (
      <div className="agr-dash-tile" role="alert" data-testid="hema-leverage-tile">
        <span className="l">Under-leveraged HEMA / pharma MSAs</span>
        <Link
          to="/accounts?leverage=hema"
          className="v"
          aria-label={`${count} under-leveraged HEMA or pharma MSAs`}
        >
          {count}
        </Link>
        <span className="l">Could not refresh this count.</span>
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
  if (q.isLoading || q.isError || !q.data) return null;
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
