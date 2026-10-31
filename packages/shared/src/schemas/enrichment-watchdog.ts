// Potential projects (account enrichment) as account-watchdog events.
// The watchdog stores them in account_watch_events like any other signal, so
// they get a status (NEW / ACKNOWLEDGED / DISMISSED) and a dismissal sticks:
// the dedupe key is (orgId, source='enrichment', externalId=projectId), and
// projects are inserted, never overwritten.
// Same selection and wording rules as GET /enrichment/signals (medium+ by default).
import { PotentialProject, type ProjectConfidence } from './account-enrichment.js';

export const ENRICHMENT_WATCH_SOURCE = 'enrichment';
export const ENRICHMENT_SIGNAL_KIND = 'enrichment.potential_project';

const RANK: Record<ProjectConfidence, number> = { high: 0, medium: 1, low: 2 };
const LABEL: Record<ProjectConfidence, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** DOM id of a project on the account page; safe for any project id ("data_platform:EMEA"). */
export function enrichmentProjectAnchor(projectId: string): string {
  return `enrichment-project-${projectId.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

export interface EnrichmentWatchRow {
  orgId: string;
  companyId: string;
  source: typeof ENRICHMENT_WATCH_SOURCE;
  externalId: string;
  kind: 'NEWS_SIGNAL';
  occurredAt: Date;
  title: string;
  sourceUrl: string;
  summary: string;
  implication: 'OPPORTUNITY';
  rationale: string;
  severity: number;
  confirmed: false;
  payload: {
    kind: typeof ENRICHMENT_SIGNAL_KIND;
    projectId: string;
    confidence: ProjectConfidence;
    region: string;
    postingCount: number;
    method: 'rules' | 'rules+llm';
    evidenceUrls: string[];
  };
}

/** Parse the stored `company_firmographics.projects` JSON, dropping anything malformed. */
export function parseStoredProjects(raw: unknown): PotentialProject[] {
  if (!Array.isArray(raw)) return [];
  const out: PotentialProject[] = [];
  for (const p of raw) {
    const r = PotentialProject.safeParse(p);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function enrichmentWatchRows(input: {
  orgId: string;
  companyId: string;
  fetchedAt: Date | null;
  projects: unknown;
  minConfidence?: ProjectConfidence;
}): EnrichmentWatchRow[] {
  const max = RANK[input.minConfidence ?? 'medium'];
  const at = input.fetchedAt ?? new Date(0);
  return parseStoredProjects(input.projects)
    .filter((p) => RANK[p.confidence] <= max)
    .map((p) => ({
      orgId: input.orgId,
      companyId: input.companyId,
      source: ENRICHMENT_WATCH_SOURCE,
      externalId: p.id,
      kind: 'NEWS_SIGNAL' as const,
      occurredAt: at,
      title: `Potential project: ${p.name}`,
      sourceUrl: `/accounts/${input.companyId}#${enrichmentProjectAnchor(p.id)}`,
      summary: `${p.rationale} ${LABEL[p.confidence]} confidence, from ${p.postingCount} job posting${p.postingCount === 1 ? '' : 's'}.`,
      implication: 'OPPORTUNITY' as const,
      rationale: `Inferred from hiring (${p.method === 'rules+llm' ? 'hiring rules, reworded by the org LLM' : 'hiring rules'}). Check with the account team before acting.`,
      severity: p.confidence === 'high' ? 2 : 1,
      confirmed: false as const,
      payload: {
        kind: ENRICHMENT_SIGNAL_KIND,
        projectId: p.id,
        confidence: p.confidence,
        region: p.region,
        postingCount: p.postingCount,
        method: p.method,
        evidenceUrls: p.evidence.map((e) => e.url).filter((u): u is string => Boolean(u)).slice(0, 5),
      },
    }));
}
