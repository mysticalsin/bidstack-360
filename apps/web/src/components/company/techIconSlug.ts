/**
 * techIconSlug — map a tech-stack item name to a Simple Icons slug for the
 * same-origin tech-logo proxy (`/api/v1/logo?tech=<slug>`). Pure + deterministic.
 *
 * IMPORTANT: we request a logo ONLY for slugs Simple Icons is verified to carry,
 * so the proxy never 404s and the <img> never breaks (no console noise). Simple
 * Icons has dropped many enterprise brands for trademark reasons — Microsoft
 * (Azure, M365, Dynamics, Power BI…), AWS, Salesforce, Oracle — those (and any
 * unknown name) fall straight to TechLogo's deterministic monogram.
 */

/** Normalized tech name → verified Simple Icons slug. Keyed by normalizeToSlug(). */
const KNOWN_SLUGS: Record<string, string> = {
  googlecloud: 'googlecloud',
  gcp: 'googlecloud',
  cloudflare: 'cloudflare',
  snowflake: 'snowflake',
  databricks: 'databricks',
  looker: 'looker',
  hubspot: 'hubspot',
  sap: 'sap',
  okta: 'okta',
  splunk: 'splunk',
  anthropic: 'anthropic',
  github: 'github',
  gitlab: 'gitlab',
  kubernetes: 'kubernetes',
  k8s: 'kubernetes',
  docker: 'docker',
  terraform: 'terraform',
  datadog: 'datadog',
  jira: 'jira',
  shopify: 'shopify',
  vmware: 'vmware',
  react: 'react',
  postgresql: 'postgresql',
  postgres: 'postgresql',
  // Enterprise brands Simple Icons dropped (trademark) but Devicon carries —
  // the proxy chains SI → Devicon, so these resolve to a real logo.
  aws: 'amazonwebservices',
  amazonwebservices: 'amazonwebservices',
  azure: 'azure',
  microsoftazure: 'azure',
  salesforce: 'salesforce',
  salesforcecommercecloud: 'salesforce',
  oracle: 'oracle',
  oraclecloud: 'oracle',
  oraclenetsuite: 'oracle',
  dotnet: 'dotnetcore',
  dotnetcore: 'dotnetcore',
  net: 'dotnetcore',
};

/** Lowercase, strip everything but [a-z0-9]. */
export function normalizeToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Verified Simple Icons slug for a tech name, or null (→ monogram fallback). */
export function techIconSlug(name: string): string | null {
  return KNOWN_SLUGS[normalizeToSlug(name)] ?? null;
}

/** Same-origin proxy URL for a tech name's logo, or null. */
export function techLogoUrl(name: string): string | null {
  const slug = techIconSlug(name);
  return slug ? `/api/v1/logo?tech=${encodeURIComponent(slug)}` : null;
}
