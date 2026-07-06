// Small display-only widget used in the Accounts page header strip.
// The per-stat cards now come from the shared StatTile primitive in
// AccountsChrome.tsx; this file keeps the integration-status rail, which is
// specific to the "All accounts" segment.
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { sourceLabel } from './accountUtils';

export function IntegrationMotionRail({
  providers,
}: {
  providers: Array<{ name: string; status: string }>;
}) {
  const { t } = useTranslation('crm');
  const visible = providers.length
    ? providers.slice(0, 8)
    : [
        { name: 'ERP', status: 'healthy' },
        { name: 'External CRM', status: 'healthy' },
        { name: 'External Intelligence', status: 'disabled' },
        { name: 'Market data', status: 'healthy' },
      ];
  return (
    <div
      className="integration-motion-rail"
      aria-label={t('accountDashboardWidgets.railAriaLabel', 'CRM integration status')}
    >
      <span className="rail-label">
        {t('accountDashboardWidgets.railLabel', 'Integration activity')}
      </span>
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
      <span className="rail-caption">
        {t('accountDashboardWidgets.railCaption', 'ERP, External CRM, verified data connectors')}
      </span>
    </div>
  );
}
