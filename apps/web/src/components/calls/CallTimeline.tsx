/**
 * CallTimeline — entity activity timeline card for a single CallSession.
 *
 * Shows: provider icon, scheduled/ended time, duration, status badge,
 * summary expand, action-items checklist, sentiment badge, and an audio
 * element for recording playback.
 *
 * Used in entity detail pages (Contact, Opportunity, Lead) inside a list
 * returned by `useCalls({ entityType, entityId })`.
 *
 * WCAG 2.2 AA: keyboard-navigable accordion (Enter/Space), aria-expanded,
 * 44×44px targets, visible focus ring, `prefers-reduced-motion` respected.
 * Audio element has `controls` which provides native browser keyboard shortcuts.
 * Dark mode via CSS variables.
 */

import { useState, useCallback, useId } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useCall, useExtractInsights, type CallSession } from '@/hooks/useCalls';
import { formatDate } from '@/lib/format';
import type { BadgeTone } from '@/components/ui/Badge';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_LABEL: Record<string, string> = {
  ZOOM: 'Zoom',
  TEAMS: 'Teams',
  GOOGLE_MEET: 'Google Meet',
  TWILIO_VOICE: 'Voice call',
};

const PROVIDER_ICON: Record<string, string> = {
  ZOOM: '📹',
  TEAMS: '💼',
  GOOGLE_MEET: '🎥',
  TWILIO_VOICE: '📞',
};

// ─── Status badge tone mapping ────────────────────────────────────────────────

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'LIVE':
      return 'jade';
    case 'COMPLETED':
      return 'blue';
    case 'FAILED':
      return 'tomato';
    case 'CANCELLED':
      return 'gray';
    default:
      return 'amber'; // SCHEDULED
  }
}

// ─── Sentiment badge ──────────────────────────────────────────────────────────

function SentimentBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const tone: BadgeTone = pct >= 70 ? 'jade' : pct >= 40 ? 'amber' : 'tomato';
  const label = pct >= 70 ? 'Positive' : pct >= 40 ? 'Neutral' : 'Negative';
  return (
    <Badge tone={tone} title={`Sentiment score: ${pct}%`}>
      {label} {pct}%
    </Badge>
  );
}

// ─── Duration formatter (deterministic, no LLM) ───────────────────────────────

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Action items list ────────────────────────────────────────────────────────

