/**
 * ForecastList — renders forecast rows as a desktop table (md+) and mobile
 * card stack (<md). Owns inline cell-editing state (`editingCell`); calls back
 * to the parent for actual mutation.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState, LoadingSkeleton, ErrorState } from '@/components/ui/StateMessages';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableScrollArea,
} from '@/components/ui/Table';
import type { Forecast } from '@bidstack/shared';

import { CATEGORIES, CATEGORY_LABELS, type ForecastRow } from './forecastsConfig';

interface EditingCell {
  ownerId: string;
  period: string;
  category: Forecast['category'];
  value: number;
}

interface ForecastListProps {
  rows: ForecastRow[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  onNewForecast: () => void;
  onSaveCell: (
    ownerId: string,
    period: string,
    category: Forecast['category'],
    micros: number,
  ) => void;
  onDeleteRow: (row: ForecastRow) => void;
  formatMoneyMicros: (micros: number, currency: string) => string;
}

export function ForecastList({
  rows,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  onNewForecast,
  onSaveCell,
  onDeleteRow,
  formatMoneyMicros,
}: ForecastListProps) {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);

  const isEditingCell = (row: ForecastRow, cat: Forecast['category']) =>
    editingCell?.ownerId === row.ownerId &&
    editingCell?.period === row.period &&
    editingCell?.category === cat;

  const handleBlurSave = (
    e: React.FocusEvent<HTMLInputElement>,
    row: ForecastRow,
    cat: Forecast['category'],
  ) => {
    const num = Number(e.target.value);
    if (!Number.isNaN(num)) {
      onSaveCell(row.ownerId, row.period, cat, Math.round(num * 1_000_000));
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') setEditingCell(null);
  };

  const rowVal = (row: ForecastRow, cat: Forecast['category']): number => {
    if (cat === 'best_case') return row.bestCase;
    if (cat === 'pipeline') return row.pipeline;
    if (cat === 'commit') return row.commit;
    return row.closed;
  };

  return (
    <Card>
      <SectionHeader title="Forecast Details" caption={`${rows.length} forecast groups`} />

      {isError ? (
        <ErrorState
          title="Failed to load forecasts"
          message={errorMessage}
          action={<Button onClick={onRetry}>Retry</Button>}
        />
      ) : isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No forecasts found"
          message="Try changing the period filter or create your first forecast."
          action={
            <Button size="sm" onClick={onNewForecast}>
              <Icon name="plus" size={14} /> New Forecast
            </Button>
          }
        />
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="hidden md:block">
            <TableScrollArea>
              <Table aria-label="Revenue forecasts">
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Pipeline</TableHead>
                    <TableHead className="text-right">Best Case</TableHead>
                    <TableHead className="text-right">Commit</TableHead>
                    <TableHead className="text-right">Closed</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.ownerId}|${row.period}`}>
                      <TableCell>
                        <span className="text-sm font-medium text-[var(--fg-primary)]">
                          {row.ownerName ?? 'Unassigned'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge tone="gray">{row.period}</Badge>
                      </TableCell>
                      {CATEGORIES.map((cat) => {
                        const val = rowVal(row, cat);
                        return (
                          <TableCell key={cat} className="text-right">
                            {isEditingCell(row, cat) ? (
                              <Input
                                type="number"
                                size="sm"
                                autoFocus
                                defaultValue={val / 1_000_000}
                                className="w-28 text-right"
                                aria-label={`${CATEGORY_LABELS[cat]} for ${row.period}`}
                                onBlur={(e) => handleBlurSave(e, row, cat)}
                                onKeyDown={handleKeyDown}
                              />
                            ) : (
                              <button
                                type="button"
                                className="inline-flex min-w-[80px] justify-end rounded px-3 py-2 text-sm tabular-nums text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] pointer-coarse:min-h-[44px]"
                                onClick={() =>
                                  setEditingCell({
                                    ownerId: row.ownerId,
                                    period: row.period,
                                    category: cat,
                                    value: val,
                                  })
                                }
                                aria-label={`Edit ${CATEGORY_LABELS[cat]} for ${row.period}`}
                              >
                                {formatMoneyMicros(val, 'EUR')}
                              </button>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right">
                        <span className="text-sm font-semibold tabular-nums text-[var(--fg-primary)]">
                          {formatMoneyMicros(
                            row.pipeline + row.bestCase + row.commit + row.closed,
                            'EUR',
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => onDeleteRow(row)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                          aria-label={`Delete forecasts for ${row.period}`}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScrollArea>
          </div>

          {/* ── Mobile cards ── */}
          <div className="md:hidden space-y-3 p-4">
            {rows.map((row) => (
              <div
                key={`${row.ownerId}|${row.period}`}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-[var(--fg-primary)]">
                    {row.ownerName ?? 'Unassigned'}
                  </div>
                  <Badge tone="gray">{row.period}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map((cat) => {
                    const val = rowVal(row, cat);
                    return (
                      <div key={cat} className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
                          {CATEGORY_LABELS[cat]}
                        </span>
                        {isEditingCell(row, cat) ? (
                          <Input
                            type="number"
                            size="sm"
                            autoFocus
                            defaultValue={val / 1_000_000}
                            aria-label={`${CATEGORY_LABELS[cat]} for ${row.period}`}
                            onBlur={(e) => handleBlurSave(e, row, cat)}
                            onKeyDown={handleKeyDown}
                          />
                        ) : (
                          <button
                            type="button"
                            className="inline-flex justify-start rounded px-3 py-2 text-sm tabular-nums text-[var(--fg-secondary)] transition-colors hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] pointer-coarse:min-h-[44px]"
                            onClick={() =>
                              setEditingCell({
                                ownerId: row.ownerId,
                                period: row.period,
                                category: cat,
                                value: val,
                              })
                            }
                            aria-label={`Edit ${CATEGORY_LABELS[cat]} for ${row.period}`}
                          >
                            {formatMoneyMicros(val, 'EUR')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                  <span className="text-xs font-semibold text-[var(--fg-primary)]">
                    Total:{' '}
                    {formatMoneyMicros(
                      row.pipeline + row.bestCase + row.commit + row.closed,
                      'EUR',
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteRow(row)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                    aria-label={`Delete forecasts for ${row.period}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
