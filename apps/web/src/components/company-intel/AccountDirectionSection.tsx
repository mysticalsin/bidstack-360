// Slice 12 "Where they're heading": direction, hiring, financials, news and
// posts, with a per-source status strip and refresh. DESIGN.md 9.7.
import '../signals/signals.css';
import './company-intel.css';

import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, RefreshCw, Settings2, XCircle } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';

import type { IntelSourceKey, IntelSourceStatus } from '@bidstack/shared';

import { useHasPermission } from '@/hooks/useCapabilities';
import {
  useCompanyDirection,
  useCompanyFinancialsIntel,
  useCompanyHiringIntel,
  useCompanyNewsIntel,
  useRefreshIntelSource,
} from '@/hooks/useCompanyIntel';
import { useSourcedFigures } from '@/hooks/useSourcedFigures';

import { fmtDate } from './intel-format';
import { DirectionPanel, FinancialsPanel, HiringPanel, NewsPanel } from './IntelPanels';

const TABS = [
  { key: 'direction', label: 'Direction' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'financials', label: 'Financials' },
  { key: 'news', label: 'News and posts' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const STATUS: Record<IntelSourceStatus['status'], { label: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'Up to date', Icon: CheckCircle2 },
  partial: { label: 'Partial', Icon: AlertTriangle },
  failed: { label: 'Failed', Icon: XCircle },
  not_configured: { label: 'Not configured', Icon: Settings2 },
  never: { label: 'Never fetched', Icon: CircleDashed },
  queued: { label: 'Queued', Icon: Clock },
  running: { label: 'Running', Icon: Loader2 },
};

function resultText(r: IntelSourceStatus['result']): string | null {
  const parts = [
    r.new ? `${r.new} new` : null,
    r.updated ? `${r.updated} updated` : null,
    r.failed ? `${r.failed} failed` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function SourcesStrip({ sources, canRefresh, onRefresh, pending }: {
  sources: IntelSourceStatus[];
  canRefresh: boolean;
  onRefresh: (k: IntelSourceKey) => void;
  pending: IntelSourceKey | undefined;
}) {
  return (
    <ul className="ci-sources" aria-label="Sources">
      {sources.map((s) => {
        const { label, Icon } = STATUS[s.status];
        const busy = pending === s.key || s.status === 'queued' || s.status === 'running';
        const result = resultText(s.result);
        return (
          <li key={s.key} className="ci-source" data-status={s.status} data-testid={`intel-source-${s.key}`}>
            <span className="ci-source-name">{s.label}</span>
            <span className="ci-source-status">
              <Icon size={14} aria-hidden />
              {label}
            </span>
            <span className="ci-meta">{s.lastFetchedAt ? fmtDate(s.lastFetchedAt) : null}</span>
            <span className="ci-meta">{result}</span>
            {s.detail ? <span className="ci-meta ci-detail">{s.detail}</span> : null}
            {canRefresh ? (
              <button type="button" className="ci-refresh" onClick={() => onRefresh(s.key)} disabled={busy} aria-label={`Refresh ${s.label}`}>
                <RefreshCw size={14} aria-hidden data-spin={busy} />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Account page section: where the company is heading, with cited evidence. */
export function AccountDirectionSection({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<TabKey>('direction');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canRefresh = useHasPermission('account-intel:write');
  const refresh = useRefreshIntelSource(companyId);
  const direction = useCompanyDirection(companyId, refresh.pollUntil);
  const hiring = useCompanyHiringIntel(companyId);
  const financials = useCompanyFinancialsIntel(companyId);
  const news = useCompanyNewsIntel(companyId);
  const sourced = useSourcedFigures(companyId);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const j = (next + TABS.length) % TABS.length;
    setTab(TABS[j]!.key);
    tabRefs.current[j]?.focus();
  };

  const sample = Boolean(direction.data?.sample || hiring.data?.sample || financials.data?.sample || news.data?.sample);
  const active = { direction, hiring, financials, news }[tab];

  return (
    <section className="sg ci sg-surface" aria-labelledby="ci-h" data-testid="account-direction">
      <header className="sg-head">
        <h2 id="ci-h" className="sg-h">
          Where they&apos;re heading {sample ? <span className="sg-sample">Sample</span> : null}
        </h2>
      </header>
      <div role="tablist" aria-label="Account intelligence" className="ci-tabs">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            id={`ci-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`ci-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className="ci-tab"
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`ci-panel-${tab}`} aria-labelledby={`ci-tab-${tab}`} className="ci-body">
        {active.isLoading ? (
          <div className="sg-skel" aria-busy="true" />
        ) : active.isError ? (
          <p className="sg-empty" role="alert">
            <span>Couldn&apos;t load this view</span>
          </p>
        ) : tab === 'direction' && direction.data ? (
          <DirectionPanel d={direction.data} />
        ) : tab === 'hiring' && hiring.data ? (
          <HiringPanel h={hiring.data} />
        ) : tab === 'financials' && financials.data ? (
          <FinancialsPanel f={financials.data} company={sourced.companyName ? { id: companyId, name: sourced.companyName } : undefined} />
        ) : tab === 'news' && news.data ? (
          <NewsPanel n={news.data} />
        ) : null}
      </div>
      {direction.data ? (
        <SourcesStrip
          sources={direction.data.sources}
          canRefresh={canRefresh}
          onRefresh={(k) => refresh.mutate(k)}
          pending={refresh.isPending ? refresh.variables : undefined}
        />
      ) : null}
    </section>
  );
}
