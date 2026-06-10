/**
 * leadDetail/ConvertLeadDialog.tsx — convert-to-opportunity form panel.
 *
 * WHY separate: owns its own form state so the page orchestrator stays lean.
 * Parent provides the mutation callback + pending flag; the dialog is purely
 * presentation + local controlled state.
 */
import { useState } from 'react';

import { OpportunityStage } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface ConvertForm {
  opportunityName?: string;
  opportunityValueMicros: number;
  stage: OpportunityStage;
}

export function ConvertLeadDialog({
  companyName,
  isPending,
  onClose,
  onConvert,
}: {
  companyName: string | null | undefined;
  isPending: boolean;
  onClose: () => void;
  onConvert: (form: ConvertForm) => void;
}) {
  const [form, setForm] = useState<Required<ConvertForm>>({
    opportunityName: '',
    opportunityValueMicros: 0,
    stage: 's1_ongoing',
  });

  return (
    <Card className="border border-[var(--brand-primary)]/30">
      <div className="p-5">
        <h3 className="text-lg font-semibold text-[var(--fg-primary)]">Convert lead</h3>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          This will create a new opportunity and contact from this lead.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Opportunity name
            </label>
            <input
              type="text"
              value={form.opportunityName}
              onChange={(e) => setForm((s) => ({ ...s, opportunityName: e.target.value }))}
              placeholder={companyName ? `${companyName} — Opportunity` : 'Opportunity name'}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Value (EUR)
            </label>
            <input
              type="number"
              value={form.opportunityValueMicros / 1_000_000}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  opportunityValueMicros: Math.round(Number(e.target.value) * 1_000_000),
                }))
              }
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              Stage
            </label>
            <select
              value={form.stage}
              onChange={(e) =>
                setForm((s) => ({ ...s, stage: OpportunityStage.parse(e.target.value) }))
              }
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
            >
              <option value="s1_ongoing">Discovery</option>
              <option value="s2_sent">Qualified</option>
              <option value="s3_technical_iteration">Proposal</option>
              <option value="s4_negotiation">Negotiation</option>
              <option value="closed_won">Closed won</option>
              <option value="closed_lost">Closed lost</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button
            onClick={() =>
              // Empty name must be OMITTED — the API schema requires min(1)
              // when present, so sending '' fails the whole conversion.
              onConvert({
                ...form,
                opportunityName: form.opportunityName.trim() || undefined,
              })
            }
            disabled={isPending}
          >
            {isPending ? 'Converting…' : 'Convert lead'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
