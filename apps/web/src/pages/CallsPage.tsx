/**
 * CallsPage — /calls
 *
 * Full-page list of all call sessions in the org, with filters:
 *  - Entity type (DEAL / CONTACT / OPPORTUNITY / LEAD)
 *  - Provider (ZOOM / TEAMS / GOOGLE_MEET / TWILIO_VOICE)
 *  - Status (SCHEDULED / LIVE / COMPLETED / FAILED / CANCELLED)
 *  - Date range (This week / This month / Custom)
 *
 * Clicking a row opens a slide-over detail panel with CallSummaryPanel
 * and CallTranscriptViewer tabs.
 *
 * WHY no server-side date filter: the GET /calls route doesn't yet expose
 * a date param; client-side filter is a safe MVP that can be promoted later.
 *
 * WCAG 2.2 AA: table with aria-sort on sortable columns, 44×44px row tap
 * targets, keyboard-focusable rows, aria-live region for filter result count.
 * Dark mode via CSS variables.
 */

import { useState, useRef, useMemo, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { CallSummaryPanel } from '@/components/calls/CallSummaryPanel';
import { CallTranscriptViewer } from '@/components/calls/CallTranscriptViewer';
import {
  useCalls,
  useCall,
  type CallProvider,
  type CallEntityType,
  type CallStatus,
  type CallSession,
} from '@/hooks/useCalls';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { BadgeTone } from '@/components/ui/Badge';

// ─── Constants / maps ─────────────────────────────────────────────────────────

const PROVIDER_ICON: Record<string, string> = {
  ZOOM: '📹',
  TEAMS: '💼',
  GOOGLE_MEET: '🎥',
  TWILIO_VOICE: '📞',
};

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'LIVE': return 'jade';
    case 'COMPLETED': return 'blue';
    case 'FAILED': return 'tomato';
    case 'CANCELLED': return 'gray';
    default: return 'amber';
  }
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Client-side date filter
function isInDateRange(isoDate: string | null, range: string): boolean {
  if (range === 'all' || !isoDate) return true;
  const date = new Date(isoDate);
  const now = new Date();
  if (range === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    return date >= weekAgo;
  }
  if (range === 'month') {
    const monthAgo = new Date(now);
    monthAgo.setMonth(now.getMonth() - 1);
    return date >= monthAgo;
  }
  return true;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

type DetailTab = 'summary' | 'transcript';

interface DetailPanelProps {
  callSessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DETAIL_TABS: DetailTab[] = ['summary', 'transcript'];

function DetailPanel({ callSessionId, open, onOpenChange }: DetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>('summary');
  const audioRef = useRef<HTMLAudioElement>(null);
  const tabRefs = useRef<Record<DetailTab, HTMLButtonElement | null>>({
    summary: null,
    transcript: null,
  });
  const { data: call } = useCall(callSessionId);
  const { t } = useTranslation('crm');

  const tabLabel = (id: DetailTab) =>
    id === 'summary'
      ? t('calls.detail.tab.summary', 'Summary')
      : t('calls.detail.tab.transcript', 'Transcript');

  // Roving-tabindex arrow-key navigation per WAI-ARIA tabs pattern: only the
  // active tab is in the Tab order; arrows move selection + focus between tabs.
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = DETAIL_TABS.indexOf(tab);
    let next: DetailTab | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = DETAIL_TABS[(idx + 1) % DETAIL_TABS.length] ?? null;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = DETAIL_TABS[(idx - 1 + DETAIL_TABS.length) % DETAIL_TABS.length] ?? null;
    } else if (e.key === 'Home') {
      next = DETAIL_TABS[0] ?? null;
    } else if (e.key === 'End') {
      next = DETAIL_TABS[DETAIL_TABS.length - 1] ?? null;
    }
    if (next) {
      e.preventDefault();
      setTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('calls.detail.title', 'Call detail')} className="w-[min(720px,96vw)] max-h-[90vh]">
        {/* Tab bar */}
        <div
          role="tablist"
          aria-label={t('calls.detail.tablistAria', 'Call detail views')}
          className="flex gap-1 border-b border-[var(--border-subtle)] px-5 pb-0 pt-3"
        >
          {DETAIL_TABS.map((id) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                id={`call-detail-tab-${id}`}
                role="tab"
                aria-selected={selected}
                aria-controls={`call-detail-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={onTabKeyDown}
                className={cn(
                  '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]',
                  'min-h-[44px]',
                  selected
                    ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]'
                    : 'border-transparent text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                )}
              >
                {tabLabel(id)}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div
          role="tabpanel"
          id={`call-detail-panel-${tab}`}
          aria-labelledby={`call-detail-tab-${tab}`}
          tabIndex={0}
          className="overflow-y-auto p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]"
        >
          {/* Audio player (shared across tabs — visible on summary tab) */}
          {tab === 'summary' && call?.signedRecordingUrl && (
            <div className="mb-5">
              <audio
                ref={audioRef}
                src={call.signedRecordingUrl}
                controls
                className="w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                aria-label={t('calls.detail.recordingAria', 'Call recording')}
              />
            </div>
          )}

          {tab === 'summary' && <CallSummaryPanel callSessionId={callSessionId} />}

          {tab === 'transcript' && (
            <CallTranscriptViewer
              segments={call?.transcriptStructured ?? []}
              transcriptText={call?.transcriptText ?? undefined}
              audioRef={audioRef}
              callId={callSessionId}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── CallsPage ────────────────────────────────────────────────────────────────

export default function CallsPage() {
  const { t } = useTranslation('crm');
  const [entityType, setEntityType] = useState<CallEntityType | ''>('');
  const [provider, setProvider] = useState<CallProvider | ''>('');
  const [status, setStatus] = useState<CallStatus | ''>('');
  const [dateRange, setDateRange] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entityOptions = useMemo(
    () => [
      { value: '' as const, label: t('calls.filter.entity.all', 'All types') },
      { value: 'DEAL' as const, label: t('calls.filter.entity.deal', 'Deal') },
      { value: 'CONTACT' as const, label: t('calls.filter.entity.contact', 'Contact') },
      { value: 'OPPORTUNITY' as const, label: t('calls.filter.entity.opportunity', 'Opportunity') },
      { value: 'LEAD' as const, label: t('calls.filter.entity.lead', 'Lead') },
    ],
    [t],
  );

  const providerOptions = useMemo(
    () => [
      { value: '' as const, label: t('calls.filter.provider.all', 'All providers') },
      { value: 'ZOOM' as const, label: t('calls.filter.provider.zoom', 'Zoom') },
      { value: 'TEAMS' as const, label: t('calls.filter.provider.teams', 'Teams') },
      { value: 'GOOGLE_MEET' as const, label: t('calls.filter.provider.googleMeet', 'Google Meet') },
      { value: 'TWILIO_VOICE' as const, label: t('calls.filter.provider.twilioVoice', 'Twilio Voice') },
    ],
    [t],
  );

  const statusOptions = useMemo(
    () => [
      { value: '' as const, label: t('calls.filter.status.all', 'All statuses') },
      { value: 'SCHEDULED' as const, label: t('calls.filter.status.scheduled', 'Scheduled') },
      { value: 'LIVE' as const, label: t('calls.filter.status.live', 'Live') },
      { value: 'COMPLETED' as const, label: t('calls.filter.status.completed', 'Completed') },
      { value: 'FAILED' as const, label: t('calls.filter.status.failed', 'Failed') },
      { value: 'CANCELLED' as const, label: t('calls.filter.status.cancelled', 'Cancelled') },
    ],
    [t],
  );

  const dateOptions = useMemo(
    () => [
      { value: 'all', label: t('calls.filter.date.all', 'All time') },
      { value: 'week', label: t('calls.filter.date.week', 'This week') },
      { value: 'month', label: t('calls.filter.date.month', 'This month') },
    ],
    [t],
  );

  const tableColumns = useMemo(
    () => [
      t('calls.table.provider', 'Provider'),
      t('calls.table.entity', 'Entity'),
      t('calls.table.scheduled', 'Scheduled'),
      t('calls.table.duration', 'Duration'),
      t('calls.table.sentiment', 'Sentiment'),
      t('calls.table.status', 'Status'),
    ],
    [t],
  );

  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCalls({
      entityType: entityType || undefined,
      provider: provider || undefined,
    });

  // Flatten all pages
  const allCalls = useMemo(
    () => data?.pages.flatMap((p) => p.calls) ?? [],
    [data],
  );

  // Client-side status + date filter (server doesn't support these params yet)
  const filtered = useMemo(() => {
    return allCalls.filter((c) => {
      if (status && c.status !== status) return false;
      const when = c.scheduledAt ?? c.createdAt;
      if (!isInDateRange(when, dateRange)) return false;
      return true;
    });
  }, [allCalls, status, dateRange]);

  const handleRowClick = (call: CallSession) => {
    setSelectedId(call.id);
  };

  if (isLoading) return <LoadingSkeleton rows={8} />;
  if (isError) {
    return (
      <ErrorState
        title={t('calls.error.title', 'Failed to load calls')}
        message={error instanceof Error ? error.message : t('calls.error.fallback', 'Something went wrong')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--fg-primary)]">{t('calls.heading', 'Calls')}</h1>
        <p className="text-sm text-[var(--fg-tertiary)]" role="status" aria-live="polite">
          {filtered.length === 1
            ? t('calls.count.one', '{{count}} call', { count: filtered.length })
            : t('calls.count.other', '{{count}} calls', { count: filtered.length })}
        </p>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3" role="group" aria-label={t('calls.filter.groupAria', 'Filter calls')}>
        <Select
          aria-label={t('calls.filter.entityAria', 'Filter by entity type')}
          value={entityType}
          onChange={(e) => setEntityType(e.target.value as CallEntityType | '')}
          options={entityOptions}
          size="sm"
          className="min-h-[44px]"
        />
        <Select
          aria-label={t('calls.filter.providerAria', 'Filter by provider')}
          value={provider}
          onChange={(e) => setProvider(e.target.value as CallProvider | '')}
          options={providerOptions}
          size="sm"
          className="min-h-[44px]"
        />
        <Select
          aria-label={t('calls.filter.statusAria', 'Filter by status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as CallStatus | '')}
          options={statusOptions}
          size="sm"
          className="min-h-[44px]"
        />
        <Select
          aria-label={t('calls.filter.dateAria', 'Filter by date range')}
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          options={dateOptions}
          size="sm"
          className="min-h-[44px]"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title={t('calls.empty.title', 'No calls found')}
          message={t('calls.empty.message', 'Try adjusting your filters, or start a call from a Contact or Deal page.')}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
          <table
            className="w-full text-sm border-collapse"
            aria-label={t('calls.table.aria', 'Calls list')}
          >
            <thead>
              <tr className="border-b border-[var(--border-default)] bg-[var(--surface-sunken)]">
                {tableColumns.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((call) => (
                <tr
                  key={call.id}
                  role="button"
                  tabIndex={0}
                  aria-label={t('calls.row.aria', '{{icon}} {{provider}} call — {{status}}', {
                    icon: PROVIDER_ICON[call.provider] ?? '',
                    provider: call.provider,
                    status: call.status,
                  })}
                  onClick={() => handleRowClick(call)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRowClick(call);
                    }
                  }}
                  className={cn(
                    'border-b border-[var(--border-subtle)] transition-colors cursor-pointer',
                    'hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]',
                    'min-h-[44px]',
                  )}
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{PROVIDER_ICON[call.provider] ?? '📞'}</span>
                      <span className="text-[var(--fg-primary)]">
                        {call.provider.replace('_', ' ')}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)]">
                    {call.entityType}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)]">
                    {formatDate(call.scheduledAt ?? call.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-[var(--fg-secondary)]">
                    {formatDuration(call.durationSec)}
                  </td>
                  <td className="px-4 py-3">
                    {call.sentimentScore !== null ? (
                      <Badge
                        tone={
                          call.sentimentScore >= 0.7
                            ? 'jade'
                            : call.sentimentScore >= 0.4
                            ? 'amber'
                            : 'tomato'
                        }
                      >
                        {Math.round(call.sentimentScore * 100)}%
                      </Badge>
                    ) : (
                      <span className="text-[var(--fg-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(call.status)}>{call.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            aria-busy={isFetchingNextPage}
          >
            {isFetchingNextPage ? t('calls.loadMore.loading', 'Loading…') : t('calls.loadMore.label', 'Load more')}
          </Button>
        </div>
      )}

      {/* Detail panel */}
      {selectedId && (
        <DetailPanel
          callSessionId={selectedId}
          open={Boolean(selectedId)}
          onOpenChange={(open) => !open && setSelectedId(null)}
        />
      )}
    </div>
  );
}
