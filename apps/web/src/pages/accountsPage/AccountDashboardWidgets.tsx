// Integration-status rail. Since v24 it is shown only in Settings >
// Integrations (IntegrationActivityPanel), not on account pages.
// An empty read stays empty. Demo often has no provider rows, and a
// placeholder healthy ERP would look like a live connector.
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { sourceLabel } from './accountUtils';

export function IntegrationMotionRail({
  providers,
}: {
  providers: Array<{ name: string; status: string }>;
}) {
  const { t } = useTranslation('crm');
  const visible = providers.slice(0, 8);
  return (
    <div
      className="integration-motion-rail"
      aria-label={t('accountDashboardWidgets.railAriaLabel', 'CRM integration status')}
    >
      <span className="rail-label">
        {t('accountDashboardWidgets.railLabel', 'Integration activity')}
      </span>
      {visible.length === 0 ? null : (
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
      )}
      <span className="rail-caption">
        {visible.length === 0
          ? t(
              'accountDashboardWidgets.railEmpty',
              'No integration status in this read.',
            )
          : t(
              'accountDashboardWidgets.railCaption',
              'ERP, External CRM, verified data connectors',
            )}
      </span>
    </div>
  );
}
