/**
 * dashboard/widgets/RecentActivityCard.tsx — animated recent-activity feed for
 * the OrgDashboard main column.
 *
 * WHY a separate module: the activity feed has its own type→icon/color maps,
 * loading/empty/populated states, and row animation logic (~118 source lines).
 * Extracting it makes the feed independently replaceable (e.g. with a real-time
 * socket feed) without touching the dashboard shell.
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { activityWhen } from '@/lib/activity-when';
import { springSoft } from '@/lib/motion';

// ─── Type → presentation maps (private) ──────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  opportunity: 'briefcase',
  lead: 'user',
  task: 'tasks',
  case: 'life-ring',
};

const TYPE_COLORS: Record<string, string> = {
  opportunity: 'var(--tag-amber-bg)',
  lead: 'var(--tag-purple-bg)',
  task: 'var(--tag-teal-bg)',
  case: 'var(--tag-rose-bg)',
};

const TYPE_FG: Record<string, string> = {
  opportunity: 'var(--tag-amber-fg)',
  lead: 'var(--tag-purple-fg)',
  task: 'var(--tag-teal-fg)',
  case: 'var(--tag-rose-fg)',
};

/** Rows drawn on the org dashboard activity card. One loaded row past this is not shown. */
export const RECENT_ACTIVITY_VISIBLE = 8;

/**
 * Activity caption for this card. A longer loaded list is the latest rows,
 * not every activity. A list that fits keeps "Latest updates". No activity
 * total is invented.
 */
export function recentActivityCaption(count: number, pageContinues: boolean): string {
  if (!pageContinues) return 'Latest updates';
  return `${count} in the latest ${RECENT_ACTIVITY_VISIBLE}, not every activity`;
}

// ─── RecentActivityCard ──────────────────────────────────────────────────────

type ActivityItem = {
  type: string;
  title: string;
  subtitle: string | null;
  date: string;
  url: string | null;
};

/** Stage and status keys are stored with underscores. The feed shows words. */
export function activitySubtitle(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function RecentActivityCard({ activity }: { activity: ActivityItem[] }) {
  const { t, i18n } = useTranslation('crm');
  const visible = activity.slice(0, RECENT_ACTIVITY_VISIBLE);
  // One row past the slice is the probe. It is not a row on this card.
  const pageContinues = visible.length < activity.length;

  return (
    <GlassCard padding="none" hoverable={false}>
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface-sunken)]">
              <Icon name="activity" size={13} className="text-[var(--brand-primary)]" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--fg-primary)]">
              {t('recentActivity.heading', 'Recent activity')}
            </h2>
          </div>
          <span className="text-xs text-[var(--fg-tertiary)]">
            {pageContinues
              ? t('recentActivity.pageCaption', recentActivityCaption(visible.length, true))
              : t('recentActivity.latestUpdates', recentActivityCaption(visible.length, false))}
          </span>
        </div>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {visible.length === 0 ? (
          <div className="px-5 py-6 text-sm text-[var(--fg-secondary)] text-center">
            {t('recentActivity.empty', 'No recent activity')}
          </div>
        ) : (
          visible.map((a, i) => (
            <motion.div
              key={`${a.type}-${a.title}-${a.date}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: i * 0.032 }}
              className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-hover)] transition-colors"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: TYPE_COLORS[a.type] ?? 'var(--surface-sunken)',
                  color: TYPE_FG[a.type] ?? 'var(--fg-secondary)',
                }}
              >
                <Icon name={TYPE_ICONS[a.type] ?? 'circle'} size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {a.url ? (
                    <Link
                      to={a.url}
                      className="truncate text-sm font-medium text-[var(--fg-primary)] hover:text-[var(--brand-primary)]"
                    >
                      {a.title}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium text-[var(--fg-primary)]">
                      {a.title}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
                  <span className="capitalize">{a.type}</span>
                  {a.subtitle && (
                    <>
                      <span>·</span>
                      <Badge tone="gray">{activitySubtitle(a.subtitle)}</Badge>
                    </>
                  )}
                </div>
              </div>
              <time className="shrink-0 text-xs text-[var(--fg-tertiary)]" dateTime={a.date}>
                {activityWhen(a.date, Date.now(), i18n.language)}
              </time>
            </motion.div>
          ))
        )}
      </div>
      {pageContinues && (
        <div className="px-5 py-3 border-t border-[var(--border-subtle)]">
          <Link
            to="/activities"
            className="text-xs font-medium text-[var(--brand-primary)] hover:underline"
          >
            {t('recentActivity.openFeed', 'Open activities')}
          </Link>
        </div>
      )}
    </GlassCard>
  );
}
