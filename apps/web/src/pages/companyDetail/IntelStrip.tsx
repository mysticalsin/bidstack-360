// Compact intel strip under the account name (slice 14): revenue with year,
// headcount with growth, open roles with the 30 day delta, funding and
// direction. Each item opens the matching slice 12 intel tab.
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { compactAmount, type CompanyIntelSummary } from '@bidstack/shared';

import { Button } from '@/components/ui/Button';

import {
  EmptyIntel,
  gapFor,
  money,
  provenance,
  revenueText,
  signedPct,
} from '../companiesPage/IntelCells';
import type { IntelStripRead } from './intel-strip-read';

export type IntelTab = 'direction' | 'hiring' | 'financials' | 'news';

function Item({
  name,
  label,
  onClick,
  children,
}: {
  name: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={`${name}: ${label}`}
      title={label}
      onClick={onClick}
      className="flex min-w-0 flex-col items-start gap-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-left transition-colors hover:border-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
    >
      <span className="text-xs font-medium text-[var(--fg-tertiary)]">{name}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-semibold tabular-nums text-[var(--fg-primary)]">
        {children}
      </span>
    </button>
  );
}

function Sub({ children, tone }: { children: ReactNode; tone?: number }) {
  const color =
    tone === undefined || tone === 0
      ? 'text-[var(--fg-tertiary)]'
      : tone > 0
        ? 'text-[var(--success)]'
        : 'text-[var(--danger)]';
  return <span className={`text-xs font-medium ${color}`}>{children}</span>;
}

const DIRECTION = {
  growing: { label: 'Growing', Icon: TrendingUp, tone: 'text-[var(--success)]' },
  steady: { label: 'Steady', Icon: Minus, tone: 'text-[var(--fg-secondary)]' },
  contracting: { label: 'Contracting', Icon: TrendingDown, tone: 'text-[var(--danger)]' },
} as const;

export function IntelStrip({
  summary,
  onOpen,
  crmEmployees = null,
  read = 'ready',
  onRetry,
}: {
  summary: CompanyIntelSummary | null;
  onOpen: (tab: IntelTab) => void;
  crmEmployees?: number | null;
  /** `ready` is a settled read. Loading and error must not look like an empty enrichment. */
  read?: IntelStripRead;
  onRetry?: () => void;
}) {
  const { t } = useTranslation('crm');
  if (read === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex min-h-11 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 text-sm font-medium text-[var(--fg-primary)]"
      >
        {t('companyDetail.intelStrip.loading', 'Loading company intel')}
      </div>
    );
  }
  if (read === 'error') {
    return (
      <div
        role="alert"
        className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2"
      >
        <p className="text-sm font-medium text-[var(--fg-primary)]">
          {t(
            'companyDetail.intelStrip.error',
            "Couldn't load company intel. Please try again.",
          )}
        </p>
        <Button size="lg" variant="secondary" onClick={() => onRetry?.()}>
          {t('companyDetail.intelStrip.retry', 'Retry')}
        </Button>
      </div>
    );
  }
  const s = summary;
  const r = s?.revenue;
  const h = s?.headcount;
  const hg = s?.headcountGrowth;
  const o = s?.openRoles;
  const n = s?.newRoles30d;
  const f = s?.funding;
  const d = s?.direction;
  const gapText = (field: string) => {
    const g = gapFor(s, field);
    return g.detail;
  };
  const delta = n ? n.value - n.prev30 : 0;

  return (
    <div
      role="group"
      aria-label="Company intel"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    >
      <Item
        name="Revenue"
        label={r ? provenance(r, r.fiscalYear ? [`FY${r.fiscalYear}`] : []) : gapText('revenue')}
        onClick={() => onOpen('financials')}
      >
        {r ? (
          <>
            <span>{revenueText(r)}</span>
            {r.fiscalYear ? <Sub>{`FY${r.fiscalYear}`}</Sub> : <Sub>Estimate</Sub>}
          </>
        ) : (
          <EmptyIntel gap={gapFor(s, 'revenue')} />
        )}
      </Item>
      <Item
        name="Headcount"
        label={
          h
            ? `${provenance(h)}${hg ? `; growth ${provenance(hg)}` : ''}`
            : crmEmployees != null
              ? 'CRM record'
              : gapText('headcount')
        }
        onClick={() => onOpen('hiring')}
      >
        {h || crmEmployees != null ? (
          <>
            <span>{compactAmount(h?.value ?? crmEmployees!)}</span>
            {hg ? <Sub tone={hg.value}>{`${signedPct(hg.value)} ${hg.window}`}</Sub> : null}
          </>
        ) : (
          <EmptyIntel gap={gapFor(s, 'headcount')} />
        )}
      </Item>
      <Item
        name="Open roles"
        label={o ? `${provenance(o)}${n ? `; ${n.method}` : ''}` : gapText('openRoles')}
        onClick={() => onOpen('hiring')}
      >
        {o ? (
          <>
            <span>{o.value.toLocaleString()}</span>
            {n ? <Sub tone={delta}>{`${delta >= 0 ? '+' : ''}${delta} 30d`}</Sub> : null}
          </>
        ) : (
          <EmptyIntel gap={gapFor(s, 'openRoles')} />
        )}
      </Item>
      <Item
        name="Funding"
        label={f ? provenance(f) : gapText('funding')}
        onClick={() => onOpen('financials')}
      >
        {f ? (
          <>
            <span>{money(f.value, 'USD')}</span>
            {f.latestRound ? <Sub>{f.latestRound}</Sub> : null}
          </>
        ) : (
          <EmptyIntel gap={gapFor(s, 'funding')} />
        )}
      </Item>
      <Item
        name="Direction"
        label={d ? `${d.reasons.join('. ')}. Inferred` : gapText('direction')}
        onClick={() => onOpen('direction')}
      >
        {d ? (
          <span className={`inline-flex items-center gap-1 ${DIRECTION[d.value].tone}`}>
            {(() => {
              const Glyph = DIRECTION[d.value].Icon;
              return <Glyph className="size-3.5" aria-hidden />;
            })()}
            {DIRECTION[d.value].label}
          </span>
        ) : (
          <EmptyIntel gap={gapFor(s, 'direction')} />
        )}
      </Item>
    </div>
  );
}
