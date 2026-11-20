/**
 * leadDetail/ConvertLeadDialog.tsx — convert-to-opportunity form panel.
 *
 * WHY separate: owns its own form state so the page orchestrator stays lean.
 * Parent provides the mutation callback + pending flag; the dialog is purely
 * presentation + local controlled state.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('crm');
  const [form, setForm] = useState<Required<ConvertForm>>({
    opportunityName: '',
    opportunityValueMicros: 0,
    stage: 's1_ongoing',
  });

  return (
    <Card className="border border-[var(--brand-primary)]/30">
      <div className="p-5">
        <h3 className="text-lg font-semibold text-[var(--fg-primary)]">
          {t('convertLead.title', 'Convert lead')}
        </h3>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t(
            'convertLead.description',
            'This will create a new opportunity and contact from this lead.',
          )}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              {t('convertLead.opportunityNameLabel', 'Opportunity name')}
            </label>
            <input
              type="text"
              value={form.opportunityName}
              onChange={(e) => setForm((s) => ({ ...s, opportunityName: e.target.value }))}
              placeholder={
                companyName
                  ? t('convertLead.opportunityNamePlaceholderWithCompany', '{{companyName}} — Opportunity', {
                      companyName,
                    })
                  : t('convertLead.opportunityNamePlaceholder', 'Opportunity name')
              }
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              {t('convertLead.valueLabel', 'Value (EUR)')}
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
              {t('convertLead.stageLabel', 'Stage')}
            </label>
            <select
              value={form.stage}
              onChange={(e) =>
                setForm((s) => ({ ...s, stage: OpportunityStage.parse(e.target.value) }))
              }
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--brand-primary)]"
            >
              <option value="s1_ongoing">{t('convertLead.stageDiscovery', 'Discovery')}</option>
              <option value="s2_sent">{t('convertLead.stageQualified', 'Qualified')}</option>
              <option value="s3_technical_iteration">
                {t('convertLead.stageProposal', 'Proposal')}
              </option>
              <option value="s4_negotiation">
                {t('convertLead.stageNegotiation', 'Negotiation')}
              </option>
              <option value="closed_won">{t('convertLead.stageClosedWon', 'Closed won')}</option>
              <option value="closed_lost">{t('convertLead.stageClosedLost', 'Closed lost')}</option>
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
            {isPending
              ? t('convertLead.converting', 'Converting…')
              : t('convertLead.submit', 'Convert lead')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('convertLead.cancel', 'Cancel')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
