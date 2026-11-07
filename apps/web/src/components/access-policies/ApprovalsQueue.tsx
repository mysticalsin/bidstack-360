import { CircleCheck, Clock, History } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/vendor/tuffui/status-pill';
import type { AccessPolicyVersion } from '@/hooks/useAccessPolicies';

interface ApprovalsQueueProps {
  items: AccessPolicyVersion[];
  currentUserId: string;
  canApprove: boolean;
  canPublish: boolean;
  nextVersion: number;
  onApprove: (id: string, note: string) => void | Promise<unknown>;
  onReject: (id: string, note: string) => void | Promise<unknown>;
  onPublish: (id: string) => void | Promise<unknown>;
  busy?: boolean;
}

const noteClass =
  'min-h-16 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1.5 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]';

function PendingItem({
  item,
  own,
  canApprove,
  busy,
  onApprove,
  onReject,
}: {
  item: AccessPolicyVersion;
  own: boolean;
  canApprove: boolean;
  busy?: boolean;
  onApprove: ApprovalsQueueProps['onApprove'];
  onReject: ApprovalsQueueProps['onReject'];
}) {
  const { t } = useTranslation('settings');
  const [note, setNote] = useState('');
  if (own) {
    return (
      <p className="text-sm text-fg-secondary">
        {t('accessPolicies.ownPending', 'You submitted this policy. A second admin must approve it.')}
      </p>
    );
  }
  if (!canApprove) {
    return <p className="text-sm text-fg-secondary">{t('accessPolicies.awaiting', 'Waiting for an admin to review.')}</p>;
  }
  return (
    <div className="space-y-2">
      <textarea
        aria-label={t('accessPolicies.note', 'Decision note')}
        className={noteClass}
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void onApprove(item.id, note.trim())}>
          {t('accessPolicies.approve', 'Approve')}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onReject(item.id, note.trim())}>
          {t('accessPolicies.reject', 'Reject')}
        </Button>
      </div>
    </div>
  );
}

/** Pending and approved versions. The author never sees Approve on their own policy. */
export function ApprovalsQueue({
  items,
  currentUserId,
  canApprove,
  canPublish,
  nextVersion,
  onApprove,
  onReject,
  onPublish,
  busy,
}: ApprovalsQueueProps) {
  const { t } = useTranslation('settings');
  const queue = items.filter((i) => i.status === 'pending' || i.status === 'approved');
  if (queue.length === 0) {
    return <p className="text-sm text-fg-secondary">{t('accessPolicies.queueEmpty', 'Nothing is waiting for review.')}</p>;
  }
  return (
    <ul className="space-y-2">
      {queue.map((item) => {
        const pending = item.status === 'pending';
        const label = pending ? t('accessPolicies.pending', 'Pending') : t('accessPolicies.approved', 'Approved');
        return (
          <li key={item.id} aria-label={`${item.name}, ${label}`} className="space-y-2 rounded-lg bg-surface-inset p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-fg-primary">{item.name}</span>
              <StatusPill size="sm" tone={pending ? 'warning' : 'positive'} icon={pending ? Clock : CircleCheck}>
                {label}
              </StatusPill>
              <span className="text-xs text-fg-secondary">
                {t('accessPolicies.byAuthor', 'by {{name}}', { name: item.createdByName ?? t('accessPolicies.unknown', 'unknown') })}
              </span>
            </div>
            {pending ? (
              <PendingItem
                item={item}
                own={item.createdById === currentUserId}
                canApprove={canApprove}
                busy={busy}
                onApprove={onApprove}
                onReject={onReject}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-fg-secondary">
                  {t('accessPolicies.approvedBy', 'Approved by {{name}}', {
                    name: item.approvedByName ?? t('accessPolicies.unknown', 'unknown'),
                  })}
                </span>
                {canPublish && (
                  <Button size="sm" disabled={busy} onClick={() => void onPublish(item.id)}>
                    {t('accessPolicies.publish', 'Publish v{{n}}', { n: nextVersion })}
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface VersionHistoryProps {
  items: AccessPolicyVersion[];
  canWrite: boolean;
  onRollback: (id: string) => void;
  busy?: boolean;
}

/** Published versions, newest first. Rollback republishes an earlier version as a new one. */
export function VersionHistory({ items, canWrite, onRollback, busy }: VersionHistoryProps) {
  const { t } = useTranslation('settings');
  const versions = items
    .filter((i) => i.version !== null && (i.status === 'published' || i.status === 'superseded'))
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  if (versions.length === 0) {
    return (
      <p className="text-sm text-fg-secondary">
        {t('accessPolicies.noVersions', 'Nothing published yet. The RBAC matrix applies as is.')}
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {versions.map((v) => {
        const live = v.status === 'published';
        return (
          <li
            key={v.id}
            aria-label={`v${v.version} ${v.name}`}
            className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover"
          >
            <span className="w-10 font-mono text-sm tabular-nums text-fg-primary">v{v.version}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">{v.name}</span>
            {v.publishedAt && <span className="text-xs text-fg-secondary">{v.publishedAt.slice(0, 10)}</span>}
            {live ? (
              <StatusPill size="sm" tone="positive" icon={CircleCheck}>
                {t('accessPolicies.live', 'Live')}
              </StatusPill>
            ) : (
              canWrite && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRollback(v.id)}>
                  <History className="size-4" aria-hidden="true" />
                  {t('accessPolicies.rollback', 'Roll back to v{{n}}', { n: v.version })}
                </Button>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
