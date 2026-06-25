/**
 * techIconSlug — map a tech-stack item name to a logo URL for the same-origin
 * logo proxy (`/api/v1/logo`). Pure + deterministic. Two tiers:
 *
 *  1. KNOWN_SLUGS — brands carried by an ICON SET (Simple Icons → Devicon, chained
 *     in the proxy). Crisp vector marks. Served via `?tech=<slug>`.
 *  2. KNOWN_DOMAINS — enterprise brands NO icon set carries (Simple Icons dropped
 *     them for trademark; Devicon only covers dev tooling). Each is mapped to its
 *     official domain and the brand favicon is served via `?domain=<domain>`.
 *     This is an EXPLICIT curated map of real verified domains — not arbitrary
 *     favicon synthesis from a guessed name.
 *
 * Anything in neither table returns null → TechLogo's deterministic monogram.
 * Every slug/domain below was verified to return 200 from the live proxy.
 */
import { buildApiUrl } from '@/lib/api';

/** Normalized tech name → icon-set slug (Simple Icons / Devicon). */
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
  slack: 'slack',
  // Cisco Meraki → the Cisco mark (no Meraki-specific icon).
  cisco: 'cisco',
  ciscomeraki: 'cisco',
  paloalto: 'paloaltonetworks',
  paloaltonetworks: 'paloaltonetworks',
  // Operating systems.
  windows: 'windows11',
  windows11: 'windows11',
  macos: 'macos',
  macosx: 'macos',
  ios: 'ios',
  apple: 'apple',
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

/** Normalized tech name → official brand domain (favicon via the proxy). */
const KNOWN_DOMAINS: Record<string, string> = {
  crowdstrike: 'crowdstrike.com',
  servicenow: 'servicenow.com',
  workday: 'workday.com',
  zscaler: 'zscaler.com',
  proofpoint: 'proofpoint.com',
  sentinelone: 'sentinelone.com',
  jamf: 'jamf.com',
  jamfpro: 'jamf.com',
  duo: 'duo.com',
  duosecurity: 'duo.com',
  // Microsoft sub-brands → the Microsoft mark (Simple Icons dropped Microsoft).
  microsoft: 'microsoft.com',
  microsoft365: 'microsoft.com',
  office365: 'microsoft.com',
  microsoftentraid: 'microsoft.com',
  microsoftentra: 'microsoft.com',
  microsoftdefender: 'microsoft.com',
  microsoftintune: 'microsoft.com',
  microsoftdynamics: 'microsoft.com',
  microsoftpowerbi: 'microsoft.com',
  powerbi: 'microsoft.com',
  activedirectory: 'microsoft.com',
};

/** Lowercase, strip everything but [a-z0-9]. */
export function normalizeToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Icon-set slug for a tech name, or null (no icon-set logo). */
export function techIconSlug(name: string): string | null {
  return KNOWN_SLUGS[normalizeToSlug(name)] ?? null;
}

/** Curated brand domain for a tech name without an icon-set logo, or null. */
export function techIconDomain(name: string): string | null {
  return KNOWN_DOMAINS[normalizeToSlug(name)] ?? null;
}

/** Proxy logo URL for a tech name (icon first, then brand favicon), or null
 *  (→ monogram). Prefixes the API base so the <img> reaches the API on the
 *  split-origin demo (Vercel SPA → Railway API). */
export function techLogoUrl(name: string): string | null {
  const slug = techIconSlug(name);
  if (slug) return buildApiUrl(`/api/v1/logo?tech=${encodeURIComponent(slug)}`);
  const domain = techIconDomain(name);
  if (domain) return buildApiUrl(`/api/v1/logo?domain=${encodeURIComponent(domain)}`);
  return null;
}
