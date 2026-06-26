/**
 * Comitology / governance meeting log for the open account (A4). Tracks
 * governance meetings + their assigned actions — pre-sales visibility gap.
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { SourceBadge } from '@/components/cockpit/SourceBadge';
import { useIsAdmin } from '@/lib/auth';
import {
  useCreateGovernanceMeeting,
  useGovernanceMeetings,
  usePatchGovernanceAction,
} from '@/hooks/useGovernance';
import type { GovernanceMeeting, GovernanceMeetingType, GovernanceStatus } from '@bidstack/shared';

const MEETING_LABEL: Record<GovernanceMeetingType, string> = {
  monthly_committee: 'Monthly committee',
  quarterly_c_level: 'Quarterly C-level',
  brm: 'BRM',
  sar_review: 'SAR review',
  other: 'Other',
};
const STATUS_TONE: Record<GovernanceStatus, 'gray' | 'amber' | 'jade'> = {
  open: 'gray',
  in_progress: 'amber',
  done: 'jade',
};
const NEXT_STATUS: Record<GovernanceStatus, GovernanceStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
};

function dateOnly(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function MeetingAuditBadges({ meeting }: { meeting: GovernanceMeeting }) {
  const { t } = useTranslation('crm');
  const createdAt = dateOnly(meeting.createdAt);
  const updatedAt = dateOnly(meeting.updatedAt);
  const unknownDate = t('governanceLog.audit.unknownDate', 'unknown date');

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <SourceBadge
        label={t('governanceLog.audit.meetingBadge', 'Manual meeting')}
        state="crm"
        hint={t(
          'governanceLog.audit.meetingHint',
          'Manually logged governance meeting created {{createdAt}}.',
          { createdAt: createdAt ?? unknownDate },
        )}
        data-testid={`governance-meeting-${meeting.id}-manual-source`}
      />
      <SourceBadge
        label={t('governanceLog.audit.auditBadge', 'Audit logged')}
        state="verified"
        hint={t(
          'governanceLog.audit.auditHint',
          'Server mutation audit covers governance meeting and action mutations. Last updated {{updatedAt}}.',
          { updatedAt: updatedAt ?? unknownDate },
        )}
        data-testid={`governance-meeting-${meeting.id}-audit-source`}
      />
    </div>
  );
}

function GovernanceActionAuditBadges({
  action,
}: {
  action: GovernanceMeeting['actions'][number];
}) {
  const { t } = useTranslation('crm');
  const createdAt = dateOnly(action.createdAt);
  const unknownDate = t('governanceLog.audit.unknownDate', 'unknown date');

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <SourceBadge
        label={t('governanceLog.audit.actionBadge', 'Manual action')}
        state="crm"
        hint={t('governanceLog.audit.actionHint', 'Governance action created {{createdAt}}.', {
          createdAt: createdAt ?? unknownDate,
        })}
        data-testid={`governance-action-${action.id}-manual-source`}
      />
      <SourceBadge
        label={t('governanceLog.audit.auditBadge', 'Audit logged')}
        state="verified"
        hint={t(
          'governanceLog.audit.actionAuditHint',
          'Server mutation audit covers action status and ownership updates.',
        )}
        data-testid={`governance-action-${action.id}-audit-source`}
      />
    </div>
  );
}

export function GovernanceLogCard({ accountKey }: { accountKey: string }) {
  const meetings = useGovernanceMeetings(accountKey);
  const canWrite = useIsAdmin();
  const { t } = useTranslation('crm');

  return (
    <Card role="region" aria-label={t('governanceLog.regionLabel', 'Governance meetings')}>
      <SectionHeader
        title={t('governanceLog.title', 'Governance log')}
        caption={t('governanceLog.caption', 'Comitology — committees, C-level reviews, BRM, SAR')}
        action={canWrite ? <CreateMeeting accountKey={accountKey} /> : undefined}
      />
      <div className="px-5 pb-5">
        {meetings.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : meetings.isError ? (
          <ErrorState
            title={t('governanceLog.errorTitle', 'Could not load governance log')}
            message={meetings.error?.message ?? t('governanceLog.errorMessage', 'Try again shortly.')}
          />
        ) : (meetings.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--fg-tertiary)]">
            {t('governanceLog.empty', 'No governance meetings recorded for this account yet.')}
          </p>
        ) : (
          <ul className="space-y-4">
            {meetings.data!.items.map((meeting) => (
              <MeetingRow key={meeting.id} meeting={meeting} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function MeetingRow({ meeting, canWrite }: { meeting: GovernanceMeeting; canWrite: boolean }) {
  const patchAction = usePatchGovernanceAction();
  const { t } = useTranslation('crm');
  return (
    <li className="border-l-2 border-[var(--border)] pl-3">
      <div className="flex items-center gap-2">
        <Badge tone="blue">{MEETING_LABEL[meeting.meetingType]}</Badge>
        <span className="text-xs text-[var(--fg-tertiary)]">{meeting.date.slice(0, 10)}</span>
      </div>
      {meeting.participants.length > 0 ? (
        <p className="mt-1 text-xs text-[var(--fg-tertiary)]">
          {meeting.participants.join(', ')}
        </p>
      ) : null}
      {meeting.outcomes ? (
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">{meeting.outcomes}</p>
      ) : null}
      <MeetingAuditBadges meeting={meeting} />
      {meeting.actions.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {meeting.actions.map((action) => (
            <li key={action.id} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0">
                <span className="block text-[var(--fg-primary)]">
                {action.description}
                {action.ownerName ? ` · ${action.ownerName}` : ''}
                {action.dueDate ? ` · ${action.dueDate.slice(0, 10)}` : ''}
                </span>
                <GovernanceActionAuditBadges action={action} />
              </div>
              <button
                type="button"
                disabled={!canWrite || patchAction.isPending}
                onClick={() =>
                  patchAction.mutate({
                    meetingId: meeting.id,
                    actionId: action.id,
                    body: { status: NEXT_STATUS[action.status] },
                  })
                }
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:opacity-60"
                aria-label={t('governanceLog.advanceStatusLabel', 'Advance status of {{description}}', {
                  description: action.description,
                })}
                data-testid={`governance-action-${action.id}-status`}
              >
                <Badge tone={STATUS_TONE[action.status]}>{action.status.replace('_', ' ')}</Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CreateMeeting({ accountKey }: { accountKey: string }) {
  const [open, setOpen] = useState(false);
  const create = useCreateGovernanceMeeting();
  const { t } = useTranslation('crm');
  const [form, setForm] = useState<{
    meetingType: GovernanceMeetingType;
    date: string;
    participants: string;
    outcomes: string;
  }>({ meetingType: 'monthly_committee', date: '', participants: '', outcomes: '' });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.date) {
      toast.error(t('governanceLog.dateRequired', 'Date required'));
      return;
    }
    create.mutate(
      {
        accountKey,
        meetingType: form.meetingType,
        date: new Date(form.date).toISOString(),
        participants: form.participants
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        outcomes: form.outcomes.trim() || null,
        actions: [],
      },
      {
        onSuccess: () => {
          toast.success(t('governanceLog.meetingRecorded', 'Meeting recorded'));
          setOpen(false);
          setForm({ meetingType: 'monthly_committee', date: '', participants: '', outcomes: '' });
        },
        onError: (err: Error) =>
          toast.error(t('governanceLog.couldNotSave', 'Could not save'), { description: err.message }),
      },
    );
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('governanceLog.addMeeting', 'Add meeting')}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="w-full space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={form.meetingType}
          onChange={(e) =>
            setForm((f) => ({ ...f, meetingType: e.target.value as GovernanceMeetingType }))
          }
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          aria-label={t('governanceLog.meetingTypeLabel', 'Meeting type')}
        >
          {Object.entries(MEETING_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          aria-label={t('governanceLog.meetingDateLabel', 'Meeting date')}
        />
      </div>
      <input
        value={form.participants}
        onChange={(e) => setForm((f) => ({ ...f, participants: e.target.value }))}
        placeholder={t('governanceLog.participantsPlaceholder', 'Participants (comma-separated)')}
        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
      />
      <textarea
        value={form.outcomes}
        onChange={(e) => setForm((f) => ({ ...f, outcomes: e.target.value }))}
        placeholder={t('governanceLog.outcomesPlaceholder', 'Outcomes / decisions')}
        rows={2}
        className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending
            ? t('governanceLog.saving', 'Saving…')
            : t('governanceLog.save', 'Save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t('governanceLog.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}
