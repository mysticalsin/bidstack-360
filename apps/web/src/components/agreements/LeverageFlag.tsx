import './agreements.css';

import { Link } from 'react-router-dom';

import type { MsaLeverageFlag } from '@bidstack/shared';
import { labelBusinessLine } from '@bidstack/shared';

export function LeverageFlag({ flag, compact = false }: { flag: MsaLeverageFlag; compact?: boolean }) {
  return (
    <aside className="agr-leverage" data-testid="msa-leverage-flag" aria-label="MSA leverage opportunity">
      <p className="agr-leverage-kicker">MSA leverage opportunity</p>
      <p className="agr-leverage-head">{flag.headline}</p>
      {!compact ? (
        <p className="agr-caption">
          {flag.scopeNeedsAmendment
            ? 'Scope may need amendment before other lines can use this MSA.'
            : flag.scopeAllowsOtherServices
              ? 'The scope or affiliates clause already allows other services.'
              : 'Scope coverage for other lines is not stated.'}
          {flag.scopeCitation ? (
            <> Cite: {flag.scopeCitation.clause ?? 'clause'}{flag.scopeCitation.page ? `, page ${flag.scopeCitation.page}` : ''}.</>
          ) : null}
        </p>
      ) : null}
      <p className="agr-caption">
        Missing lines: {flag.missingLines.map(labelBusinessLine).join(', ')}
        {' · '}
        <Link to={`/agreements/${flag.msaId}`}>{flag.msaTitle}</Link>
      </p>
    </aside>
  );
}
