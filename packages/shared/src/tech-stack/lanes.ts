/**
 * Pure matchers for the open data technology lanes (slice 16). Network and
 * DNS calls live in '@bidstack/shared/server'; these functions only read what
 * a public source already returned, so they run in tests without a network.
 */
import type { OpenTechLane, TechnicalStackEvidence } from '../schemas/crm.base.js';

import { TECH_RULES, type TechCategory, type TechRule } from './fingerprints.js';

/** One technology seen by one lane, with the record that shows it. */
export interface OpenTechDetection {
  name: string;
  category: TechCategory;
  lane: OpenTechLane;
  source: `open_data:${OpenTechLane}`;
  confidence: number;
  evidence: TechnicalStackEvidence;
}

/** DNS answers for the company's primary domain. */
export interface DnsRecords {
  mx: string[];
  txt: string[];
  ns: string[];
  /** CNAME answers for well-known subdomains, host is the full queried name. */
  cname: Array<{ host: string; target: string }>;
}

/** Subdomains whose CNAME names a SaaS or delivery vendor. */
export const DNS_CNAME_PROBES = [
  'www',
  'autodiscover',
  'lyncdiscover',
  'sip',
  'enterpriseenrollment',
  'enterpriseregistration',
  'help',
  'support',
  'status',
  'shop',
  'careers',
  'jobs',
  'go',
  'info',
  'email',
  'click',
] as const;

const trimDot = (v: string) => v.trim().toLowerCase().replace(/\.$/, '');

function detection(rule: TechRule, lane: OpenTechLane, confidence: number, evidence: TechnicalStackEvidence): OpenTechDetection {
  return { name: rule.name, category: rule.category, lane, source: `open_data:${lane}`, confidence, evidence };
}

/** Keep one detection per technology: highest confidence, first evidence on ties. */
export function dedupeDetections(items: OpenTechDetection[]): OpenTechDetection[] {
  const byName = new Map<string, OpenTechDetection>();
  for (const item of items) {
    const key = `${item.lane}:${item.name.toLowerCase()}`;
    const prev = byName.get(key);
    if (!prev || item.confidence > prev.confidence) byName.set(key, item);
  }
  return [...byName.values()];
}

