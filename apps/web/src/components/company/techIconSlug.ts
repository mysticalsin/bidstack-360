/**
 * techIconSlug — map a tech-stack item name to a Simple Icons slug for the
 * same-origin tech-logo proxy (`/api/v1/logo?tech=<slug>`). Pure + deterministic.
 *
 * Known multi-word / renamed brands get an explicit alias (Simple Icons slugs
 * differ from display names); everything else falls back to a normalized slug.
 * A miss (or a brand Simple Icons doesn't carry) → 404 → TechLogo's monogram.
 */
const ALIASES: Record<string, string> = {
  aws: 'amazonwebservices',
  'amazon web services': 'amazonwebservices',
  azure: 'microsoftazure',
  'microsoft azure': 'microsoftazure',
  'google cloud': 'googlecloud',
  'google cloud platform': 'googlecloud',
  gcp: 'googlecloud',
  'oracle cloud': 'oracle',
  'oracle netsuite': 'oracle',
  netsuite: 'oracle',
  'power bi': 'powerbi',
  'microsoft dynamics': 'dynamics365',
  dynamics: 'dynamics365',
  'microsoft 365': 'microsoft365',
  'office 365': 'microsoft365',
  'google workspace': 'googleworkspace',
  'g suite': 'googleworkspace',
  'adobe experience manager': 'adobe',
  aem: 'adobe',
  'salesforce commerce cloud': 'salesforce',
};

/** Lowercase, strip everything but [a-z0-9] — matches the proxy's slug guard. */
export function normalizeToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Simple Icons slug for a tech name, or null when it can't form a valid slug. */
export function techIconSlug(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  if (ALIASES[key]) return ALIASES[key];
  const slug = normalizeToSlug(key);
  return slug.length >= 2 ? slug : null;
}

/** Same-origin proxy URL for a tech name's logo, or null. */
export function techLogoUrl(name: string): string | null {
  const slug = techIconSlug(name);
  return slug ? `/api/v1/logo?tech=${encodeURIComponent(slug)}` : null;
}
