/**
 * dashboard/widgets/InsightsBar.tsx — priority-signal pill strip for the
 * OrgDashboard main column.
 *
 * WHY a separate module: InsightsBar (~70 source lines) has its own pill-
 * building logic and renders conditionally (returns null when no signals).
 * Extracting it keeps the dashboard shell free of signal-aggregation logic.
 */
import { Link } from 'react-router-dom';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';

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
      message: `${overdueTasks} task${overdueTasks === 1 ? '' : 's'} overdue`,
      href: '/tasks?filter=overdue',
    });
  }
  if (stalledOpps > 0) {
    insights.push({
      tone: 'amber',
      icon: 'pause-circle',
      message: `${stalledOpps} opportunit${stalledOpps === 1 ? 'y' : 'ies'} stalled`,
      href: '/opportunities',
    });
  }
  if (newLeads > 0) {
    insights.push({
      tone: 'jade',
      icon: 'user-plus',
      message: `${newLeads} new lead${newLeads === 1 ? '' : 's'} this week`,
      href: '/leads',
    });
  }
  if (pipelineValue > 1000000) {
    insights.push({
      tone: 'blue',
      icon: 'trending-up',
      message: `€${(pipelineValue / 1000000).toFixed(1)}M pipeline value`,
      href: '/pipeline',
    });
  }

  if (insights.length === 0) return null;

  return (
    <GlassCard padding="sm" hoverable={false} className="insights-bar">
      <div className="flex items-center gap-2 mb-2">
        <Icon name="zap" size={14} className="text-[var(--brand-primary)]" />
        <span className="text-xs font-semibold text-[var(--fg-primary)]">Priority signals</span>
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
