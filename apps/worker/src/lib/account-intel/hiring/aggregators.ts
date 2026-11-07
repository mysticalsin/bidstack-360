/**
 * Optional paid job aggregators (slice 12), off by default. Turned on only
 * with ACCOUNT_INTEL_JOB_AGGREGATOR plus the provider's own key env names.
 * Both are licensed APIs; their keys are read by name and never logged.
 */
import type { IntelClient } from '../http.js';
import type { RawPosting } from './ats.js';

/** A configured aggregator. */
export interface JobAggregator {
  id: 'theirstack' | 'adzuna';
  label: string;
  fetch(client: IntelClient, q: { companyName: string; domain: string | null; countryCode: string | null }): Promise<RawPosting[]>;
}

type J = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function theirStack(apiKey: string): JobAggregator {
  return {
    id: 'theirstack',
    label: 'TheirStack',
    async fetch(client, q) {
      const filter = q.domain ? { company_domain_or: [q.domain] } : { company_name_or: [q.companyName] };
      const body = await client.postJson('https://api.theirstack.com/v1/jobs/search', { page: 0, limit: 50, posted_at_max_age_days: 90, ...filter }, { headers: { Authorization: `Bearer ${apiKey}` } });
      const data = (JSON.parse(body) as { data?: J[] }).data ?? [];
      return data.flatMap((j) => {
        const id = str(j.id);
        const title = str(j.job_title);
        if (!id || !title) return [];
        const at = str(j.date_posted);
        return [{ externalId: id, source: 'theirstack' as const, title, url: str(j.url), city: null, state: null, country: str(j.country_code), location: str(j.location), department: null, postedAt: at ? new Date(at) : null }];
      });
    },
  };
}

function adzuna(appId: string, appKey: string): JobAggregator {
  return {
    id: 'adzuna',
    label: 'Adzuna',
    async fetch(client, q) {
      const country = (q.countryCode ?? 'gb').toLowerCase();
      const params = new URLSearchParams({ app_id: appId, app_key: appKey, company: q.companyName, results_per_page: '50', max_days_old: '90', 'content-type': 'application/json' });
      const body = await client.get(`https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1?${params}`, { accept: 'application/json' });
      const results = (JSON.parse(body) as { results?: J[] }).results ?? [];
      return results.flatMap((j) => {
        const id = str(j.id);
        const title = str(j.title);
        if (!id || !title) return [];
        const at = str(j.created);
        const loc = (j.location as { display_name?: string } | undefined)?.display_name ?? null;
        return [{ externalId: id, source: 'adzuna' as const, title, url: str(j.redirect_url), city: null, state: null, country: country.toUpperCase(), location: loc, department: (j.category as { label?: string } | undefined)?.label ?? null, postedAt: at ? new Date(at) : null }];
      });
    },
  };
}

/** The aggregator named by ACCOUNT_INTEL_JOB_AGGREGATOR, or null when it is off or its keys are missing. */
export function aggregatorFromEnv(env: Record<string, string | undefined>): JobAggregator | null {
  const which = env.ACCOUNT_INTEL_JOB_AGGREGATOR?.trim().toLowerCase();
  if (which === 'theirstack' && env.THEIRSTACK_API_KEY) return theirStack(env.THEIRSTACK_API_KEY);
  if (which === 'adzuna' && env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) return adzuna(env.ADZUNA_APP_ID, env.ADZUNA_APP_KEY);
  return null;
}
