// Breadcrumb labels for the top bar. This file starts as the trail the bar
// already draws (a section word, then "Detail" for an id, nothing clickable)
// so the tests can fail on that trail before the links and account name land.

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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function prettifySegment(value: string, detailLabel: string): string {
  if (/^[0-9a-f-]{12,}$/i.test(value)) return detailLabel;
  return capitalize(value.replace(/-/g, ' '));
}

export function buildCrumbs(pathname: string, copy: CrumbCopy): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0];
  if (!root) return [{ label: copy.portfolio }];

  const rootLabel = copy.sectionLabel(root);
  const second = segments[1];
  if (!second) return [{ label: rootLabel }];

  return [{ label: rootLabel }, { label: prettifySegment(second, copy.detail) }];
}
