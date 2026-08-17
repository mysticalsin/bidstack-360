// Bid Classification & Governance — the Amaris Bid Office Americas playbook
// (C0–C4) as a working surface, not a reference chart.
//
// Class = project SIZE (FTEs) × COMMITMENT level, NOT revenue; it drives the
// gate count, committee, and final validators. Escalations (risk, margin,
// multi-geo) route to a different senior approver WITHOUT changing class. All
// logic lives in @bidstack/shared/bid-classification (single source of truth);
// the server recomputes the class on save so it can never be free-set.
//
// Mounted on BOTH the Bid/No-Bid page and the opportunity detail page — the
// governance record belongs on the record, and the classification belongs next
// to the decision. One component, two call sites (no second implementation).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  allowedGatesForClass,
  assessBid,
  COMMITMENT_LEVELS,
  BID_LIFECYCLE,
  GATE_LABELS,
  GATE_OUTCOMES,
  RACI_MATRIX,
  type CommitmentLevel,
  type BidClass,
  type EscalationTriggers,
  type BidMission,
  type GateKey,
  type GateOutcome,
} from '@bidstack/shared';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useGateDecisions, useSaveClassification, useRecordGate } from '@/hooks/useBidGovernance';

/** The saved assessment on the opportunity, if it has one. */
export interface SavedClassification {
  bidClass: string | null;
  fteEstimate: number | null;
  commitmentLevel: string | null;
}

interface Props {
  opportunityId?: string;
  /** Seeds the form from the record so the panel opens on the SAVED class. */
  saved?: SavedClassification | null;
}

const OUTCOME_LABEL: Record<GateOutcome, string> = {
  go: 'Go',
  no_go: 'No-Go',
  bid: 'Bid',
  no_bid: 'No-Bid',
  approved: 'Approved',
  rejected: 'Rejected',
};

// The system event the stage-transition route writes when an opportunity
// crosses into the Bid Office zone. It is not a human sign-off and is not
// recordable here — it only has to render legibly in the history.
const HANDOFF_GATE = 'bid_office_handoff';

const NEGATIVE_OUTCOMES = new Set<string>(['no_go', 'no_bid', 'rejected']);

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

function isCommitment(v: string | null | undefined): v is CommitmentLevel {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh';
}

function isBidClass(v: string | null | undefined): v is BidClass {
  return v === 'C0' || v === 'C1' || v === 'C2' || v === 'C3' || v === 'C4';
}

