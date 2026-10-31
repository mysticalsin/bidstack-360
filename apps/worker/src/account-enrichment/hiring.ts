/**
 * Hiring breakdown and "Potential projects" (2026-10-31).
 *
 * Deterministic: each open role is classified from its title by function,
 * seniority, skills and region. Rules then look for clusters that usually sit
 * behind a project, e.g. 12 data engineers plus a Snowflake architect in EMEA
 * reads as a data platform migration. The optional LLM step (projects-llm.ts)
 * may only rewrite the name and rationale of projects these rules found.
 */
import type {
  EnrichmentProviderId,
  HiringBreakdown,
  HiringCluster,
  HiringRegion,
  JobFunction,
  JobSeniority,
  PotentialProject,
  ProjectConfidence,
  ProjectEvidence,
} from '@bidstack/shared';

export interface PostingInput {
  id: string;
  source: EnrichmentProviderId;
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postedAt: Date | string | null;
  lastSeenAt?: Date | string | null;
}

export interface ClassifiedPosting extends PostingInput {
  function: JobFunction;
  seniority: JobSeniority;
  skills: string[];
  region: HiringRegion;
  architect: boolean;
}

// ------------------------------------------------------------ classification

const FUNCTION_RULES: Array<[JobFunction, RegExp]> = [
  ['sales', /\b(sales engineer|solutions? engineer|presales|pre-sales|solutions? consultant)\b/],
  ['security', /\b(security|secops|soc|cyber\w*|iam|identity|penetration|pentest|grc|ciso|infosec)\b/],
  ['ml_ai', /\b(machine learning|ml|mlops|ai|artificial intelligence|llm|genai|gen ai|data scien\w*|nlp|computer vision|deep learning)\b/],
  ['data', /\b(data|analytics|analyst|bi|business intelligence|etl|dwh|data warehouse|snowflake|databricks)\b/],
  ['infrastructure', /\b(devops|sre|site reliability|cloud|infrastructure|platform engineer|network|systems? admin\w*|kubernetes|aws|azure|gcp)\b/],
  ['design', /\b(designer|ux|ui|user research\w*)\b/],
  ['product', /\b(product (manager|owner|lead|director)|product management|head of product|cpo)\b/],
  ['engineering', /\b(engineer\w*|developer|programmer|software|frontend|front-end|backend|back-end|full[ -]?stack|qa|test automation|mobile|ios|android|cto|chief technology officer)\b/],
  ['sales', /\b(sales|account executive|account manager|business development|bdr|sdr|ae|presales|pre-sales|solutions consultant|cro)\b/],
  ['marketing', /\b(marketing|growth|seo|content|brand|communications|demand gen\w*|cmo|pr)\b/],
  ['customer_success', /\b(customer success|customer support|support|service desk|helpdesk|help desk|customer service|onboarding|implementation)\b/],
  ['finance', /\b(finance|financial|accountant|accounting|controller|fp&a|treasury|tax|payroll|cfo|audit\w*)\b/],
  ['people', /\b(hr|human resources|people|talent|recruit\w*|chro)\b/],
  ['legal', /\b(legal|counsel|lawyer|compliance|paralegal|privacy)\b/],
  ['operations', /\b(operations|ops|supply chain|logistics|procurement|coo|project manager|program manager|programme manager|pmo)\b/],
];

const SENIORITY_RULES: Array<[JobSeniority, RegExp]> = [
  ['c_level', /\b(chief|ceo|cto|cfo|coo|cio|ciso|cmo|cro|cpo|chro)\b/],
  ['vp', /\b(vp|vice president|svp|evp)\b/],
  ['director', /\b(director|head of|head)\b/],
  ['principal', /\b(principal|staff|distinguished|architect)\b/],
  ['manager', /\b(manager|mgr)\b/],
  ['lead', /\b(lead|team lead|tech lead)\b/],
  ['senior', /\b(senior|sr|experienced|iii|expert)\b/],
  ['intern', /\b(intern|internship|stagiaire|apprentice|trainee|werkstudent)\b/],
  ['junior', /\b(junior|jr|graduate|entry level|associate)\b/],
];

