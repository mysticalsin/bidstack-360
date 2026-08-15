// Bid Classification & Governance — encodes the Amaris Bid Office Americas
// playbook (C0–C4). Class = project SIZE (FTEs) × COMMITMENT level, NOT revenue;
// it drives the gate count, committee, and final validators. Escalations (risk,
// margin, multi-geo) route to a different senior approver WITHOUT changing class.
// All logic lives in @bidstack/shared/bid-classification (single source of truth).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  assessBid,
  COMMITMENT_LEVELS,
  BID_LIFECYCLE,
  RACI_MATRIX,
  type CommitmentLevel,
  type BidClass,
  type EscalationTriggers,
  type BidMission,
} from '@bidstack/shared';

import { Icon } from '@/components/ui/Icon';
import { useGateDecisions, useSaveClassification, useRecordGate } from '@/hooks/useBidGovernance';

const PANEL = 'rounded-lg border border-border-subtle bg-surface-card p-4';

// Gates a user can record from here (superset of the class-specific named gates).
const GATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'go_no_go', label: 'Go/No-Go' },
  { value: 'bid_no_bid', label: 'Bid/No-Bid' },
  { value: 'strategy_validation', label: 'Strategy Validation' },
  { value: 'proposal_review', label: 'Proposal Review' },
  { value: 'pricing_bid_validation', label: 'Pricing & Bid Validation' },
  { value: 'quality_check', label: 'Quality Check' },
];
const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: 'go', label: 'Go' },
  { value: 'no_go', label: 'No-Go' },
  { value: 'bid', label: 'Bid' },
  { value: 'no_bid', label: 'No-Bid' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
const GATE_LABEL = Object.fromEntries(GATE_OPTIONS.map((g) => [g.value, g.label]));
const OUTCOME_LABEL = Object.fromEntries(OUTCOME_OPTIONS.map((o) => [o.value, o.label]));

// Severity tone per class — a legitimate status encoding (simple→strategic).
const CLASS_TONE: Record<BidClass, string> = {
  C0: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  C1: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  C2: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  C3: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
  C4: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
};

const MISSION_TONE: Record<BidMission, string> = {
  Shape: 'text-sky-600 dark:text-sky-400',
  Build: 'text-amber-600 dark:text-amber-400',
  Deliver: 'text-emerald-600 dark:text-emerald-400',
};

const COMMITMENT_LABEL: Record<CommitmentLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
};

const ESCALATION_TOGGLES: { key: keyof EscalationTriggers; label: string }[] = [
  { key: 'highRisk', label: 'High risk level' },
  { key: 'marginBelow25', label: 'WC margin < 25% / blocked' },
  { key: 'multiGeoOrBrand', label: 'Multi-geo / multi-brand' },
  { key: 'needsTechnicalValidation', label: 'Needs technical validation' },
];

