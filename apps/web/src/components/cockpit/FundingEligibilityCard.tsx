/**
 * FundingEligibilityCard — surfaces vendor co-funding levers derived from the
 * account's technical stack. A Microsoft shop clearly shows ECIF as the headline
 * option (Recommended); AWS/GCP shops show MAP/PSF. Sits beside the tech stack
 * on the account cockpit so the funding signal reads directly off the evidence.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';
import { TechLogo } from '@/components/company/TechLogo';
import { useCompanyTechnicalStack } from '@/hooks/useCompanyTechnicalStack';
import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { deriveFundingPrograms } from './fundingEligibility';

export function FundingEligibilityCard({ cockpit }: { cockpit: AccountCockpitSnapshot }) {
  const { t } = useTranslation('crm');
  const companyKey = cockpit.company.name;
  const ts = useCompanyTechnicalStack(companyKey);
  // Mirror TechStackCard: prefer a saved/curated stack, else the cockpit snapshot.
  const stack =
    ts.data && (ts.data.updatedAt || ts.data.effectiveStack.length > 0)
      ? ts.data.effectiveStack
      : cockpit.technicalStack;
  const programs = useMemo(() => deriveFundingPrograms(stack), [stack]);

  return (
    <Card>
      <SectionHeader
        title={t('fundingEligibility.title', 'Funding eligibility')}
        caption={t('fundingEligibility.caption', 'Vendor co-funding signals from the technical stack')}
      />
      <div className="px-5 pb-5">
        {programs.length === 0 ? (
          <EmptyState
            title={t('fundingEligibility.emptyTitle', 'No co-funding signal yet')}
            message={t(
              'fundingEligibility.emptyMessage',
              'No Microsoft, AWS, or Google footprint detected in the current stack.',
            )}
          />
        ) : (
          <ul className="space-y-3">
            {programs.map((p) => (
              <li
                key={p.key}
                className={`rounded-xl border p-3 ${
                  p.primary
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint,var(--surface-sunken))]'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.primary ? 'jade' : 'blue'}>{p.name}</Badge>
                  {p.primary && <Badge tone="jade">{t('fundingEligibility.recommended', 'Recommended')}</Badge>}
                  <span className="text-sm font-semibold text-[var(--fg-primary)]">{p.fullName}</span>
                  <span className="text-xs text-[var(--fg-tertiary)]">· {p.funder}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--fg-secondary)]">{p.blurb}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
                    {t('fundingEligibility.detected', 'Detected')}
                  </span>
                  {p.matched.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-1"
                    >
                      <TechLogo name={name} size={16} />
                      <span className="text-xs text-[var(--fg-primary)]">{name}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
