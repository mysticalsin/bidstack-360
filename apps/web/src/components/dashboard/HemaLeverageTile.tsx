import '@/components/agreements/agreements.css';

import { Link } from 'react-router-dom';

import { useMsaLeverageSummary } from '@/hooks/useMsaLeverage';

export function HemaLeverageTile() {
  const q = useMsaLeverageSummary();
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
