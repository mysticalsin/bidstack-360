// Small display-only widgets used in the Accounts page header strip.
// WHY combined: SourceStat (9 lines) and IntegrationMotionRail (~30 lines) are
// both tiny and only used by AccountsPage — splitting them into separate files
// would add navigation overhead without any clarity benefit.
import type { CSSProperties } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';

import { sourceLabel } from './accountUtils';

export function SourceStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="account-source-stat">
      <span>{label}</span>
      <strong>
        <AnimatedMetric value={value} />
      </strong>
      <small>{detail}</small>
    </div>
  );
}

export function IntegrationMotionRail({
  providers,
}: {
  providers: Array<{ name: string; status: string }>;
}) {
  const visible = providers.length
    ? providers.slice(0, 8)
    : [
        { name: 'ERP', status: 'healthy' },
        { name: 'External CRM', status: 'healthy' },
        { name: 'Apollo', status: 'disabled' },
        { name: 'TradingView', status: 'healthy' },
      ];
  return (
    <div className="integration-motion-rail" aria-label="CRM integration status">
      <span className="rail-label">Integration activity</span>
      <div className="rail-track" aria-hidden>
        {visible.map((provider, index) => (
          <span
            key={`${provider.name}-${index}`}
            className={`rail-node rail-node-${provider.status}`}
            style={{ '--rail-delay': `${index * 0.12}s` } as CSSProperties}
          >
            {sourceLabel(provider.name)}
          </span>
        ))}
      </div>
      <span className="rail-caption">ERP, External CRM, verified data connectors</span>
    </div>
  );
}
