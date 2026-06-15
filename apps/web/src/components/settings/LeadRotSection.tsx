import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useLeadRotConfig, useUpsertLeadRotConfig } from '@/hooks/useLeadRot';
import { LEAD_ROT_DEFAULTS, type LeadStatus } from '@bidstack/shared';
import { useTranslation } from 'react-i18next';

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
        <div className="p-6 text-sm text-[var(--fg-secondary)]">
          {t('leadRot.loading', 'Loading…')}
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
          const value = byStatus.get(status) ?? LEAD_ROT_DEFAULTS[status] ?? 0;
          return (
            <li key={status} className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm font-medium text-[var(--fg-primary)]">
                {statusLabel(t, status)}
              </span>
              <label className="inline-flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
                {t('leadRot.daysLabel', 'Days')}
                <input
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={value}
                  onBlur={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (Number.isFinite(n) && n !== value) {
                      void onChange(status, Math.max(0, Math.min(365, Math.floor(n))));
                    }
                  }}
                  className="w-20 rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-2 py-1 text-sm text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
                  aria-label={t('leadRot.inputAriaLabel', 'Rotten days for {{label}}', {
                    label: statusLabel(t, status),
                  })}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