/** Canonical skill name to the title pattern that signals it. */
const SKILLS: Array<[string, RegExp]> = [
  ['Snowflake', /\bsnowflake\b/],
  ['Databricks', /\bdatabricks\b/],
  ['dbt', /\bdbt\b/],
  ['Airflow', /\bairflow\b/],
  ['Spark', /\b(py)?spark\b/],
  ['Kafka', /\bkafka\b/],
  ['BigQuery', /\bbigquery\b/],
  ['Redshift', /\bredshift\b/],
  ['Power BI', /\bpower ?bi\b/],
  ['Tableau', /\btableau\b/],
  ['AWS', /\baws\b|amazon web services/],
  ['Azure', /\bazure\b/],
  ['GCP', /\bgcp\b|google cloud/],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/],
  ['Terraform', /\bterraform\b/],
  ['SAP', /\bsap\b/],
  ['S/4HANA', /s\/?4 ?hana|\bhana\b/],
  ['Oracle', /\boracle\b/],
  ['Workday', /\bworkday\b/],
  ['NetSuite', /\bnetsuite\b/],
  ['Dynamics 365', /\bdynamics( 365)?\b|\bd365\b/],
  ['Salesforce', /\bsalesforce\b|\bsfdc\b/],
  ['HubSpot', /\bhubspot\b/],
  ['ServiceNow', /\bservicenow\b/],
  ['Python', /\bpython\b/],
  ['Java', /\bjava\b/],
  ['React', /\breact\b/],
  ['LLM', /\bllms?\b|\bgenai\b|\bgen ai\b|generative ai/],
  ['PyTorch', /\bpytorch\b/],
  ['SIEM', /\bsiem\b|\bsplunk\b|\bsentinel\b/],
];

const REGION_BY_COUNTRY: Record<string, HiringRegion> = {};
function addRegion(region: HiringRegion, names: string): void {
  for (const n of names.split('|')) REGION_BY_COUNTRY[n] = region;
}
addRegion('AMER', 'united states|usa|us|united states of america|canada|ca');
addRegion(
  'LATAM',
  'brazil|brasil|br|mexico|méxico|mx|argentina|ar|chile|cl|colombia|co|peru|pe|uruguay|uy|costa rica|cr|panama|ecuador|guatemala|dominican republic|puerto rico',
);
addRegion(
  'EMEA',
  'united kingdom|uk|gb|great britain|england|scotland|ireland|ie|france|fr|germany|de|deutschland|spain|es|españa|portugal|pt|italy|it|netherlands|nl|belgium|be|luxembourg|lu|switzerland|ch|austria|at|denmark|dk|sweden|se|norway|no|finland|fi|poland|pl|czechia|czech republic|cz|romania|ro|hungary|hu|greece|gr|bulgaria|croatia|serbia|slovakia|slovenia|estonia|latvia|lithuania|ukraine|turkey|türkiye|tr|israel|il|united arab emirates|uae|ae|saudi arabia|sa|qatar|egypt|morocco|ma|tunisia|nigeria|kenya|south africa|za',
);
addRegion(
  'APAC',
  'india|in|china|cn|japan|jp|south korea|korea|kr|singapore|sg|australia|au|new zealand|nz|hong kong|hk|taiwan|tw|malaysia|my|indonesia|id|philippines|ph|vietnam|vn|thailand|th|pakistan|bangladesh|sri lanka',
);
const US_STATES = new Set(
  'al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc'.split(' '),
);

function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[()[\],/|]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

export function regionFor(country: string | null, state: string | null = null): HiringRegion {
  const c = (country ?? '').trim().toLowerCase();
  if (c && REGION_BY_COUNTRY[c]) return REGION_BY_COUNTRY[c]!;
  if (!c && state && US_STATES.has(state.trim().toLowerCase())) return 'AMER';
  return 'unknown';
}

export function classifyTitle(title: string): Pick<ClassifiedPosting, 'function' | 'seniority' | 'skills' | 'architect'> {
  const t = norm(title);
  const fn = FUNCTION_RULES.find(([, re]) => re.test(t))?.[0] ?? 'other';
  const seniority = SENIORITY_RULES.find(([, re]) => re.test(t))?.[0] ?? 'mid';
  const skills = SKILLS.filter(([, re]) => re.test(t) || re.test(title.toLowerCase())).map(([name]) => name);
  return { function: fn, seniority, skills, architect: /\barchitect\b/.test(t) };
}

export function classifyPosting(p: PostingInput): ClassifiedPosting {
  return { ...p, ...classifyTitle(p.title), region: regionFor(p.country, p.state) };
}

// ------------------------------------------------------------ breakdown

