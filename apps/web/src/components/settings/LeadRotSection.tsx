import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { useLeadRotConfig, useUpsertLeadRotConfig } from '@/hooks/useLeadRot';
import { LEAD_ROT_DEFAULTS, type LeadStatus } from '@bidstack/shared';

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  nurture: 'Nurture',
  disqualified: 'Disqualified',
  converted: 'Converted',
};

/**
 * Sprint 1 — Krayin import.
 * Lead "Rotten Days" Settings section. Per-status threshold; missing rows
 * fall back to the static defaults in @bidstack/shared. Disqualified and
 * Converted are intentionally excluded from the form because rot does not
 * apply to terminal statuses.
 */
export function LeadRotSection() {
  const { data, isLoading } = useLeadRotConfig();
  const upsert = useUpsertLeadRotConfig();

  const byStatus = new Map((data?.items ?? []).map((r) => [r.status, r.rottenDays]));

  const onChange = async (status: LeadStatus, rottenDays: number) => {
    try {
      await upsert.mutateAsync({ status, rottenDays });
      toast.success(`Saved — ${STATUS_LABELS[status]} rots after ${rottenDays} days`);
    } catch {
      toast.error('Save failed');
    }
  };

  if (isLoading) {
    return (
      <Card>
        <div className="p-6 text-sm text-[var(--fg-secondary)]">Loading…</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="border-b border-[var(--border-subtle)] px-4 py-2">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">Per-status rot threshold</h3>
        <p className="mt-1 text-xs text-[var(--fg-secondary)]">
          A lead that sits in a status longer than its threshold shows a &ldquo;Rot&rdquo; badge on
          the kanban and triggers AI-suggested recovery plays.
        </p>
      </div>
      <ul className="divide-y divide-[var(--border-subtle)]" aria-label="Rot thresholds">
        {(Object.keys(STATUS_LABELS) as LeadStatus[])
          .filter((s) => LEAD_ROT_DEFAULTS[s] !== null)
          .map((status) => {
            const value = byStatus.get(status) ?? LEAD_ROT_DEFAULTS[status] ?? 0;
            return (
              <li key={status} className="flex items-center gap-3 px-4 py-3">
                <span className="flex-1 text-sm font-medium text-[var(--fg-primary)]">
                  {STATUS_LABELS[status]}
                </span>
                <label className="inline-flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
                  Days
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
                    aria-label={`Rotten days for ${STATUS_LABELS[status]}`}
                  />
                </label>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}
