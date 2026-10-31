// "Potential projects": initiatives inferred from hiring, strongest first, each
// with its confidence and, on click, the job postings behind it.
import './enrichment.css';

import { useEffect, useId, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useCompanyEnrichment } from '@/hooks/useCompanyEnrichment';
import { CONFIDENCE_LABEL, evidenceFor, projectAnchor } from '@/lib/enrichment/aggregate';
import { fmtAsOf } from '@/lib/enrichment/client';
import type { Confidence } from '@/lib/enrichment/types';

import { SampleBadge, SourceNote } from './SourceNote';

const LEVEL: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

function ConfidenceMark({ c, score }: { c: Confidence; score: number }) {
  return (
    <span className="en-conf">
      <span className="dots" aria-hidden>
        {[1, 2, 3].map((n) => <i key={n} data-on={n <= LEVEL[c]} />)}
      </span>
      {CONFIDENCE_LABEL[c]} · {Math.round(score * 100)}%
    </span>
  );
}

export function PotentialProjectsCard({ companyId }: { companyId: string }) {
  const q = useCompanyEnrichment(companyId);
  const { hash } = useLocation();
  // A user toggle applies until the hash changes; a new hash re-opens its project.
  const [toggle, setToggle] = useState<{ hash: string; id: string | null } | null>(null);
  const id = useId();
  const projects = q.data?.projects ?? [];
  // Deep link from a watchdog signal: /accounts/:id#enrichment-project-<id>.
  const hashId = projects.find((p) => `#${projectAnchor(p.id)}` === hash)?.id ?? null;
  const openId = toggle && toggle.hash === hash ? toggle.id : hashId;
  const setOpenId = (next: string | null) => setToggle({ hash, id: next });

  useEffect(() => {
    if (!hashId) return;
    const raf = requestAnimationFrame(() => document.getElementById(projectAnchor(hashId))?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(raf);
  }, [hashId]);

  if (!q.data) return null;
  const roles = q.data.hiring.roles;
  return (
    <section className="en-section" aria-labelledby={`${id}-h`} data-testid="account-potential-projects">
      <header className="en-head">
        <h2 id={`${id}-h`}>Potential projects</h2>
        <SampleBadge show={q.data.sample} />
      </header>
      {projects.length === 0 ? (
        <p className="en-meta">No initiatives inferred from current hiring.</p>
      ) : (
        <ul className="en-list">
          {projects.map((p) => {
            const isOpen = openId === p.id;
            const ev = evidenceFor(p, roles);
            return (
              <li key={p.id} id={projectAnchor(p.id)} className="en-project" data-focus={`#${projectAnchor(p.id)}` === hash}>
                <button type="button" className="en-row-btn" aria-expanded={isOpen} aria-controls={`${id}-${p.id}`} onClick={() => setOpenId(isOpen ? null : p.id)}>
                  <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                    <span className="en-row-title">{p.title}</span>
                    <span className="en-row-meta">{ev.length} posting{ev.length === 1 ? '' : 's'} as evidence</span>
                  </span>
                  <ConfidenceMark c={p.confidence} score={p.score} />
                </button>
                <SourceNote source={p.source} asOf={p.inferredAt} prefix="Inferred by" />
                {isOpen ? (
                  <div id={`${id}-${p.id}`} className="en-detail">
                    <p>{p.summary}</p>
                    <h3>Evidence postings</h3>
                    <ul className="en-ev">
                      {ev.map((r) => (
                        <li key={r.id}>
                          <span className="t">{r.title}</span>
                          <span className="en-src">
                            {r.seniority} · {r.location} · {r.source} · posted <time dateTime={r.postedAt}>{fmtAsOf(r.postedAt)}</time>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
