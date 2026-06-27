/**
 * dashboard/widgets/InsightsBar.tsx — priority-signal pill strip for the
 * OrgDashboard main column.
 *
 * WHY a separate module: InsightsBar (~70 source lines) has its own pill-
 * building logic and renders conditionally (returns null when no signals).
 * Extracting it keeps the dashboard shell free of signal-aggregation logic.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { formatMoney } from '@/lib/format';
import { useCurrencyStore } from '@/stores/currency';

// ─── InsightsBar ─────────────────────────────────────────────────────────────

export function InsightsBar({
  overdueTasks,
  stalledOpps,
  newLeads,
  pipelineValue,
}: {
  overdueTasks: number;
  stalledOpps: number;
  newLeads: number;
  pipelineValue: number;
}) {
  const { t } = useTranslation('crm');
  // Match the rest of the dashboard: convert the EUR-base pipeline figure into
  // the user-selected currency and format it via the shared compact formatter,
  // instead of hardcoding a € symbol (which mismatched the USD-default KPI cards).
  const { currency, convert } = useCurrencyStore();

  const insights: Array<{
    tone: 'rose' | 'amber' | 'jade' | 'blue';
    icon: string;
    message: string;
    href: string;
  }> = [];

  if (overdueTasks > 0) {
    insights.push({
      tone: 'rose',
      icon: 'alert-circle',
      message: t('insightsBar.overdueTasks', '{{count}} tasks overdue', { count: overdueTasks }),
      href: '/tasks?filter=overdue',
    });
  }
  if (stalledOpps > 0) {
    insights.push({
      tone: 'amber',
      icon: 'pause-circle',
      message: t('insightsBar.stalledOpps', '{{count}} opportunities stalled', { count: stalledOpps }),
      href: '/opportunities',
    });
  }
  if (newLeads > 0) {
    insights.push({
      tone: 'jade',
      icon: 'user-plus',
      message: t('insightsBar.newLeads', '{{count}} new leads this week', { count: newLeads }),
      href: '/leads',
    });
  }
  if (pipelineValue > 1000000) {
    insights.push({
      tone: 'blue',
      icon: 'trending-up',
      message: t('insightsBar.pipelineValue', '{{value}} pipeline value', {
        value: formatMoney(convert(pipelineValue, 'EUR'), currency),
      }),
      href: '/pipeline',
    });
  }

  if (insights.length === 0) return null;

  return (
    <GlassCard padding="sm" hoverable={false} className="insights-bar">
      <div className="flex items-center gap-2 mb-2">
        <Icon name="zap" size={14} className="text-[var(--brand-primary)]" />
        <span className="text-xs font-semibold text-[var(--fg-primary)]">
          {t('insightsBar.heading', 'Priority signals')}
        </span>
      </div>
      <div className="insights-grid">
        {insights.map((insight) => (
          <Link
            key={insight.message}
            to={insight.href}
            className={`insight-pill insight-pill-${insight.tone}`}
          >
            <Icon name={insight.icon} size={13} />
            <span>{insight.message}</span>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}
