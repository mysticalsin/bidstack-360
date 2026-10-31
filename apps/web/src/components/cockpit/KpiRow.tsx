import { motion, useReducedMotion } from 'framer-motion';
import { memo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { springSnap, staggerChild, staggerParent } from '@/lib/motion';
import { GlassCard } from '@/components/ui/GlassCard';

import type { AccountCockpitSnapshot, CockpitKpi } from '@bidstack/shared';

import { KPI_TONE_FG, iconForKpi } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

// The account view never mixes its two data worlds: Apollo-sourced External
// Intelligence renders apart from Internal Data (ABC / Opportunity
// Management), each under an explicit header. A manually edited field moves
// to Internal and carries the "manually overridden" flag.
export const KpiRow = memo(function KpiRow({ cockpit }: Props) {
  const { t } = useTranslation('crm');
  const external = cockpit.kpis.filter((k) => k.block === 'external');
  const internal = cockpit.kpis.filter((k) => k.block !== 'external');
  const companyOverrideKey = cockpit.company.name;
  const lastSynced = cockpit.externalLastSyncedAt
    ? cockpit.externalLastSyncedAt.slice(0, 10)
    : null;

  return (
    <section className="space-y-3" aria-label="Account metrics">
      <KpiBlock
        title={t('kpiRow.externalIntelligence', 'External Intelligence')}
        caption={
          lastSynced
            ? `${t('kpiRow.externalLastUpdated', 'External source · Last updated:')} ${lastSynced} ${t('kpiRow.externalRefreshes', '(refreshes ~every 2 weeks)')}`
            : t('kpiRow.externalNotSynced', 'External source · not synced yet')
        }
        kpis={external}
        companyKey={companyOverrideKey}
        editable
      />
      <KpiBlock
        title={t('kpiRow.internalData', 'Internal Data')}
        caption={t('kpiRow.internalCaption', 'ABC / Opportunity Management — projects, deals, outcomes')}
        kpis={internal}
        companyKey={companyOverrideKey}
      />
    </section>
  );
});

function KpiBlock({
  title,
  caption,
  kpis,
  companyKey,
  editable = false,
}: {
  title: string;
  caption: string;
  kpis: CockpitKpi[];
  companyKey: string;
  editable?: boolean;
}) {
  const reduced = useReducedMotion();
  if (kpis.length === 0) return null;
  const cols = Math.min(6, Math.max(3, kpis.length));
  const colsClass = cols >= 6 ? 'cols-6' : cols >= 4 ? 'cols-4' : 'cols-3';
  return (
    <motion.section
      aria-label={title}
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
    >
      <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
          {title}
        </h3>
        <span className="text-[11px] text-[var(--fg-tertiary)]">{caption}</span>
      </div>
      <div className={`kpi-grid kpi-grid-compact ${colsClass}`}>
        {kpis.map((kpi) => (
          <GlassCard
            key={kpi.label}
            className="kpi-chip"
            padding="none"
            hoverable={false}
            variants={reduced ? undefined : staggerChild}
            transition={springSnap}
            style={{ borderTop: `3px solid ${KPI_TONE_FG[kpi.tone]}` }}
          >
            <div className="kpi-chip-label">
              <Icon name={iconForKpi(kpi.label)} size={14} />
              <span>{kpi.label}</span>
            </div>
            <div className="kpi-value">
              <KpiValue raw={kpi.value} reduced={reduced} />
            </div>
            {(editable || kpi.overridden) && kpi.fieldKey ? (
              <FieldOverrideEditor kpi={kpi} companyKey={companyKey} />
            ) : null}
          </GlassCard>
        ))}
      </div>
    </motion.section>
  );
}

/**
 * Inline editor for an Apollo-sourced KPI. Saving creates a field override:
 * the value moves to the Internal Data block on the next snapshot and is
 * flagged as manually overridden — the Apollo snapshot itself is untouched.
 */
function FieldOverrideEditor({ kpi, companyKey }: { kpi: CockpitKpi; companyKey: string }) {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const queryClient = useQueryClient();
  const fieldKey = kpi.fieldKey as NonNullable<CockpitKpi['fieldKey']>;

  const save = useMutation({
    mutationFn: (value: string | number) =>
      api(`/api/crm/companies/${encodeURIComponent(companyKey)}/field-overrides`, {
        method: 'PUT',
        body: { fieldKey, value },
      }),
    onSuccess: () => {
      toast.success(t('kpiRow.toastFieldOverridden', 'Field overridden'), {
        description: t('kpiRow.toastFieldOverriddenDesc', '{{label}} moved to Internal Data with your value.', { label: kpi.label }),
      });
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
    onError: (err: Error) => toast.error(t('kpiRow.toastOverrideFailed', 'Override failed'), { description: err.message }),
  });

  const revert = useMutation({
    mutationFn: () =>
      api(
        `/api/crm/companies/${encodeURIComponent(companyKey)}/field-overrides/${fieldKey}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      toast.success(t('kpiRow.toastReverted', 'Reverted to external value'), {
        description: t('kpiRow.toastRevertedDesc', '{{label}} uses the external source value again.', { label: kpi.label }),
      });
      void queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
    onError: (err: Error) => toast.error(t('kpiRow.toastRevertFailed', 'Revert failed'), { description: err.message }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (fieldKey === 'industry') {
      save.mutate(trimmed);
      return;
    }
    const numeric = Number(trimmed.replace(/[,\s]/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error(t('kpiRow.toastInvalidValue', 'Invalid value'), { description: t('kpiRow.toastEnterPositiveNumber', 'Enter a positive number.') });
      return;
    }
    // Revenue is entered in plain currency units; the wire wants micros.
    save.mutate(fieldKey === 'annualRevenueMicros' ? Math.round(numeric * 1_000_000) : numeric);
  };

  if (!open) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center rounded px-2 text-[11px] font-medium text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
          aria-label={t('kpiRow.overrideAria', 'Override {{label}}', { label: kpi.label })}
          onClick={() => setOpen(true)}
        >
          {t('kpiRow.btnEdit', 'Edit')}
        </button>
        {kpi.overridden ? (
          <button
            type="button"
            disabled={revert.isPending}
            className="inline-flex min-h-[44px] items-center rounded px-2 text-[11px] font-medium text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)] disabled:opacity-50"
            aria-label={t('kpiRow.revertAria', 'Revert {{label}} to the external source value', { label: kpi.label })}
            onClick={() => revert.mutate()}
          >
            {revert.isPending ? '…' : t('kpiRow.btnRevert', 'Revert')}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        aria-label={t('kpiRow.newValueAria', 'New value for {{label}}', { label: kpi.label })}
        placeholder={fieldKey === 'industry' ? t('kpiRow.placeholderIndustry', 'Industry') : t('kpiRow.placeholderNumber', 'Number')}
        className="min-h-[44px] w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 text-xs text-[var(--fg-primary)]"
      />
      <button
        type="submit"
        disabled={save.isPending}
        className="inline-flex min-h-[44px] items-center rounded bg-[var(--brand-primary)] px-2.5 text-[11px] font-semibold text-[var(--fg-on-brand,white)] disabled:opacity-50"
      >
        {save.isPending ? '…' : t('kpiRow.btnSave', 'Save')}
      </button>
    </form>
  );
}

// Parse a formatted KPI value like "€12,345", "48%", "2.5x", "1,200 days"
// and animate just the numeric portion. The prefix and suffix render as
// static text so currency symbols and units don't flicker mid-tween.
// If no number is found (e.g. "Healthy"), render the string verbatim.
const NUM_RE = /(-?\d[\d,]*(?:\.\d+)?)/;

function KpiValue({ raw, reduced }: { raw: string; reduced: boolean | null }) {
  const match = NUM_RE.exec(raw);
  if (!match) return <>{raw}</>;
  const literal = match[1] ?? '';
  const target = Number(literal.replace(/,/g, ''));
  if (!Number.isFinite(target)) return <>{raw}</>;
  // Honor reduced motion: print the final value with zero-duration animate.
  // We still mount AnimatedNumber so the layout doesn't shift between modes.
  const prefix = raw.slice(0, match.index);
  const suffix = raw.slice(match.index + literal.length);
  const hasDecimals = literal.includes('.');
  return (
    <>
      {prefix}
      <AnimatedNumber
        value={target}
        duration={reduced ? 0 : 0.9}
        format={(n) =>
          hasDecimals
            ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
            : Math.round(n).toLocaleString()
        }
      />
      {suffix}
    </>
  );
}
