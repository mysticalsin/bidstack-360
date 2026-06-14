import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { useServiceCases } from '@/hooks/useServiceCases';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import type { CasePriority, CaseStatus } from '@bidstack/shared';

const STATUS_OPTIONS: { value: CaseStatus | ''; labelKey: string; labelEn: string }[] = [
  { value: '', labelKey: 'serviceDesk.statusOption.all', labelEn: 'All' },
  { value: 'new', labelKey: 'serviceDesk.statusOption.new', labelEn: 'New' },
  { value: 'open', labelKey: 'serviceDesk.statusOption.open', labelEn: 'Open' },
  {
    value: 'waiting_customer',
    labelKey: 'serviceDesk.statusOption.waitingCustomer',
    labelEn: 'Waiting customer',
  },
  {
    value: 'waiting_internal',
    labelKey: 'serviceDesk.statusOption.waitingInternal',
    labelEn: 'Waiting internal',
  },
  { value: 'resolved', labelKey: 'serviceDesk.statusOption.resolved', labelEn: 'Resolved' },
  { value: 'closed', labelKey: 'serviceDesk.statusOption.closed', labelEn: 'Closed' },
  { value: 'escalated', labelKey: 'serviceDesk.statusOption.escalated', labelEn: 'Escalated' },
];

const PRIORITY_OPTIONS: { value: CasePriority | ''; labelKey: string; labelEn: string }[] = [
  { value: '', labelKey: 'serviceDesk.priorityOption.all', labelEn: 'All' },
  { value: 'low', labelKey: 'serviceDesk.priorityOption.low', labelEn: 'Low' },
  { value: 'medium', labelKey: 'serviceDesk.priorityOption.medium', labelEn: 'Medium' },
  { value: 'high', labelKey: 'serviceDesk.priorityOption.high', labelEn: 'High' },
  { value: 'critical', labelKey: 'serviceDesk.priorityOption.critical', labelEn: 'Critical' },
];

export function ServiceDeskPage() {
  const { t } = useTranslation('crm');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [priority, setPriority] = useState<CasePriority | ''>('');
  const { data, isLoading, isError, error, refetch } = useServiceCases({
    search: deferredSearch.trim() || undefined,
    status: status || undefined,
    priority: priority || undefined,
    limit: 50,
  });

  const items = data?.items ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t('serviceDesk.title', 'Service Desk')}</h1>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <input
            type="text"
            placeholder={t('serviceDesk.searchPlaceholder', 'Search cases…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('serviceDesk.searchAriaLabel', 'Search cases')}
            className="min-w-[200px] flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const csv = rowsToCsv(items, [
                { key: 'number', label: t('serviceDesk.csv.caseNumber', 'Case #') },
                { key: 'subject', label: t('serviceDesk.csv.subject', 'Subject') },
                { key: 'status', label: t('serviceDesk.csv.status', 'Status') },
                { key: 'priority', label: t('serviceDesk.csv.priority', 'Priority') },
                { key: 'ownerName', label: t('serviceDesk.csv.owner', 'Owner') },
                { key: 'source', label: t('serviceDesk.csv.source', 'Source') },
                { key: 'satisfaction', label: t('serviceDesk.csv.satisfaction', 'Satisfaction') },
                { key: 'createdAt', label: t('serviceDesk.csv.created', 'Created') },
                { key: 'resolvedAt', label: t('serviceDesk.csv.resolved', 'Resolved') },
              ]);
              downloadCsv(`service-desk-${new Date().toISOString().slice(0, 10)}`, csv);
            }}
          >
            {t('serviceDesk.exportCsv', 'Export CSV')}
          </Button>
          <select
            aria-label={t('serviceDesk.filterByStatusAriaLabel', 'Filter by status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as CaseStatus | '')}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey, o.labelEn)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('serviceDesk.filterByPriorityAriaLabel', 'Filter by priority')}
            value={priority}
            onChange={(e) => setPriority(e.target.value as CasePriority | '')}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey, o.labelEn)}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* sr-only live region — announces filter result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!isLoading && data
          ? `${
              items.length === 1
                ? t('serviceDesk.resultCount.one', '{{count}} case', { count: items.length })
                : t('serviceDesk.resultCount.other', '{{count}} cases', { count: items.length })
            }${search ? t('serviceDesk.resultMatching', ' matching "{{search}}"', { search }) : ''}${status ? ` · ${status}` : ''}${priority ? ` · ${priority}` : ''}`
          : ''}
      </p>

      {isError ? (
        <ErrorState
          title={t('serviceDesk.error.title', 'Failed to load cases')}
          message={error?.message}
          action={<Button onClick={() => refetch()}>{t('serviceDesk.retry', 'Retry')}</Button>}
        />
      ) : isLoading ? (
        <TableSkeleton rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('serviceDesk.empty.title', 'No cases yet')}
          message={t('serviceDesk.empty.message', 'Service cases will appear here.')}
        />
      ) : (
        <Card>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--fg-tertiary)]">
                <th scope="col" className="px-4 py-3 font-medium">
                  #
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('serviceDesk.column.subject', 'Subject')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('serviceDesk.column.status', 'Status')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('serviceDesk.column.priority', 'Priority')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('serviceDesk.column.owner', 'Owner')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('serviceDesk.column.source', 'Source')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <td className="px-4 py-3 font-mono text-xs text-[var(--fg-tertiary)]">
                    <Link
                      to={`/service-desk/${c.id}`}
                      className="hover:text-[var(--brand-primary)]"
                    >
                      {c.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-primary)]">
                    <Link
                      to={`/service-desk/${c.id}`}
                      className="hover:text-[var(--brand-primary)]"
                    >
                      {c.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <CaseStatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3">
                    <CasePriorityBadge priority={c.priority} />
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)]">{c.ownerName ?? '—'}</td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)] capitalize">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function CaseStatusBadge({ status }: { status: CaseStatus }) {
  const styles: Record<CaseStatus, string> = {
    new: 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]',
    open: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
    waiting_customer: 'bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]',
    waiting_internal: 'bg-[var(--tag-teal-bg)] text-[var(--tag-teal-fg)]',
    resolved: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
    closed: 'bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]',
    escalated: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
  };
  const label = status.replace(/_/g, ' ');
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}
    >
      {label}
    </span>
  );
}

function CasePriorityBadge({ priority }: { priority: CasePriority }) {
  const styles: Record<CasePriority, string> = {
    low: 'bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]',
    medium: 'bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]',
    high: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
    critical: 'bg-[var(--tag-tomato-bg)] text-[var(--tag-tomato-fg)]',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[priority]}`}
    >
      {priority}
    </span>
  );
}
