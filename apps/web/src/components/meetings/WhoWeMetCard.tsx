// Account page: "Who we've met". One surface, most important first:
// the coverage map (region x seniority, senior gaps dashed), then on click the
// people behind a cell. Beside it, recurring challenges and the latest
// meetings. Everything links into /meetings for depth.
import './meetings.css';

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { useChallenges, useCoverage, useMeetingList } from '@/hooks/useMeetingIntel';
import { ApiError } from '@/lib/api';
import { agoLabel, COVERAGE_LEVELS, fmtMeetingDate, SENIOR_LEVELS, SENIORITY_SHORT } from '@/lib/meeting-intel/client';
import type { CellRef } from '@/lib/meeting-intel/people';

import { CoverageMap } from './CoverageMap';
import { LogMeetingDialog } from './LogMeetingDialog';
import { PeopleDrill } from './PeopleDrill';

const TOP_CHALLENGES = 3;
const TOP_RECENT = 4;

export function WhoWeMetCard({ companyId, companyName }: { companyId: string; companyName?: string }) {
  const coverage = useCoverage(companyId);
  const challenges = useChallenges(companyId);
  const recent = useMeetingList({ groupId: companyId, limit: TOP_RECENT + 1 });
  const [cell, setCell] = useState<CellRef | null>(null);
  const [allChallenges, setAllChallenges] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const base = `/meetings?groupId=${encodeURIComponent(companyId)}`;

  if (coverage.error instanceof ApiError && coverage.error.status === 403) return null;

  const cov = coverage.data;
  const people = cov?.cells.reduce((n, c) => n + c.people, 0) ?? 0;
  const meetings = recent.data?.items ?? [];
  const hasAny = people > 0 || meetings.length > 0;
  const senior = cov?.cells.filter((c) => SENIOR_LEVELS.has(c.seniority)).reduce((n, c) => n + c.people, 0) ?? 0;
  const items = challenges.data?.items ?? [];
  const maxMentions = Math.max(1, ...items.map((c) => c.mentions));

  return (
    <section className="mi-section" aria-labelledby="mi-acct-h" data-testid="account-who-we-met">
      <header className="mi-head">
        <div>
          <h2 id="mi-acct-h">Who we&apos;ve met</h2>
          {cov && hasAny ? (
            <p className="mi-meta" style={{ marginTop: 4 }}>
              {people} {people === 1 ? 'person' : 'people'} · {senior} senior · {cov.gaps.length} senior {cov.gaps.length === 1 ? 'gap' : 'gaps'} · last {Math.round(cov.windowDays / 30)} months
            </p>
          ) : null}
        </div>
        <span className="mi-meta">
          <Link className="mi-link" to={base}>All meetings</Link>
          <Button variant="secondary" size="sm" onClick={() => setLogOpen(true)} data-testid="log-meeting">Log a meeting</Button>
        </span>
      </header>

      {coverage.isLoading ? <p className="mi-empty">Loading coverage…</p> : coverage.isError ? (
        <p className="mi-empty" role="alert">
          Couldn&apos;t load meeting coverage. <button type="button" className="mi-link" onClick={() => void coverage.refetch()}>Retry</button>
        </p>
      ) : !hasAny ? (
        <p className="mi-empty">
          No meetings recorded for this account yet. Log one, or <Link to="/settings?tab=meeting-sources">connect Métis or ABC</Link> to bring them in.
        </p>
      ) : cov ? (
        <div className="mi-split">
          <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
            <CoverageMap data={cov} selected={cell} onSelect={setCell} />
            {cell ? (
              <PeopleDrill groupId={companyId} cell={cell} onLog={() => setLogOpen(true)} />
            ) : (
              <p className="mi-caption" style={{ fontSize: 13 }}>
                {cov.gaps.length > 0
                  ? `Biggest gap: no ${SENIORITY_SHORT[cov.gaps[0]!.seniority]} met in ${cov.gaps[0]!.region}. Select any cell to see who we know.`
                  : 'Senior coverage in every region. Select any cell to see who we know.'}
              </p>
            )}
          </div>
          <div style={{ display: 'grid', gap: 24, alignContent: 'start', minWidth: 0 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 500, margin: "0 0 8px", color: "var(--fg-primary)" }}>What they keep raising</h3>
              {items.length === 0 ? <p className="mi-empty">No challenges captured yet.</p> : (
                <>
                  <ul className="mi-list" data-testid="challenge-rollup">
                    {(allChallenges ? items : items.slice(0, TOP_CHALLENGES)).map((c) => (
                      <li key={c.challenge}>
                        <span className="mi-row-title" style={{ fontWeight: 400 }}>{c.challenge}</span>
                        <span className="mi-bar" style={{ width: `${Math.max(8, (c.mentions / maxMentions) * 100)}%` }} aria-hidden />
                        <span className="mi-row-meta">
                          {c.mentions} {c.mentions === 1 ? 'mention' : 'mentions'} · {c.regions.join(', ') || 'region unknown'} · {agoLabel(c.lastMentionedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {items.length > TOP_CHALLENGES ? (
                    <button type="button" className="mi-link" aria-expanded={allChallenges} onClick={() => setAllChallenges((v) => !v)}>
                      {allChallenges ? 'Show fewer' : `Show all ${items.length}`}
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 500, margin: '0 0 8px', color: 'var(--fg-primary)' }}>Latest meetings</h3>
              <ol className="mi-timeline" data-testid="meeting-timeline">
                {meetings.slice(0, TOP_RECENT).map((m) => (
                  <li key={m.id}>
                    <Link className="mi-row-title" to={`/meetings/${m.id}`}>{m.title}</Link>
                    <span className="mi-row-meta">
                      <time dateTime={m.heldAt}>{fmtMeetingDate(m.heldAt)}</time> · {m.companyName}
                      {COVERAGE_LEVELS.includes(m.topSeniority) ? <span className="mi-chip" data-tone={SENIOR_LEVELS.has(m.topSeniority) ? 'senior' : undefined}>{SENIORITY_SHORT[m.topSeniority]}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
              {meetings.length > TOP_RECENT ? <Link className="mi-link" to={base}>See all meetings</Link> : null}
            </div>
          </div>
        </div>
      ) : null}
      <LogMeetingDialog open={logOpen} onOpenChange={setLogOpen} companyId={companyId} companyName={companyName} />
    </section>
  );
}
