import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useLeadRotConfig, useUpsertLeadRotConfig } from '@/hooks/useLeadRot';
import { LEAD_ROT_DEFAULTS, type LeadStatus } from '@bidstack/shared';

import { leadRotDaysDraft } from './lead-rot-days';

// Status codes used in logic and as map keys; display labels are resolved via t().
const STATUS_CODES: LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'nurture',
  'disqualified',
  'converted',
];

type TFn = ReturnType<typeof useTranslation<'settings'>>['t'];

const statusLabel = (t: TFn, status: LeadStatus): string => {
  switch (status) {
    case 'new':
      return t('leadRot.status.new', 'New');
    case 'contacted':
      return t('leadRot.status.contacted', 'Contacted');
    case 'qualified':
      return t('leadRot.status.qualified', 'Qualified');
    case 'nurture':
      return t('leadRot.status.nurture', 'Nurture');
    case 'disqualified':
      return t('leadRot.status.disqualified', 'Disqualified');
    case 'converted':
      return t('leadRot.status.converted', 'Converted');
  }
};

/**
 * Sprint 1 — Krayin import.
 * Lead "Rotten Days" Settings section. Per-status threshold; missing rows
 * fall back to the static defaults in @bidstack/shared. Disqualified and
 * Converted are intentionally excluded from the form because rot does not
 * apply to terminal statuses.
 */
export function LeadRotSection() {
  const { t } = useTranslation('settings');
  const { data, isLoading } = useLeadRotConfig();
  const upsert = useUpsertLeadRotConfig();

  const byStatus = new Map((data?.items ?? []).map((r) => [r.status, r.rottenDays]));

  const onChange = async (status: LeadStatus, rottenDays: number) => {
    try {
      await upsert.mutateAsync({ status, rottenDays });
      toast.success(
        t('leadRot.toast.saved', 'Saved — {{label}} rots after {{count}} days', {
          label: statusLabel(t, status),
          count: rottenDays,
        }),
      );
    } catch {
      toast.error(t('leadRot.toast.saveFailed', 'Save failed'));
    }
  };

  if (isLoading) {
    return (
      <Card>
        {/* Shimmer rows shaped like per-status threshold rows — shared
            bs-shimmer system, not a bare "Loading…" string. */}
        <div
          className="divide-y divide-[var(--border-subtle)]"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('leadRot.loading', 'Loading…')}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden>
              <span className="bs-shimmer h-4 w-32" />
              <span className="bs-shimmer ml-auto h-8 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] px-4 py-2">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
          {t('leadRot.heading', 'Per-status rot threshold')}
        </h3>
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">
          {t(
            'leadRot.subtitle',
            'A lead that sits in a status longer than its threshold shows a “Rot” badge on the kanban and triggers AI-suggested recovery plays.',
          )}
        </p>
      </div>
      <ul
        className="divide-y divide-[var(--border-subtle)]"
        aria-label={t('leadRot.listLabel', 'Rot thresholds')}
      >
        {STATUS_CODES.filter((s) => LEAD_ROT_DEFAULTS[s] !== null).map((status) => {
          const saved = byStatus.get(status) ?? LEAD_ROT_DEFAULTS[status] ?? 0;
          return (
            <LeadRotDaysField
              key={status}
              status={status}
              saved={saved}
              label={statusLabel(t, status)}
              onSave={onChange}
            />
          );
        })}
      </ul>
    </Card>
  );
}

function LeadRotDaysField({
  status,
  saved,
  label,
  onSave,
}: {
  status: LeadStatus;
  saved: number;
  label: string;
  onSave: (status: LeadStatus, rottenDays: number) => void;
}) {
  const { t } = useTranslation('settings');
  const [raw, setRaw] = useState(String(saved));
  const draft = leadRotDaysDraft(raw, saved);
  const errorId = `lead-rot-days-error-${status}`;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="flex-1 text-sm font-medium text-[var(--fg-primary)]">{label}</span>
      <div>
        <label className="inline-flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
          {t('leadRot.daysLabel', 'Days')}
          <input
            type="number"
            min={0}
            max={365}
            inputMode="numeric"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={(e) => {
              const next = leadRotDaysDraft(e.currentTarget.value, saved);
              if (!next.ok || !next.changed) return;
              void onSave(status, next.days);
            }}
            className="min-h-11 w-20 rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
            aria-label={t('leadRot.inputAriaLabel', 'Rotten days for {{label}}', { label })}
            aria-invalid={draft.ok ? undefined : true}
            aria-describedby={draft.ok ? undefined : errorId}
          />
        </label>
        {draft.ok ? null : (
          <p id={errorId} role="alert" className="mt-1 text-xs text-[var(--danger)]">
            {t('leadRot.daysInvalid', 'Enter a whole number of days from 0 to 365.')}
          </p>
        )}
      </div>
    </li>
  );
}
