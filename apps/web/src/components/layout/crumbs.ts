// Top-bar trail. A section links back only when that path is a real list.
// An account id uses a name the salesperson already opened (exact id). Anything
// else stays "Detail" — the bar does not invent a company, and a stored name
// is never turned into a URL.

export interface Crumb {
  label: string;
  /** Section or record the crumb opens. Absent on the page you are on. */
  to?: string;
}

export interface CrumbCopy {
  portfolio: string;
  detail: string;
  orgChart: string;
  sectionLabel: (segment: string) => string;
  /** Display name already stored for this exact account id. Never a URL. */
  accountName?: (id: string) => string | undefined;
}

/** List routes the first crumb may open. A section missing here stays plain text. */
const SECTION_HOME: Record<string, string> = {
  dashboard: '/dashboard',
  accounts: '/accounts',
  opportunities: '/opportunities',
  pipeline: '/pipeline',
  contacts: '/contacts',
  agreements: '/agreements',
  meetings: '/meetings',
  tasks: '/tasks',
  reports: '/reports',
  integrations: '/integrations',
  'audit-log': '/audit-log',
  settings: '/settings',
  search: '/search',
  companies: '/companies',
  leads: '/leads',
  forecasts: '/forecasts',
  calendar: '/calendar',
  'service-desk': '/service-desk',
  kam: '/kam',
  workload: '/workload',
  analytics: '/analytics',
  territories: '/territories',
};

const RECORD_ID = /^[0-9a-f-]{12,}$/i;

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function readable(segment: string): string {
  return capitalize(safeDecode(segment).replace(/-/g, ' '));
}

function storedName(id: string, accountName: CrumbCopy['accountName']): string | undefined {
  const name = accountName?.(id)?.trim();
  return name ? name : undefined;
}

export function accountCrumbName(
  id: string,
  recents: readonly { slug: string; name: string }[],
  favorites: readonly { slug: string; name: string }[],
): string | undefined {
  for (const entry of [...recents, ...favorites]) {
    if (entry.slug !== id) continue;
    const name = entry.name.trim();
    if (name) return name;
  }
  return undefined;
}

export function buildCrumbs(pathname: string, copy: CrumbCopy): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0];
  if (!root) return [{ label: copy.portfolio }];

  const rootLabel = copy.sectionLabel(root);
  if (segments.length === 1) return [{ label: rootLabel }];

  const crumbs: Crumb[] = [{ label: rootLabel }];
  const home = SECTION_HOME[root];
  if (home) crumbs[0] = { label: rootLabel, to: home };

  if (root === 'accounts') {
    const rawId = segments[1] ?? '';
    const id = safeDecode(rawId);
    const named = storedName(id, copy.accountName);
    const accountLabel = named ?? (RECORD_ID.test(id) ? copy.detail : readable(rawId));
    const onChart = segments[2] === 'org-chart';
    const account: Crumb = { label: accountLabel };
    if (onChart) account.to = `/accounts/${encodeURIComponent(id)}`;
    crumbs.push(account);
    if (onChart) crumbs.push({ label: copy.orgChart });
    return crumbs;
  }

  const second = segments[1] ?? '';
  const decoded = safeDecode(second);
  crumbs.push({ label: RECORD_ID.test(decoded) ? copy.detail : readable(second) });
  return crumbs;
}