function LabelledList({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {title}
      </p>
      <ul className="space-y-0.5 text-sm text-[var(--fg-secondary)]">
        {items.map((it) => (
          <li key={it} className="flex gap-1.5">
            <span aria-hidden className="text-[var(--fg-tertiary)]">
              ·
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Remounts the form whenever the saved assessment changes, so the draft resets
 * to the persisted values without a setState-in-effect (the convention used by
 * every settings section in this app).
 */
export function BidGovernancePanel({ opportunityId, saved }: Props) {
  return (
    <BidGovernanceForm
      key={`${opportunityId ?? 'none'}:${saved?.bidClass ?? ''}:${saved?.fteEstimate ?? ''}:${saved?.commitmentLevel ?? ''}`}
      opportunityId={opportunityId}
      saved={saved}
    />
  );
}

function BidGovernanceForm({ opportunityId, saved }: Props) {
  const { t } = useTranslation('crm');

  // Seed from the record; fall back to a neutral mid-size bid when unclassified.
  const [fte, setFte] = useState(saved?.fteEstimate ?? 5);
  const [commitment, setCommitment] = useState<CommitmentLevel>(
    isCommitment(saved?.commitmentLevel) ? saved.commitmentLevel : 'medium',
  );
  const [triggers, setTriggers] = useState<EscalationTriggers>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [justification, setJustification] = useState('');

  // Both writes are gated server-side behind opportunities:write — hide the
  // controls rather than letting a read-only role 403 on click.
  const canWrite = useHasPermission('opportunities:write');
  const readOnlyHint = t('bidClass.readOnly', 'You do not have permission to change this');

  const assessment = useMemo(
    () => assessBid(Number.isFinite(fte) ? fte : 0, commitment, triggers),
    [fte, commitment, triggers],
  );
  const { governance, escalations, sizeBand, bidClass } = assessment;

  const savedClass = isBidClass(saved?.bidClass) ? saved.bidClass : null;
  const isDirty = savedClass !== null && savedClass !== bidClass;

  // Gates are class-driven: the API rejects a gate that does not belong to the
  // opportunity's SAVED class, so offer exactly those. Before a class is saved
  // the server treats the bid as unclassified and accepts any gate.
  const gateOptions = useMemo(() => allowedGatesForClass(savedClass), [savedClass]);
  const [gate, setGate] = useState<GateKey>(gateOptions[0] ?? 'go_no_go');
  const outcomeOptions = GATE_OUTCOMES[gate];
  const [outcome, setOutcome] = useState<GateOutcome>(outcomeOptions[0]);

  const saveClassification = useSaveClassification(opportunityId);
  const recordGate = useRecordGate(opportunityId);
  const gateDecisions = useGateDecisions(opportunityId);

  const onSave = () => {
    saveClassification.mutate(
      { fteEstimate: fte, commitmentLevel: commitment },
      {
        onSuccess: (res) =>
          toast.success(
            t('bidClass.savedToast', 'Classification saved', { bidClass: res.bidClass }),
            { description: `${res.bidClass} · ${res.sizeBand} · ${res.fteEstimate} FTE` },
          ),
        onError: (err: Error) =>
          toast.error(t('bidClass.saveFailed', 'Could not save the classification'), {
            description: err.message,
          }),
      },
    );
  };

  const onRecordGate = () => {
    recordGate.mutate(
      { gate, outcome, ...(justification.trim() ? { justification: justification.trim() } : {}) },
      {
        onSuccess: () => {
          setJustification('');
          toast.success(t('bidClass.gateRecorded', 'Gate decision recorded'), {
            description: `${GATE_LABELS[gate]} — ${OUTCOME_LABEL[outcome]}`,
          });
        },
        onError: (err: Error) =>
          toast.error(t('bidClass.gateFailed', 'Could not record the gate decision'), {
            description: err.message,
          }),
      },
    );
  };

  return (
    <Card>
      <SectionHeader
        title={t('bidClass.title', 'Bid Classification & Governance')}
        caption={t(
          'bidClass.subtitle',
          'Amaris Bid Office Americas — class = FTE size × commitment, not revenue',
        )}
        action={
          savedClass ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CLASS_TONE[savedClass]}`}
              title={t('bidClass.savedOn', 'Saved on this opportunity')}
            >
              <Icon name="shield" size={12} ariaHidden />
              {savedClass}
            </span>
          ) : null
        }
      />

      <div className="p-5">
        {/* Inputs */}
        <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-secondary)]">
              {t('bidClass.fte', 'Team size (FTE)')}
            </span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={fte}
              disabled={!canWrite}
              title={canWrite ? undefined : readOnlyHint}
              onChange={(e) => setFte(e.target.valueAsNumber)}
              className="dialog-input h-9 w-28 text-sm disabled:opacity-60"
              aria-label={t('bidClass.fte', 'Team size (FTE)')}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-secondary)]">
              {t('bidClass.commitment', 'Commitment / complexity')}
            </span>
            <div
              className="inline-flex overflow-hidden rounded-md border border-[var(--border-subtle)]"
              role="group"
            >
              {COMMITMENT_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  aria-pressed={commitment === lvl}
                  disabled={!canWrite}
                  title={canWrite ? undefined : readOnlyHint}
                  onClick={() => setCommitment(lvl)}
                  className={`h-9 min-w-[56px] px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:opacity-60 ${
                    commitment === lvl
                      ? 'bg-[var(--brand-primary)] text-white'
                      : 'bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)]'
                  }`}
                >
                  {COMMITMENT_LABEL[lvl]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-secondary)]">
              {t('bidClass.escalations', 'Escalation triggers')}
            </span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ESCALATION_TOGGLES.map((tog) => (
                <label
                  key={tog.key}
                  className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 text-xs text-[var(--fg-secondary)]"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(triggers[tog.key])}
                    onChange={(e) =>
                      setTriggers((prev) => ({ ...prev, [tog.key]: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-[var(--border-subtle)]"
                  />
                  {tog.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Result */}
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div
            className={`flex flex-col items-center justify-center rounded-lg border p-4 ${CLASS_TONE[bidClass]}`}
          >
            <span className="text-3xl font-bold leading-none">{bidClass}</span>
            <span className="mt-1 text-[11px] font-medium uppercase tracking-wider opacity-80">
              {sizeBand} · {governance.estDurationDays[0]}–{governance.estDurationDays[1]}d
            </span>
          </div>

          <div className="space-y-3">
            {isDirty && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {t('bidClass.unsaved', 'Unsaved — this opportunity is still recorded as {{saved}}', {
                  saved: savedClass,
                })}
              </p>
            )}
            <p className="text-sm text-[var(--fg-secondary)]">{governance.description}</p>

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {t('bidClass.gates', 'Governance gates')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {governance.gates.map((g, i) => (
                  <span
                    key={g}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-0.5 text-xs font-medium text-[var(--fg-primary)]"
                  >
                    <span aria-hidden className="text-[var(--fg-tertiary)]">
                      {i + 1}
                    </span>
                    {g}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <LabelledList
                title={t('bidClass.committee', 'Committee')}
                items={governance.committee}
              />
              <LabelledList
                title={t('bidClass.validators', 'Final validators')}
                items={governance.finalValidators}
              />
            </div>

            {governance.specialRules.length > 0 && (
              <LabelledList
                title={t('bidClass.specialRules', 'Special rules')}
                items={governance.specialRules}
              />
            )}

            {escalations.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  <Icon name="warning" size={13} ariaHidden />
                  {t('bidClass.activeEscalations', 'Active escalations (class unchanged)')}
                </p>
                <ul className="space-y-1 text-sm text-[var(--fg-secondary)]">
                  {escalations.map((e) => (
                    <li key={e.id}>
                      <span className="font-medium text-[var(--fg-primary)]">{e.trigger}</span> →{' '}
                      {e.routesTo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Persist to the opportunity + record formal gate decisions */}
        {opportunityId ? (
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            {canWrite ? (
              <>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={saveClassification.isPending}
                  aria-label={t('bidClass.save', 'Save classification to this opportunity')}
                >
                  {saveClassification.isPending
                    ? t('bidClass.saving', 'Saving…')
                    : t('bidClass.saveClass', 'Save {{bidClass}} to this opportunity', {
                        bidClass,
                      })}
                </Button>

                {/* Gate recorder */}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
                      {t('bidClass.gate', 'Gate')}
                    </span>
                    <select
                      value={gate}
                      onChange={(e) => {
                        const next = e.target.value as GateKey;
                        setGate(next);
                        // Outcomes are gate-specific; the API 400s a mismatch.
                        setOutcome(GATE_OUTCOMES[next][0]);
                      }}
                      className="dialog-input h-9 text-xs"
                      aria-label={t('bidClass.gate', 'Gate')}
                    >
                      {gateOptions.map((g) => (
                        <option key={g} value={g}>
                          {GATE_LABELS[g]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--fg-tertiary)]">
                      {t('bidClass.outcome', 'Outcome')}
                    </span>
                    <select
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value as GateOutcome)}
                      className="dialog-input h-9 text-xs"
                      aria-label={t('bidClass.outcome', 'Outcome')}
                    >
                      {outcomeOptions.map((o) => (
                        <option key={o} value={o}>
                          {OUTCOME_LABEL[o]}
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
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onRecordGate}
                    disabled={recordGate.isPending}
                  >
                    {recordGate.isPending
                      ? t('bidClass.recording', 'Recording…')
                      : t('bidClass.recordGate', 'Record gate decision')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--fg-tertiary)]">{readOnlyHint}</p>
            )}

            {/* Gate history */}
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {t('bidClass.history', 'Governance record')}
              </p>
              {gateDecisions.isLoading ? (
                <div className="h-4 w-40 animate-pulse rounded bg-[var(--surface-sunken)]" />
              ) : gateDecisions.isError ? (
                <p role="alert" className="text-xs text-[var(--danger)]">
                  {t('bidClass.historyError', 'Could not load the governance record.')}
                </p>
              ) : (gateDecisions.data?.items.length ?? 0) === 0 ? (
                <p className="text-xs text-[var(--fg-tertiary)]">
                  {t('bidClass.historyEmpty', 'No gate decisions recorded yet.')}
                </p>
              ) : (
                <ul className="space-y-1">
                  {gateDecisions.data!.items.slice(0, 8).map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-[var(--fg-primary)]">
                        {d.gate === HANDOFF_GATE
                          ? t('bidClass.handoff', 'Presales → Bid Office handoff')
                          : (GATE_LABELS[d.gate as GateKey] ?? d.gate)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          NEGATIVE_OUTCOMES.has(d.outcome)
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {OUTCOME_LABEL[d.outcome as GateOutcome] ?? d.outcome}
                      </span>
                      {d.bidClass && <span className="text-[var(--fg-tertiary)]">{d.bidClass}</span>}
                      {d.justification && (
                        <span className="text-[var(--fg-secondary)]">— {d.justification}</span>
                      )}
                      <span className="ml-auto text-[var(--fg-tertiary)]">
                        {new Date(d.decidedAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--fg-tertiary)]">
            {t(
              'bidClass.selectToSave',
              'Select an opportunity above to save this classification and record gate decisions.',
            )}
          </p>
        )}

        {/* Lifecycle + RACI (collapsible to keep the page dense) */}
        <details
          className="mt-4 border-t border-[var(--border-subtle)] pt-3"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="flex min-h-[36px] cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-[var(--fg-secondary)]">
            <Icon name={detailsOpen ? 'chevron-down' : 'chevron-right'} size={14} ariaHidden />
            {t('bidClass.lifecycle', '10-stage lifecycle & RACI')}
          </summary>

          <div className="mt-3 space-y-4">
            <ol className="grid gap-1.5 sm:grid-cols-2">
              {BID_LIFECYCLE.map((s) => (
                <li key={s.stage} className="flex gap-2 text-xs">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--fg-secondary)]">
                    {s.stage}
                  </span>
                  <span>
                    <span className="font-medium text-[var(--fg-primary)]">{s.name}</span>{' '}
                    <span className={`font-semibold ${MISSION_TONE[s.mission]}`}>· {s.mission}</span>
                    <span className="block text-[var(--fg-tertiary)]">{s.exitGate}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead>
                  <tr className="text-left text-[var(--fg-tertiary)]">
                    <th className="py-1 pr-3 font-semibold">
                      {t('bidClass.raciActivity', 'Activity')}
                    </th>
                    {['Business', 'Presales', 'Bid Office', 'Delivery', 'Technical', 'Finance'].map(
                      (f) => (
                        <th key={f} className="px-2 py-1 text-center font-semibold">
                          {f}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {RACI_MATRIX.map((row) => (
                    <tr
                      key={row.activity}
                      className={`border-t border-[var(--border-subtle)] ${
                        row.isGate ? 'bg-[var(--surface-sunken)] font-medium' : ''
                      }`}
                    >
                      <td className="py-1 pr-3 text-[var(--fg-primary)]">
                        {row.isGate && (
                          <span aria-hidden className="mr-1 text-[var(--brand-primary)]">
                            ◆
                          </span>
                        )}
                        {row.activity}
                      </td>
                      {(
                        [
                          'business',
                          'presales',
                          'bidOffice',
                          'delivery',
                          'technical',
                          'finance',
                        ] as const
                      ).map((fn) => (
                        <td
                          key={fn}
                          className="px-2 py-1 text-center text-[var(--fg-secondary)]"
                        >
                          {row.marks[fn] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                {t(
                  'bidClass.raciLegend',
                  'R responsible · A accountable · C consulted · I informed · ◆ governance gate',
                )}
              </p>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}
