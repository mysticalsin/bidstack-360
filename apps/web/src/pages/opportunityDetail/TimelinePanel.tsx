import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useOpportunityTimeline } from '@/hooks/useOpportunityTimeline';
import { formatDate, relativeTime } from '@/lib/format';

// Timeline kind → icon. Covers the three legacy sources (audit/task/comment)
// plus every Activity chatter type the API merges in; unknown kinds fall back
// to a neutral glyph so a new server-side type can never break rendering.
const KIND_ICON: Record<string, IconName> = {
  audit: 'pencil',
  task: 'tasks',
  comment: 'messageCircle',
  email: 'mail',
  email_opened: 'mail',
  email_clicked: 'mail',
  meeting: 'clock',
  call: 'phone',
  note: 'note',
  stage_change: 'pipeline',
  field_edit: 'pencil',
  file_upload: 'upload',
  task_completed: 'checkCircle',
  cadence_started: 'zap',
  cadence_completed: 'checkCircle',
  custom: 'sparkle',
};

function iconFor(kind: string): IconName {
  return KIND_ICON[kind] ?? 'info';
}

/**
 * The single narrative of the deal: audit events, tasks, comments and chatter
 * activities (calls, emails, meetings, notes, stage events) merged by the
 * timeline endpoint, rendered newest-first with per-type icons.
 */
export function TimelinePanel({ oppId }: { oppId: string }) {
  const { t } = useTranslation('crm');
  const timeline = useOpportunityTimeline(oppId);

  if (timeline.isLoading) return <LoadingSkeleton />;
  if (timeline.isError)
    return (
      <ErrorState
        title={t('opportunityDetail.timelineErrorTitle', "Couldn't load the timeline")}
        message={t('opportunityDetail.timelineErrorMessage', 'Please try again.')}
        action={
          <Button size="sm" variant="secondary" onClick={() => void timeline.refetch()}>
            {t('opportunityDetail.timelineRetry', 'Retry')}
          </Button>
        }
      />
    );

  const items = timeline.data?.items ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        title={t('opportunityTabs.activityEmptyTitle', 'No activity yet')}
        message={t(
          'opportunityTabs.activityEmptyMessage',
          'Stage moves, Dust webhooks, and notes will appear here.',
        )}
      />
    );

  return (
    <Card>
      <SectionHeader
        title={t('opportunityTabs.activityTitle', 'Activity')}
        caption={t('opportunityDetail.timelineCount', '{{count}} events', {
          count: items.length,
        })}
      />
      <ol className="px-5 py-4 space-y-4">
        {items.map((e) => (
          <li key={e.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-sunken-alpha)] text-[var(--brand-primary)]"
            >
              <Icon name={iconFor(e.kind)} size={13} />
            </span>
            <div className="min-w-0">
              <div className="text-sm text-[var(--fg-primary)]">{e.text}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--fg-tertiary)]">
                {e.actorName ? (
                  <>
                    <span className="font-medium text-[var(--fg-secondary)]">{e.actorName}</span>
                    <span aria-hidden="true" className="opacity-40">
                      ·
                    </span>
                  </>
                ) : null}
                <span className="capitalize">{e.kind.replace(/_/g, ' ')}</span>
                <span aria-hidden="true" className="opacity-40">
                  ·
                </span>
                {/* Relative for scanning, absolute in the tooltip for audits. */}
                <time dateTime={e.createdAt} title={formatDate(e.createdAt)}>
                  {relativeTime(e.createdAt)}
                </time>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
