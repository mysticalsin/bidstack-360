// Imported profile extras for one person (HTML people maps): headline, bio,
// location, tenure, career, education, languages, focus areas, signals and
// socials. Display only; every value arrives as sanitized plain text, and
// links render only when they are https.
import type { OrgChartProfile } from '@bidstack/shared';

const https = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null);
const KIND: Record<string, string> = { internal: 'Employee', external: 'External', amaris: 'Consultant', contractor: 'Contractor' };
const SOCIAL: Record<string, string> = { x: 'X', twitter: 'X', github: 'GitHub', medium: 'Medium', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', theorg: 'The Org' };

function Ext({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
}

export function ProfileDetails({ profile: p, fn }: { profile: OrgChartProfile; fn: string | null }) {
  const kind = p.personKind ? KIND[p.personKind] ?? p.personKind : null;
  const rows: Array<[string, string]> = [];
  if (fn) rows.push(['Department', fn]);
  if (p.location) rows.push(['Location', p.location]);
  if (p.workMode) rows.push(['Works', p.workMode === 'remote' ? 'Remote' : p.workMode === 'office' ? 'Office' : p.workMode]);
  if (kind && p.personKind !== 'internal') rows.push(['Type', p.employer ? `${kind}, ${p.employer}` : kind]);
  else if (p.employer) rows.push(['Employer', p.employer]);
  if (p.sites?.length) rows.push(['Sites', p.sites.slice(0, 4).join(', ')]);
  if (p.languages?.length) rows.push(['Languages', p.languages.join(', ')]);
  if (p.startDate) rows.push(['Started', p.startDate]);
  const hasAny = rows.length || p.headline || p.summary || p.tenure || p.career?.length || p.education?.length || p.themes?.length || p.signals?.length || p.footprint?.length || p.socials?.length || p.fit;
  if (!hasAny) return null;
  return (
    <section data-testid="orgchart-profile" aria-label="Profile">
      <h3>Profile</h3>
      {p.headline ? <p className="oc-src">{p.headline}</p> : null}
      {p.summary ? <p className="oc-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>{p.summary}</p> : null}
      {rows.length ? <dl className="oc-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
      {p.tenure ? <p className="oc-src" style={{ marginTop: 8 }}>{p.tenure}</p> : null}
      {p.career?.length ? (
        <>
          <h3>Career</h3>
          <ul className="oc-career">{p.career.slice(0, 5).map((c, i) => <li key={`${c.role}-${i}`}>{c.role}{c.org ? `, ${c.org}` : ''}{c.period ? <span>{c.period}</span> : null}</li>)}</ul>
        </>
      ) : null}
      {p.education?.length ? (
        <>
          <h3>Education</h3>
          <ul className="oc-career">{p.education.slice(0, 3).map((e, i) => <li key={`${e.school}-${i}`}>{e.school}{e.detail ? <span>{e.detail}</span> : null}</li>)}</ul>
        </>
      ) : null}
      {p.themes?.length ? (
        <>
          <h3>Focus areas</h3>
          <ul className="oc-tags">{p.themes.slice(0, 10).map((t) => <li key={t}>{t}</li>)}</ul>
        </>
      ) : null}
      {p.signals?.length || p.footprint?.length ? (
        <>
          <h3>Recent signals</h3>
          <ul className="oc-career">
            {[...(p.signals ?? []), ...(p.footprint ?? [])].slice(0, 5).map((s, i) => (
              <li key={`${s.title}-${i}`}><Ext href={https(s.url)}>{s.title}</Ext>{s.date ? <span>{s.date}</span> : null}</li>
            ))}
          </ul>
        </>
      ) : null}
      {p.socials?.length ? (
        <p className="oc-src" style={{ marginTop: 8 }}>
          Also on{' '}
          {p.socials.map((s, i) => <span key={s.url}>{i ? ', ' : ''}<Ext href={https(s.url)}>{SOCIAL[s.kind] ?? s.kind}</Ext></span>)}
        </p>
      ) : null}
      {p.fit ? (
        <p className="oc-src" style={{ marginTop: 8 }} data-testid="orgchart-fit">
          Fit score {p.fit.score}{p.fit.score <= 10 ? ' of 10' : ''}{p.fit.why.length ? `: ${p.fit.why.slice(0, 2).join('; ')}` : ''}
        </p>
      ) : null}
      {p.linkedinConfidence && p.linkedinConfidence !== 'verified' ? <p className="oc-src">LinkedIn match: {p.linkedinConfidence}</p> : null}
    </section>
  );
}