function buckets(values: string[]): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function buildHiringBreakdown(postings: ClassifiedPosting[]): HiringBreakdown {
  const groups = new Map<string, ClassifiedPosting[]>();
  for (const p of postings) {
    const k = `${p.function}|${p.region}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const clusters: HiringCluster[] = [...groups.values()]
    .map((g) => ({
      function: g[0]!.function,
      region: g[0]!.region,
      count: g.length,
      seniority: buckets(g.map((p) => p.seniority)),
      topSkills: buckets(g.flatMap((p) => p.skills)).slice(0, 8).map((b) => b.key),
      postingIds: g.slice(0, 50).map((p) => p.id),
    }))
    .sort((a, b) => b.count - a.count || a.function.localeCompare(b.function) || a.region.localeCompare(b.region));
  return {
    total: postings.length,
    byFunction: buckets(postings.map((p) => p.function)),
    bySeniority: buckets(postings.map((p) => p.seniority)),
    byRegion: buckets(postings.map((p) => p.region)),
    topSkills: buckets(postings.flatMap((p) => p.skills)).slice(0, 20),
    clusters,
  };
}

// ------------------------------------------------------------ project rules

const SENIOR: ReadonlySet<JobSeniority> = new Set(['senior', 'lead', 'principal', 'manager', 'director', 'vp', 'c_level']);
const hasSkill = (p: ClassifiedPosting, names: string[]): boolean => p.skills.some((s) => names.includes(s));

interface ProjectRule {
  kind: string;
  match: (p: ClassifiedPosting) => boolean;
  /** Minimum matching roles in one region for the low tier. */
  min: number;
  name: (ctx: { region: string; topSkill: string | null; skills: string[] }) => string;
  what: string;
}

const DATA_TARGETS = ['Snowflake', 'Databricks', 'BigQuery', 'Redshift'];
const CLOUDS = ['AWS', 'Azure', 'GCP'];
const ERP = ['SAP', 'S/4HANA', 'Oracle', 'Workday', 'NetSuite', 'Dynamics 365'];
const CRM = ['Salesforce', 'HubSpot', 'Dynamics 365'];

const inRegion = (region: string): string => (region === 'Multi-region' ? 'across regions' : `in ${region}`);

export const PROJECT_RULES: ProjectRule[] = [
  {
    kind: 'data_platform',
    match: (p) => p.function === 'data' || hasSkill(p, [...DATA_TARGETS, 'dbt', 'Airflow', 'Spark', 'Kafka']),
    min: 3,
    name: ({ region, topSkill }) =>
      topSkill && DATA_TARGETS.includes(topSkill)
        ? `Data platform migration to ${topSkill} ${inRegion(region)}`
        : `Data platform build-out ${inRegion(region)}`,
    what: 'data engineering and analytics',
  },
  {
    kind: 'ai_ml',
    match: (p) => p.function === 'ml_ai' || hasSkill(p, ['LLM', 'PyTorch']),
    min: 3,
    name: ({ region }) => `AI and machine learning programme ${inRegion(region)}`,
    what: 'AI and ML',
  },
  {
    kind: 'cloud_migration',
    match: (p) => p.function === 'infrastructure' || hasSkill(p, [...CLOUDS, 'Kubernetes', 'Terraform']),
    min: 3,
    name: ({ region, topSkill }) =>
      topSkill && CLOUDS.includes(topSkill)
        ? `Cloud migration to ${topSkill} ${inRegion(region)}`
        : `Cloud and platform modernisation ${inRegion(region)}`,
    what: 'cloud and infrastructure',
  },
  {
    kind: 'erp',
    match: (p) => hasSkill(p, ERP),
    min: 3,
    name: ({ region, topSkill, skills }) =>
      `${skills.includes('S/4HANA') ? 'SAP S/4HANA' : (topSkill ?? 'ERP')} transformation ${inRegion(region)}`,
    what: 'ERP',
  },
  {
    kind: 'crm',
    match: (p) => hasSkill(p, CRM),
    min: 3,
    name: ({ region, topSkill }) => `${topSkill ?? 'CRM'} roll-out ${inRegion(region)}`,
    what: 'CRM',
  },
  {
    kind: 'security',
    match: (p) => p.function === 'security' || hasSkill(p, ['SIEM']),
    min: 3,
    name: ({ region }) => `Security programme ${inRegion(region)}`,
    what: 'security',
  },
  {
    kind: 'gtm_expansion',
    match: (p) => p.function === 'sales' || p.function === 'marketing',
    min: 5,
    name: ({ region }) => `Go-to-market expansion ${inRegion(region)}`,
    what: 'sales and marketing',
  },
  {
    kind: 'support_scale_up',
    match: (p) => p.function === 'customer_success',
    min: 5,
    name: ({ region }) => `Customer support scale-up ${inRegion(region)}`,
    what: 'customer success and support',
  },
  {
    kind: 'product_build',
    match: (p) => p.function === 'engineering' || p.function === 'product' || p.function === 'design',
    min: 8,
    name: ({ region }) => `Product engineering scale-up ${inRegion(region)}`,
    what: 'software engineering and product',
  },
];

const LEVELS: ProjectConfidence[] = ['low', 'medium', 'high'];

function toTime(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function confidenceFor(
  matches: ClassifiedPosting[],
  min: number,
  now: Date,
): ProjectConfidence | null {
  const n = matches.length;
  if (n < min) return null;
  const anchor = matches.some((p) => p.architect || SENIOR.has(p.seniority));
  // high: a real team (10+, or twice the rule minimum) with a senior or architect anchor.
  // medium: two roles over the minimum, or one over with an anchor. low: the minimum.
  let level = n >= Math.max(10, min * 2) && anchor ? 2 : n >= min + 2 || (anchor && n >= min + 1) ? 1 : 0;
  // Stale evidence: no posting seen in the last 60 days drops one level.
  const times = matches.map((p) => toTime(p.lastSeenAt) ?? toTime(p.postedAt)).filter((t): t is number => t !== null);
  if (times.length && Math.max(...times) < now.getTime() - 60 * 86_400_000) level = Math.max(0, level - 1);
  return LEVELS[level]!;
}

function evidenceOf(matches: ClassifiedPosting[]): ProjectEvidence[] {
  const rank = (p: ClassifiedPosting): number => (p.architect ? 10 : 0) + (SENIOR.has(p.seniority) ? 5 : 0);
  return [...matches]
    .sort((a, b) => rank(b) - rank(a) || (toTime(b.postedAt) ?? 0) - (toTime(a.postedAt) ?? 0) || a.title.localeCompare(b.title))
    .slice(0, 10)
    .map((p) => ({
      postingId: p.id,
      title: p.title,
      url: p.url,
      region: p.region,
      seniority: p.seniority,
      postedAt: p.postedAt ? new Date(toTime(p.postedAt) ?? 0).toISOString() : null,
      source: p.source,
    }));
}

function rationaleFor(rule: ProjectRule, matches: ClassifiedPosting[], region: string, skills: string[]): string {
  const senior = matches.filter((p) => p.architect || SENIOR.has(p.seniority));
  const architects = matches.filter((p) => p.architect).map((p) => p.title);
  const parts = [`${matches.length} open ${rule.what} roles ${inRegion(region)}`];
  if (senior.length) parts[0] += `, ${senior.length} of them senior`;
  if (architects.length) parts.push(`including ${[...new Set(architects)].slice(0, 2).join(' and ')}`);
  let text = parts.join(', ');
  if (skills.length) text += `. Skills named in the titles: ${skills.slice(0, 5).join(', ')}`;
  return `${text}.`;
}

/**
 * Rules run per region. A region with fewer roles than the rule needs is
 * pooled into one "Multi-region" candidate so spread-out hiring still counts.
 */
export function inferPotentialProjects(postings: ClassifiedPosting[], now = new Date()): PotentialProject[] {
  const out: PotentialProject[] = [];
  for (const rule of PROJECT_RULES) {
    const matches = postings.filter(rule.match);
    if (matches.length < rule.min) continue;
    const byRegion = new Map<string, ClassifiedPosting[]>();
    for (const p of matches) byRegion.set(p.region, [...(byRegion.get(p.region) ?? []), p]);
    const groups: Array<[string, ClassifiedPosting[]]> = [];
    const leftovers: ClassifiedPosting[] = [];
    for (const [region, list] of byRegion) {
      if (region !== 'unknown' && list.length >= rule.min) groups.push([region, list]);
      else leftovers.push(...list);
    }
    // Small regional groups and roles with no stated country pool together.
    if (leftovers.length >= rule.min) groups.push(['Multi-region', leftovers]);
    for (const [region, list] of groups) {
      const confidence = confidenceFor(list, rule.min, now);
      if (!confidence) continue;
      const skillCounts = buckets(list.flatMap((p) => p.skills));
      const skills = skillCounts.map((b) => b.key);
      out.push({
        id: `${rule.kind}:${region}`,
        kind: rule.kind,
        name: rule.name({ region, topSkill: skills[0] ?? null, skills }),
        rationale: rationaleFor(rule, list, region, skills),
        confidence,
        region,
        postingCount: list.length,
        seniorCount: list.filter((p) => p.architect || SENIOR.has(p.seniority)).length,
        skills: skills.slice(0, 8),
        evidence: evidenceOf(list),
        method: 'rules',
      });
    }
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.confidence] - order[b.confidence] || b.postingCount - a.postingCount || a.id.localeCompare(b.id));
}
