// Intel display cards for the opportunity detail page. All read from
// IntelPayload and render — no mutations, no hooks other than useReducedMotion.
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { formatDate, formatMoney } from '@/lib/format';
import type { IntelPayload } from '@bidstack/shared';

// ── tiny utility used by all financial rows ──────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--fg-tertiary)]">{label}</span>
      <span className="font-medium text-[var(--fg-primary)] tabular-nums">{value}</span>
    </div>
  );
}

// ── cards ─────────────────────────────────────────────────────────────────────

export function DataFreshnessRibbon({ refreshedAt }: { refreshedAt?: string }) {
  const reduced = useReducedMotion();
  const { t } = useTranslation('crm');
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
      <span
        className={`inline-block h-2 w-2 rounded-full bg-[var(--success)] ${reduced ? '' : 'animate-pulse'}`}
        aria-hidden
      />
      <span>
        {t('intelCards.dataFreshness', 'Intel refreshed {{date}} · Sources: Crunchbase, LinkedIn, EU register', {
          date: refreshedAt ? formatDate(refreshedAt) : '—',
        })}
      </span>
    </div>
  );
}

export function FinancialHealthCard({ intel }: { intel: IntelPayload }) {
  const f = intel.financial;
  const { t } = useTranslation('crm');
  return (
    <Card>
      <SectionHeader
        title={t('intelCards.financial.title', 'Financial health')}
        caption={f?.ticker ?? t('intelCards.financial.private', 'Private')}
      />
      <div className="p-5 space-y-3 text-sm">
        <Row
          label={t('intelCards.financial.marketCap', 'Market cap')}
          value={f?.marketCap ? formatMoney(f.marketCap, 'USD') : '—'}
        />
        <Row
          label={t('intelCards.financial.revenueTtm', 'Revenue (TTM)')}
          value={f?.revenueAnnual ? formatMoney(f.revenueAnnual, 'USD') : '—'}
        />
        <Row
          label={t('intelCards.financial.growth', 'Growth')}
          value={f?.revenueGrowth != null ? `${(f.revenueGrowth * 100).toFixed(1)}%` : '—'}
        />
        <Row
          label={t('intelCards.financial.ebitdaMargin', 'EBITDA margin')}
          value={f?.ebitdaMargin != null ? `${(f.ebitdaMargin * 100).toFixed(1)}%` : '—'}
        />
        <Row label={t('intelCards.financial.creditRating', 'Credit rating')} value={f?.creditRating ?? '—'} />
        <Row label={t('intelCards.financial.headcount', 'Headcount')} value={f?.headcount?.toLocaleString() ?? '—'} />
      </div>
    </Card>
  );
}

export function WinPredictionCard({ intel }: { intel: IntelPayload }) {
  const wp = intel.winPrediction;
  const { t } = useTranslation('crm');
  if (!wp)
    return (
      <Card>
        <SectionHeader title={t('intelCards.winPrediction.title', 'Win prediction')} />
        <div className="p-5 text-xs text-[var(--fg-tertiary)]">
          {t('intelCards.winPrediction.empty', 'No prediction available.')}
        </div>
      </Card>
    );
  return (
    <Card>
      <SectionHeader
        title={t('intelCards.winPrediction.title', 'Win prediction')}
        caption={t('intelCards.winPrediction.modelCaption', 'Model {{version}}', { version: wp.modelVersion })}
      />
      <div className="p-5 space-y-3">
        <div className="flex items-baseline gap-2">
          <div className="text-4xl font-bold tabular-nums text-[var(--fg-primary)]">
            {wp.probability}%
          </div>
          <div className="text-xs text-[var(--fg-tertiary)]">
            {t('intelCards.winPrediction.probability', 'probability')}
          </div>
        </div>
        <ul className="space-y-1.5">
          {wp.drivers.map((d) => (
            <li key={d.label} className="flex items-center justify-between text-xs">
              <span className="text-[var(--fg-secondary)]">{d.label}</span>
              <span
                className={`tabular-nums font-medium ${d.contribution >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
              >
                {d.contribution > 0 ? '+' : ''}
                {d.contribution}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function TriggersCard({ intel }: { intel: IntelPayload }) {
  const { t } = useTranslation('crm');
  return (
    <Card>
      <SectionHeader
        title={t('intelCards.triggers.title', 'Buying triggers')}
        caption={t('intelCards.triggers.caption', 'Weighted signals')}
      />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {(intel.triggers ?? []).map((trigger) => (
          <li key={trigger.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="text-sm text-[var(--fg-primary)]">{trigger.label}</div>
              <div className="text-xs text-[var(--fg-tertiary)]">
                {trigger.kind} · {trigger.source ?? t('intelCards.triggers.unknownSource', 'unknown')} ·{' '}
                {formatDate(trigger.observedAt)}
              </div>
            </div>
            <div
              className="rounded-md bg-[var(--brand-primary-tint)] px-2 py-1 text-xs font-semibold text-[var(--brand-primary)] tabular-nums"
              aria-label={t('intelCards.triggers.weightAria', 'Weight {{weight}}/10', { weight: trigger.weight })}
            >
              {trigger.weight}/10
            </div>
          </li>
        ))}
        {!intel.triggers?.length ? (
          <li className="px-5 py-6 text-xs text-[var(--fg-tertiary)]">
            {t('intelCards.triggers.empty', 'No triggers detected yet.')}
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

export function CompetitorRadarCard({ intel }: { intel: IntelPayload }) {
  const { t } = useTranslation('crm');
  return (
    <Card>
      <SectionHeader title={t('intelCards.competitors.title', 'Competitor landscape')} />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {(intel.competitors ?? []).map((c) => (
          <li key={c.vendor} className="px-5 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-sm font-medium text-[var(--fg-primary)]">{c.vendor}</div>
              <div className="text-xs tabular-nums text-[var(--fg-tertiary)]">{c.score}/100</div>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
              <div className="h-full bg-[var(--brand-primary)]" style={{ width: `${c.score}%` }} />
            </div>
            <div className="mt-1.5 text-xs text-[var(--fg-tertiary)]">
              + {c.strengths.join(', ') || '—'} · − {c.weaknesses.join(', ') || '—'}
            </div>
          </li>
        ))}
        {!intel.competitors?.length ? (
          <li className="px-5 py-6 text-xs text-[var(--fg-tertiary)]">
            {t('intelCards.competitors.empty', 'No competitors mapped.')}
          </li>
        ) : null}
      </ul>
    </Card>
  );
}

export function NewsCard({ intel }: { intel: IntelPayload }) {
  const { t } = useTranslation('crm');
  return (
    <Card>
      <SectionHeader title={t('intelCards.news.title', 'Recent news')} />
      <ul className="divide-y divide-[var(--border-subtle)]">
        {(intel.news ?? []).map((n) => (
          <li key={n.id} className="px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-[var(--fg-primary)]">{n.headline}</div>
              <Badge
                tone={
                  n.sentiment === 'positive'
                    ? 'jade'
                    : n.sentiment === 'negative'
                      ? 'tomato'
                      : 'gray'
                }
              >
                {n.sentiment}
              </Badge>
            </div>
            <div className="text-xs text-[var(--fg-tertiary)]">
              {n.source} · {formatDate(n.publishedAt)}
            </div>
          </li>
        ))}
        {!intel.news?.length ? (
          <li className="px-5 py-6 text-xs text-[var(--fg-tertiary)]">
            {t('intelCards.news.empty', 'No news pulled.')}
          </li>
        ) : null}
      </ul>
    </Card>
  );
}
