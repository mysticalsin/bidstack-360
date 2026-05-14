// Animated activity timeline for the cockpit. Renders the cockpit's
// recentActivity array as a vertical chronological feed with kind-specific
// glyphs, source colors, and a spring-staggered entrance.
//
// The kind glyph is purely visual — screen readers get the full subject +
// body via the natural reading order.

import { motion, useReducedMotion } from 'framer-motion';
import { memo, useMemo } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/StateMessages';
import { springSoft } from '@/lib/motion';
import { relativeTime } from '@/lib/format';

import type { AccountCockpitSnapshot, CrmActivity } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
  /** Max items to render. Defaults to 8 — wide enough to show a week of work. */
  limit?: number;
}

const KIND_ICON: Record<CrmActivity['kind'], IconName> = {
  note: 'note',
  task: 'tasks',
  call: 'phone',
  email: 'mail',
  meeting: 'contacts',
  timeline_event: 'target',
  job: 'settings',
  dust: 'sparkle',
};

const KIND_TONE: Record<CrmActivity['kind'], 'gray' | 'blue' | 'jade' | 'purple' | 'amber'> = {
  note: 'gray',
  task: 'blue',
  call: 'jade',
  email: 'purple',
  meeting: 'amber',
  timeline_event: 'gray',
  job: 'blue',
  dust: 'purple',
};

export const ActivityTimelineCard = memo(function ActivityTimelineCard({
  cockpit,
  limit = 8,
}: Props) {
  const reduced = useReducedMotion();

  // Sort newest first; the API isn't always strictly ordered when activities
  // come from multiple sources (tasks + sync events + dust runs).
  const items = useMemo(
    () =>
      [...cockpit.recentActivity]
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, limit),
    [cockpit.recentActivity, limit],
  );

  if (items.length === 0) {
    return (
      <Card role="region" aria-label="Recent activity">
        <SectionHeader title="Recent activity" />
        <EmptyState
          title="Nothing yet"
          message="Tasks, emails, and Dust runs for this account will appear here."
        />
      </Card>
    );
  }

  return (
    <Card role="region" aria-label="Recent activity">
      <SectionHeader title="Recent activity" caption={`Last ${items.length} items`} />
      <ol className="relative px-5 pb-5 pt-3">
        {/* The vertical rail that the dots sit on. Drawn once, sits behind
            every row — purely decorative, so aria-hidden. */}
        <span
          aria-hidden
          className="absolute left-[26px] top-3 bottom-3 w-px bg-[var(--border-subtle)]"
        />
        {items.map((activity, i) => (
          <motion.li
            key={activity.id}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
            transition={{ ...springSoft, delay: Math.min(i, 10) * 0.04 }}
            className="relative flex items-start gap-3 py-2.5"
          >
            <span
              aria-hidden
              className="activity-kind-icon z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-card)]"
            >
              <Icon name={KIND_ICON[activity.kind]} size={11} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--fg-primary)] truncate">
                  {activity.subject}
                </span>
                <Badge tone={KIND_TONE[activity.kind]}>{activity.kind}</Badge>
              </div>
              {activity.body ? (
                <p className="mt-0.5 text-xs text-[var(--fg-secondary)] line-clamp-2">
                  {activity.body}
                </p>
              ) : null}
              <div className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                {activity.actorName ? `${activity.actorName} · ` : ''}
                {relativeTime(activity.occurredAt)}
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
    </Card>
  );
});