function clip(value: string, max = 160): string {
  const v = value.replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/** Match MX, SPF, TXT verification, NS and CNAME answers against the rules. */
export function matchDnsRecords(domain: string, records: DnsRecords, observedAt: string): OpenTechDetection[] {
  const out: OpenTechDetection[] = [];
  const apex = trimDot(domain);
  const mx = records.mx.map(trimDot);
  const ns = records.ns.map(trimDot);
  const txt = records.txt.map((t) => t.trim());
  const spf = txt.filter((t) => /^v=spf1\b/i.test(t)).map((t) => t.toLowerCase());
  const verify = txt.filter((t) => !/^v=spf1\b/i.test(t)).map((t) => t.toLowerCase());
  const ev = (record: string): TechnicalStackEvidence => ({ url: null, record: clip(record), observedAt });

  for (const rule of TECH_RULES) {
    for (const host of mx) if (rule.mx?.some((r) => r.test(host))) out.push(detection(rule, 'dns', 0.95, ev(`MX ${apex} ${host}`)));
    for (const record of spf) if (rule.spf?.some((r) => r.test(record))) out.push(detection(rule, 'dns', 0.85, ev(`SPF ${apex} ${record}`)));
    for (const record of verify) if (rule.txt?.some((r) => r.test(record))) out.push(detection(rule, 'dns', 0.8, ev(`TXT ${apex} ${record.split('=')[0]}=…`)));
    for (const host of ns) if (rule.ns?.some((r) => r.test(host))) out.push(detection(rule, 'dns', 0.9, ev(`NS ${apex} ${host}`)));
    for (const c of records.cname) {
      const target = trimDot(c.target);
      if (rule.cname?.some((r) => r.test(target))) out.push(detection(rule, 'dns', 0.85, ev(`CNAME ${trimDot(c.host)} ${target}`)));
    }
  }
  return dedupeDetections(out);
}

/** Host names from a crt.sh JSON answer: deduped, lowercased, wildcards removed, capped. */
export function ctHostsFromCrtSh(body: string, max = 2000): string[] {
  let values: string[];
  try {
    const rows: unknown = JSON.parse(body);
    values = Array.isArray(rows)
      ? rows.flatMap((row) => {
          const v = row && typeof row === 'object' ? (row as Record<string, unknown>).name_value : null;
          return typeof v === 'string' ? [v] : [];
        })
      : [];
  } catch {
    // A body cut at the size cap is not valid JSON; read the complete rows.
    values = [...body.matchAll(/"name_value"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\n/g, '\n'));
  }
  const hosts = new Set<string>();
  for (const value of values) {
    for (const line of value.split(/\s+/)) {
      const host = trimDot(line).replace(/^\*\./, '');
      if (/^[a-z0-9.-]+$/.test(host)) hosts.add(host);
      if (hosts.size >= max) return [...hosts];
    }
  }
  return [...hosts];
}

/**
 * Match certificate host names. Hosts under the company domain are matched on
 * their first label (jira.example.com); tenant hosts on a vendor domain must
 * start with the company slug (example.service-now.com).
 */
export function matchCtHosts(domain: string, slug: string | null, hosts: string[], observedAt: string): OpenTechDetection[] {
  const apex = trimDot(domain);
  const out: OpenTechDetection[] = [];
  const ev = (host: string): TechnicalStackEvidence => ({
    url: `https://crt.sh/?q=${encodeURIComponent(host)}`,
    record: `Certificate for ${host}`,
    observedAt,
  });
  for (const raw of hosts) {
    const host = trimDot(raw);
    const own = host.endsWith(`.${apex}`) ? host.slice(0, -(apex.length + 1)) : null;
    const tenant = slug && host.startsWith(`${slug}.`) && !own ? host : null;
    for (const rule of TECH_RULES) {
      if (!rule.host) continue;
      if (own !== null && rule.host.some((r) => r.source.startsWith('^') && r.test(`${own}.`))) {
        out.push(detection(rule, 'ct', 0.65, ev(host)));
      } else if (tenant && rule.host.some((r) => !r.source.startsWith('^') && r.test(tenant))) {
        out.push(detection(rule, 'ct', 0.8, ev(host)));
      }
    }
  }
  return dedupeDetections(out);
}

/** What the homepage request returned. */
export interface HomepageCapture {
  url: string;
  html: string;
  headers: Record<string, string>;
}

/** Match homepage markup and response headers against the rules. */
export function matchHomepage(page: HomepageCapture, observedAt: string): OpenTechDetection[] {
  const html = page.html.slice(0, 2_000_000).toLowerCase();
  const headers = Object.fromEntries(Object.entries(page.headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  const out: OpenTechDetection[] = [];
  const ev = (record: string): TechnicalStackEvidence => ({ url: page.url, record: clip(record), observedAt });
  const snippet = (re: RegExp): string | null => {
    const m = re.exec(html);
    if (!m) return null;
    return html.slice(Math.max(0, m.index - 20), m.index + m[0].length + 40);
  };
  for (const rule of TECH_RULES) {
    for (const re of rule.script ?? []) {
      const s = snippet(re);
      if (s) {
        out.push(detection(rule, 'web', 0.9, ev(`Script ${s}`)));
        break;
      }
    }
    for (const re of rule.html ?? []) {
      const s = snippet(re);
      if (s) {
        out.push(detection(rule, 'web', 0.75, ev(`Markup ${s}`)));
        break;
      }
    }
    for (const [name, re] of rule.header ?? []) {
      const value = headers[name];
      if (value !== undefined && re.test(value)) {
        out.push(detection(rule, 'web', 0.9, ev(`Header ${name}: ${value}`)));
        break;
      }
    }
  }
  return dedupeDetections(out);
}

const GITHUB_RESERVED = new Set(['about', 'features', 'pricing', 'enterprise', 'login', 'join', 'sponsors', 'topics', 'orgs', 'site', 'marketplace', 'apps', 'settings']);

/** The GitHub organisation linked from the homepage, if exactly one is linked. */
export function githubOrgFromHtml(html: string): string | null {
  const orgs = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})(?=[/"'?#\s<])/g)) {
    const org = m[1]!.toLowerCase();
    if (!GITHUB_RESERVED.has(org)) orgs.add(org);
  }
  return orgs.size === 1 ? [...orgs][0]! : null;
}

/** A stored public job posting: text the board shows anonymously. */
export interface PostingText {
  title: string;
  department: string | null;
  skills: string[];
  url: string | null;
  fetchedAt: Date | string;
}

/** Technology mentions across public postings, with counts as evidence. */
export function matchJobPostings(postings: PostingText[], observedAt: string): OpenTechDetection[] {
  const total = postings.length;
  if (total === 0) return [];
  const out: OpenTechDetection[] = [];
  for (const rule of TECH_RULES) {
    if (!rule.jobs) continue;
    const hits = postings.filter((p) => {
      const text = [p.title, p.department ?? '', ...p.skills].join(' \n ');
      return rule.jobs!.some((re) => re.test(text));
    });
    if (hits.length === 0) continue;
    const confidence = Math.min(0.9, 0.55 + 0.08 * hits.length);
    const url = hits.find((h) => h.url)?.url ?? null;
    out.push(
      detection(rule, 'jobs', Number(confidence.toFixed(2)), {
        url: url && /^https?:\/\//.test(url) ? url : null,
        record: `Named in ${hits.length} of ${total} public job postings`,
        observedAt,
      }),
    );
  }
  return out;
}

/** Repository languages for a public GitHub organisation. */
export function matchGithubLanguages(org: string, repos: Array<{ language?: unknown; archived?: unknown; fork?: unknown }>, observedAt: string, max = 6): OpenTechDetection[] {
  const counts = new Map<string, number>();
  for (const repo of repos) {
    if (repo.archived === true || repo.fork === true) continue;
    if (typeof repo.language !== 'string' || !repo.language.trim()) continue;
    counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([language, n]) => ({
      name: language,
      category: 'Languages' as const,
      lane: 'github' as const,
      source: 'open_data:github' as const,
      confidence: Number(Math.min(0.9, 0.6 + 0.05 * n).toFixed(2)),
      evidence: { url: `https://github.com/${org}`, record: `Main language of ${n} of ${total} public repositories`, observedAt },
    }));
}

/** Company slug for tenant host names: the first label of the domain, when distinctive. */
export function companySlug(domain: string): string | null {
  const first = trimDot(domain).replace(/^www\./, '').split('.')[0] ?? '';
  return /^[a-z0-9-]{4,40}$/.test(first) ? first : null;
}
