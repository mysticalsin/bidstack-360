/**
 * dashboard/widgets/AlertCard.tsx — linked alert card used for overdue tasks
 * and open service cases in the OrgDashboard sidebar.
 *
 * WHY a separate module: AlertCard is a reusable pattern (icon + value + total
 * + href) that appears twice in the sidebar with different props. Extracting
 * it makes future alert types a one-liner in OrgDashboard.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';

import { type KpiTone, TONE_BG, TONE_FG } from './dashboard-types';

// ─── AlertCard ───────────────────────────────────────────────────────────────

export function AlertCard({
  tone,
  icon,
  label,
  value,
  total,
  href,
}: {
  tone: KpiTone;
  icon: string;
  label: string;
  value: number;
  total: number;
  href: string;
}) {
  const { t } = useTranslation('crm');
  return (
    <GlassCard hoverable={false}>
      <Link
        to={href}
        className="flex min-h-11 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
          style={{
            background: TONE_BG[tone],
            color: TONE_FG[tone],
          }}
        >
          <Icon name={icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-[var(--fg-secondary)]">{label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-medium tabular-nums text-[var(--fg-primary)]">
              {value}
            </span>
            <span className="text-xs text-[var(--fg-secondary)]">
              {t('alert.ofTotal', 'of {{total}}', { total })}
            </span>
          </div>
        </div>
      </Link>
    </GlassCard>
  );
}
