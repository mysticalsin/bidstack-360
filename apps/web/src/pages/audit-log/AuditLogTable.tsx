/**
 * audit-log/AuditLogTable.tsx — evidence stream table with expand/collapse diff
 * detail panel per row. AuditRow is co-located here because it reads the same
 * helper set and is never used outside this component.
 *
 * WHY a separate module: AuditTable + AuditRow together are ~250 lines of table
 * layout, expand/collapse interaction, and raw-JSON diff rendering — all concerns
 * independent of the filter bar and insight panels.
 */
import { Link } from 'react-router-dom';

import type { AuditLogEntry } from '@bidstack/shared';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

import {
  actorInitials,
  actorLabel,
  classifyAudit,
  formatAbsolute,
  formatAction,
  recordHref,
  riskScore,
  summarizeDiff,
  truncateId,
} from './audit-log-helpers';
import { writeClipboard } from './audit-log-export';

// ─── AuditTable ───────────────────────────────────────────────────────────────

export function AuditTable({
  rows,
  rawRowCount,
  expanded,
  onToggle,
  canGoNewer,
  canGoOlder,
  page,
  onOlder,
  onNewer,
}: {
  rows: AuditLogEntry[];
  rawRowCount: number;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  canGoNewer: boolean;
  canGoOlder: boolean;
  page: number;
  onOlder: () => void;
  onNewer: () => void;
}) {
  return (
    <Card className="overflow-hidden border-[var(--border-subtle)] bg-[var(--surface-primary)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Evidence stream</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Showing {rows.length} filtered events from {rawRowCount} loaded records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewer}
            disabled={!canGoNewer}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Newer
          </button>
          <span className="rounded-xl bg-[var(--surface-secondary)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
            Page {page}
          </span>
          <button
            type="button"
            onClick={onOlder}
            disabled={!canGoOlder}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Older
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="grid min-h-[260px] place-items-center px-6 py-12 text-center">
          <div className="max-w-sm">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
              <Icon name="search" className="size-5" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
              No matching evidence
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Adjust the category, record type or search terms to widen the audit trail.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="overflow-x-auto"
          role="region"
          aria-label="Audit evidence table"
          tabIndex={0}
        >
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <caption className="sr-only">Audit log entries, newest first</caption>
            <thead className="sticky top-0 z-10 bg-[var(--surface-secondary)] text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Event
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Actor
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Target
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Time
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AuditRow
                  key={row.id}
                  row={row}
                  isOpen={Boolean(expanded[row.id])}
                  onToggle={() => onToggle(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── AuditRow ─────────────────────────────────────────────────────────────────

function AuditRow({
  row,
  isOpen,
  onToggle,
}: {
  row: AuditLogEntry;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const classification = classifyAudit(row);
  const detailsId = `audit-log-details-${row.id}`;
  const fields = summarizeDiff(row.diff);
  const href = recordHref(row);
  const risk = riskScore(row);

  return (
    <>
      <tr className="border-b border-[var(--border-subtle)] align-top transition hover:bg-[var(--surface-secondary)]/70">
        <td className="px-4 py-4">
          <div className="flex gap-3">
            <span
              className={cn('mt-1 h-14 w-1.5 shrink-0 rounded-full', classification.railClass)}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--text-primary)]">
                  {formatAction(row.action)}
                </span>
                <Badge tone={classification.tone}>{classification.label}</Badge>
                <Badge tone={risk >= 80 ? 'tomato' : risk >= 55 ? 'amber' : 'jade'}>
                  Risk {risk}
                </Badge>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-[var(--text-muted)]">
                {row.action}
              </div>
              {fields.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {fields.slice(0, 3).map((field) => (
                    <span
                      key={field}
                      className="rounded-full bg-[var(--surface-secondary)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                    >
                      {field}
                    </span>
                  ))}
                  {fields.length > 3 && (
                    <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
                      +{fields.length - 3} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </td>

        <td className="px-4 py-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-secondary)] text-xs font-semibold text-[var(--text-primary)]"
            >
              {actorInitials(row)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-[var(--text-primary)]">
                {actorLabel(row)}
              </div>
              <div className="truncate text-xs text-[var(--text-muted)]">
                {row.userEmail || 'System generated'}
              </div>
            </div>
          </div>
        </td>

        <td className="px-4 py-4">
          <div className="space-y-1">
            <Badge tone="gray">{row.targetType || 'system'}</Badge>
            <div
              className="font-mono text-xs text-[var(--text-muted)]"
              title={row.targetId ?? undefined}
              aria-label={row.targetId ? `Target id ${row.targetId}` : 'No record reference'}
            >
              {row.targetId ? truncateId(row.targetId) : 'No record reference'}
            </div>
            {row.targetId && (
              <div className="flex flex-wrap gap-1.5">
                {href && (
                  <Link
                    to={href}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
                  >
                    <Icon name="arrow" className="size-3" />
                    Open
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => writeClipboard(row.targetId ?? '')}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
                >
                  <Icon name="link" className="size-3" />
                  Copy ID
                </button>
              </div>
            )}
          </div>
        </td>

        <td className="px-4 py-4">
          <time
            dateTime={row.createdAt}
            aria-label={formatAbsolute(row.createdAt)}
            className="block font-medium text-[var(--text-primary)]"
          >
            {relativeTime(row.createdAt)}
          </time>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {formatAbsolute(row.createdAt)}
          </div>
        </td>

        <td className="px-4 py-4 text-right">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={detailsId}
            aria-label={`${isOpen ? 'Hide' : 'Inspect'} diff payload for ${formatAction(row.action)} by ${actorLabel(row)}`}
            onClick={onToggle}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-secondary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
          >
            {isOpen ? 'Hide' : 'Inspect'}
            <Icon name="caret" className={cn('size-3 transition', isOpen && 'rotate-180')} />
          </button>
        </td>
      </tr>

      {isOpen && (
        <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)]/70">
          <td colSpan={5} className="px-4 py-4">
            <div
              id={detailsId}
              role="region"
              aria-label={`Diff payload for ${formatAction(row.action)}`}
              className="grid gap-3 lg:grid-cols-[320px,1fr]"
            >
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Change summary
                </div>
                {fields.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                    {fields.map((field) => (
                      <li key={field} className="flex gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]" />
                        <span>{field}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                    No structured diff was captured for this event. Use the raw payload when
                    forensic detail is required.
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Raw evidence payload
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => writeClipboard(JSON.stringify(row.diff ?? {}, null, 2))}
                      className="inline-flex min-h-8 items-center rounded-lg border border-[var(--border-subtle)] px-2 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-primary)]/15"
                    >
                      Copy JSON
                    </button>
                    <Badge tone="gray">Immutable</Badge>
                  </div>
                </div>
                <pre className="max-h-[360px] overflow-auto rounded-xl bg-[var(--code-bg)] p-4 text-xs leading-6 text-[var(--code-fg)]">
                  {JSON.stringify(row.diff ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