function ActionItemsList({ items }: { items: string[] }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  if (items.length === 0) return <p className="text-sm text-[var(--fg-tertiary)]">No action items.</p>;
  return (
    <ul className="space-y-1.5" role="list" aria-label="Action items">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={checked.has(i)}
            onClick={() => toggle(i)}
            className={cn(
              'mt-0.5 h-5 w-5 flex-shrink-0 rounded border-2 border-[var(--border-default)] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1',
              'min-h-[44px] min-w-[44px]',
              checked.has(i) && 'border-[var(--brand-primary)] bg-[var(--brand-primary)]',
            )}
            aria-label={`Mark "${item}" as complete`}
          />
          <span
            className={cn(
              'text-sm text-[var(--fg-primary)] leading-snug',
              checked.has(i) && 'text-[var(--fg-tertiary)] line-through',
            )}
          >
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Expanded detail — loads on first expand ──────────────────────────────────

interface ExpandedDetailProps {
  callSessionId: string;
  onOpenTranscript: () => void;
}

function ExpandedDetail({ callSessionId, onOpenTranscript }: ExpandedDetailProps) {
  const { data: call, isLoading, isError } = useCall(callSessionId);
  const extractInsights = useExtractInsights(callSessionId);

  if (isLoading) {
    return (
      <div className="mt-3 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-4 w-full animate-pulse rounded bg-[var(--surface-sunken)]" />
        ))}
      </div>
    );
  }

  if (isError || !call) {
    return (
      <p className="mt-3 text-xs text-[var(--danger)]">Failed to load call details.</p>
    );
  }

  const actionItems = Array.isArray(call.actionItems) ? call.actionItems : [];

  return (
    <div className="mt-3 space-y-4">
      {/* Audio player */}
      {call.signedRecordingUrl && (
        <section aria-label="Call recording">
          <p className="mb-1 text-xs font-medium text-[var(--fg-tertiary)] uppercase tracking-wide">
            Recording
          </p>
          {/* WHY controls attr: provides browser-native keyboard shortcuts (Space=play, arrows=seek) */}
          <audio
            src={call.signedRecordingUrl}
            controls
            className="w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            aria-label="Call recording audio"
          />
        </section>
      )}

      {/* AI summary */}
      {call.summary && (
        <section aria-label="Call summary">
          <p className="mb-1 text-xs font-medium text-[var(--fg-tertiary)] uppercase tracking-wide">
            AI Summary
          </p>
          <p className="text-sm leading-relaxed text-[var(--fg-primary)]">{call.summary}</p>
        </section>
      )}

      {/* Action items */}
      {actionItems.length > 0 && (
        <section aria-label="Action items from this call">
          <p className="mb-2 text-xs font-medium text-[var(--fg-tertiary)] uppercase tracking-wide">
            Action Items
          </p>
          <ActionItemsList items={actionItems} />
        </section>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap gap-2">
        {call.transcriptText && (
          <Button size="sm" variant="secondary" onClick={onOpenTranscript}>
            View transcript
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => extractInsights.mutate()}
          disabled={extractInsights.isPending || !call.transcriptText}
          aria-busy={extractInsights.isPending}
        >
          {extractInsights.isPending ? 'Analysing…' : 'Re-extract insights'}
        </Button>
      </div>
    </div>
  );
}

// ─── CallTimelineCard ─────────────────────────────────────────────────────────

export interface CallTimelineCardProps {
  call: CallSession;
  /** Opens the transcript viewer. */
  onOpenTranscript?: (callSessionId: string) => void;
}

export function CallTimelineCard({ call, onOpenTranscript }: CallTimelineCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sectionId = useId();
  const headerId = `${sectionId}-header`;
  const bodyId = `${sectionId}-body`;

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const providerLabel = PROVIDER_LABEL[call.provider] ?? call.provider;
  const providerIcon = PROVIDER_ICON[call.provider] ?? '📞';
  const when = call.scheduledAt ?? call.createdAt;

  return (
    <article
      aria-label={`${providerLabel} call — ${call.status}`}
      className={cn(
        'rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] transition-colors',
        'dark:bg-[var(--surface-glass)] dark:border-[var(--border-subtle)]',
      )}
    >
      {/* Header row — always visible */}
      <div
        id={headerId}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3 cursor-pointer rounded-lg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring-color)]',
          'min-h-[44px]',
        )}
      >
        {/* Left: icon + provider + time */}
        <div className="flex items-center gap-3 min-w-0">
          <span aria-hidden className="text-xl flex-shrink-0">{providerIcon}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
              {providerLabel}
            </p>
            <p className="text-xs text-[var(--fg-tertiary)]">{formatDate(when)}</p>
          </div>
        </div>

        {/* Right: duration + sentiment + status */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {call.durationSec !== null && (
            <span className="text-xs text-[var(--fg-secondary)]">
              {formatDuration(call.durationSec)}
            </span>
          )}
          <SentimentBadge score={call.sentimentScore} />
          <Badge tone={statusTone(call.status)}>{call.status}</Badge>
          <span
            aria-hidden
            className={cn(
              'text-xs text-[var(--fg-tertiary)] transition-transform duration-150',
              expanded && 'rotate-180',
            )}
          >
            ▾
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={headerId}
          className="border-t border-[var(--border-subtle)] px-4 pb-4"
        >
          <ExpandedDetail
            callSessionId={call.id}
            onOpenTranscript={() => onOpenTranscript?.(call.id)}
          />
        </div>
      )}
    </article>
  );
}

// ─── CallTimeline — list of CallTimelineCards for an entity ───────────────────

export interface CallTimelineProps {
  entityType: 'DEAL' | 'CONTACT' | 'OPPORTUNITY' | 'LEAD';
  entityId: string;
  calls: CallSession[];
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  isFetchingNextPage?: boolean;
  onOpenTranscript?: (callSessionId: string) => void;
}

export function CallTimeline({
  calls,
  hasNextPage,
  onLoadMore,
  isFetchingNextPage,
  onOpenTranscript,
}: CallTimelineProps) {
  if (calls.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-default)] px-6 py-8 text-center">
        <p className="text-sm text-[var(--fg-tertiary)]">No calls recorded yet.</p>
      </div>
    );
  }

  return (
    <section aria-label="Call history">
      <ul className="space-y-2" role="list">
        {calls.map((call) => (
          <li key={call.id}>
            <CallTimelineCard call={call} onOpenTranscript={onOpenTranscript} />
          </li>
        ))}
      </ul>

      {hasNextPage && (
        <div className="mt-4 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            aria-busy={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more calls'}
          </Button>
        </div>
      )}
    </section>
  );
}