function LabelledList({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
        {title}
      </p>
      <ul className="space-y-0.5 text-sm text-fg-secondary">
        {items.map((it) => (
          <li key={it} className="flex gap-1.5">
            <span aria-hidden className="text-fg-tertiary">
              ·
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BidClassificationPanel({ opportunityId }: { opportunityId?: string }) {
  const { t } = useTranslation('crm');
  const [fte, setFte] = useState(5);
  const [commitment, setCommitment] = useState<CommitmentLevel>('medium');
  const [triggers, setTriggers] = useState<EscalationTriggers>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [gate, setGate] = useState('go_no_go');
  const [outcome, setOutcome] = useState('go');
  const [justification, setJustification] = useState('');

  const assessment = useMemo(
    () => assessBid(Number.isFinite(fte) ? fte : 0, commitment, triggers),
    [fte, commitment, triggers],
  );
  const { governance, escalations, sizeBand, bidClass } = assessment;

  const saveClassification = useSaveClassification(opportunityId);
  const recordGate = useRecordGate(opportunityId);
  const gateDecisions = useGateDecisions(opportunityId);

  return (
    <section className={`${PANEL} mb-6`} aria-label={t('bidClass.aria', 'Bid classification and governance')}>
      <div className="mb-3 flex items-center gap-2">
        <Icon name="shield" size={16} className="text-brand-primary" />
        <h2 className="text-sm font-semibold text-fg-primary">
          {t('bidClass.title', 'Bid Classification & Governance')}
        </h2>
        <span className="text-xs text-fg-tertiary">
          {t('bidClass.subtitle', 'Amaris Bid Office Americas — class = FTE size × commitment, not revenue')}
        </span>
      </div>

      {/* Inputs */}
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-fg-secondary">
            {t('bidClass.fte', 'Team size (FTE)')}
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={fte}
            onChange={(e) => setFte(e.target.valueAsNumber)}
            className="dialog-input h-9 w-28 text-sm"
            aria-label={t('bidClass.fte', 'Team size (FTE)')}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-fg-secondary">
            {t('bidClass.commitment', 'Commitment / complexity')}
          </span>
          <div className="inline-flex overflow-hidden rounded-md border border-border-subtle" role="group">
            {COMMITMENT_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                aria-pressed={commitment === lvl}
                onClick={() => setCommitment(lvl)}
                className={`h-9 min-w-[56px] px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] ${
                  commitment === lvl
                    ? 'bg-brand-primary text-white'
                    : 'bg-transparent text-fg-secondary hover:bg-surface-hover'
                }`}
              >
                {COMMITMENT_LABEL[lvl]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-fg-secondary">
            {t('bidClass.escalations', 'Escalation triggers')}
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ESCALATION_TOGGLES.map((tog) => (
              <label key={tog.key} className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  checked={Boolean(triggers[tog.key])}
                  onChange={(e) => setTriggers((prev) => ({ ...prev, [tog.key]: e.target.checked }))}
                  className="h-4 w-4 rounded border-border-subtle"
                />
                {tog.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className={`flex flex-col items-center justify-center rounded-lg border p-4 ${CLASS_TONE[bidClass]}`}>
          <span className="text-3xl font-bold leading-none">{bidClass}</span>
          <span className="mt-1 text-[11px] font-medium uppercase tracking-wider opacity-80">
            {sizeBand} · {governance.estDurationDays[0]}–{governance.estDurationDays[1]}d
          </span>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">{governance.description}</p>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
              {t('bidClass.gates', 'Governance gates')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {governance.gates.map((gate, i) => (
                <span
                  key={gate}
                  className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-hover px-2.5 py-0.5 text-xs font-medium text-fg-primary"
                >
                  <span aria-hidden className="text-fg-tertiary">
                    {i + 1}
                  </span>
                  {gate}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <LabelledList title={t('bidClass.committee', 'Committee')} items={governance.committee} />
            <LabelledList title={t('bidClass.validators', 'Final validators')} items={governance.finalValidators} />
          </div>

          {governance.specialRules.length > 0 && (
            <LabelledList title={t('bidClass.specialRules', 'Special rules')} items={governance.specialRules} />
          )}

          {escalations.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <Icon name="warning" size={13} ariaHidden />
                {t('bidClass.activeEscalations', 'Active escalations (class unchanged)')}
              </p>
              <ul className="space-y-1 text-sm text-fg-secondary">
                {escalations.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium text-fg-primary">{e.trigger}</span> → {e.routesTo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Persist to the selected opportunity + record formal gate decisions */}
      {opportunityId ? (
        <div className="mt-4 border-t border-border-subtle pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => saveClassification.mutate({ fteEstimate: fte, commitmentLevel: commitment })}
              disabled={saveClassification.isPending}
              className="inline-flex h-9 items-center rounded-md bg-brand-primary px-3 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
              {saveClassification.isPending
                ? t('bidClass.saving', 'Saving…')
                : t('bidClass.save', `Save ${bidClass} to this opportunity`)}
            </button>
            {saveClassification.isSuccess && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {t('bidClass.saved', 'Saved to opportunity')}
              </span>
            )}
            {saveClassification.isError && (
              <span role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
                {t('bidClass.saveFailed', 'Save failed')}
              </span>
            )}
          </div>

          {/* Gate recorder */}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                {t('bidClass.gate', 'Gate')}
              </span>
              <select value={gate} onChange={(e) => setGate(e.target.value)} className="dialog-input h-9 text-xs">
                {GATE_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                {t('bidClass.outcome', 'Outcome')}
              </span>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="dialog-input h-9 text-xs">
                {OUTCOME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder={t('bidClass.justificationPlaceholder', 'Justification (optional)')}
              className="dialog-input h-9 min-w-[180px] flex-1 text-xs"
              aria-label={t('bidClass.justification', 'Gate justification')}
            />
            <button
              type="button"
              onClick={() =>
                recordGate.mutate(
                  {
                    gate,
                    outcome,
                    ...(justification.trim() ? { justification: justification.trim() } : {}),
                  },
                  { onSuccess: () => setJustification('') },
                )
              }
              disabled={recordGate.isPending}
              className="inline-flex h-9 items-center rounded-md border border-border-subtle px-3 text-xs font-medium text-fg-primary transition-colors hover:bg-surface-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
            >
              {recordGate.isPending ? t('bidClass.recording', 'Recording…') : t('bidClass.recordGate', 'Record gate decision')}
            </button>
          </div>

          {/* Gate history */}
          {gateDecisions.data && gateDecisions.data.items.length > 0 && (
            <ul className="mt-3 space-y-1">
              {gateDecisions.data.items.slice(0, 6).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-fg-primary">{GATE_LABEL[d.gate] ?? d.gate}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      /go$|^bid$|approved/.test(d.outcome)
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {OUTCOME_LABEL[d.outcome] ?? d.outcome}
                  </span>
                  {d.bidClass && <span className="text-fg-tertiary">{d.bidClass}</span>}
                  {d.justification && <span className="text-fg-secondary">— {d.justification}</span>}
                  <span className="ml-auto text-fg-tertiary">{new Date(d.decidedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3 border-t border-border-subtle pt-3 text-xs text-fg-tertiary">
          {t('bidClass.selectToSave', 'Select an opportunity above to save this classification and record gate decisions.')}
        </p>
      )}

      {/* Lifecycle + RACI (collapsible to keep the page dense) */}
      <details
        className="mt-4 border-t border-border-subtle pt-3"
        open={detailsOpen}
        onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex min-h-[36px] cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-fg-secondary">
          <Icon name={detailsOpen ? 'chevron-down' : 'chevron-right'} size={14} ariaHidden />
          {t('bidClass.lifecycle', '10-stage lifecycle & RACI')}
        </summary>

        <div className="mt-3 space-y-4">
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {BID_LIFECYCLE.map((s) => (
              <li key={s.stage} className="flex gap-2 text-xs">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle text-[10px] font-semibold text-fg-secondary">
                  {s.stage}
                </span>
                <span>
                  <span className="font-medium text-fg-primary">{s.name}</span>{' '}
                  <span className={`font-semibold ${MISSION_TONE[s.mission]}`}>· {s.mission}</span>
                  <span className="block text-fg-tertiary">{s.exitGate}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="text-left text-fg-tertiary">
                  <th className="py-1 pr-3 font-semibold">{t('bidClass.raciActivity', 'Activity')}</th>
                  {['Business', 'Presales', 'Bid Office', 'Delivery', 'Technical', 'Finance'].map((f) => (
                    <th key={f} className="px-2 py-1 text-center font-semibold">
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RACI_MATRIX.map((row) => (
                  <tr
                    key={row.activity}
                    className={`border-t border-border-subtle ${row.isGate ? 'bg-surface-hover font-medium' : ''}`}
                  >
                    <td className="py-1 pr-3 text-fg-primary">
                      {row.isGate && <span aria-hidden className="mr-1 text-brand-primary">◆</span>}
                      {row.activity}
                    </td>
                    {(['business', 'presales', 'bidOffice', 'delivery', 'technical', 'finance'] as const).map((fn) => (
                      <td key={fn} className="px-2 py-1 text-center text-fg-secondary">
                        {row.marks[fn] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-fg-tertiary">
              {t('bidClass.raciLegend', 'R responsible · A accountable · C consulted · I informed · ◆ governance gate')}
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}
