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
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { TechLogo } from '@/components/company/TechLogo';
import { useCompanyTechnicalStack } from '@/hooks/useCompanyTechnicalStack';
import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { fundingRead } from './fundingEligibility';

export function FundingEligibilityCard({ cockpit }: { cockpit: AccountCockpitSnapshot }) {
  const { t } = useTranslation('crm');
  const read = useCompanyTechnicalStack(cockpit.company.name);
  // The cockpit snapshot used to fill an empty read with a canned Microsoft /
  // AWS / Google catalog. Funding waits for this account's own stack, and a
  // sample fixture is not a vendor footprint.
  const posture = useMemo(
    () =>
      read.data
        ? fundingRead(read.data.effectiveStack, read.data.coverage?.sample === true)
        : null,
    [read.data],
  );

  return (
    <Card>
      <SectionHeader
        title={t('fundingEligibility.title', 'Funding eligibility')}
        caption={t('fundingEligibility.caption', 'Vendor co-funding signals from the technical stack')}
      />
      <div className="px-5 pb-5">
        {read.isLoading ? (
          <p className="text-sm text-[var(--fg-secondary)]" role="status">
            {t('fundingEligibility.loading', "Checking this account's stack…")}
          </p>
        ) : read.isError || !posture ? (
          <ErrorState
            title={t('fundingEligibility.errorTitle', "Couldn't load the stack")}
            message={t(
              'fundingEligibility.errorMessage',
              "Co-funding stays hidden until this account's stack loads.",
            )}
          />
        ) : posture.kind === 'programs' ? (
          <ul className="space-y-3">
            {posture.programs.map((p) => (
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
        ) : (
          <EmptyState
            title={t('fundingEligibility.emptyTitle', 'No co-funding signal yet')}
            message={
              posture.kind === 'sample'
                ? t(
                    'fundingEligibility.sampleMessage',
                    'Microsoft, AWS, or Google names on this account are sample data, not a funding signal.',
                  )
                : t(
                    'fundingEligibility.emptyMessage',
                    'No Microsoft, AWS, or Google footprint detected in the current stack.',
                  )
            }
          />
        )}
      </div>
    </Card>
  );
}
