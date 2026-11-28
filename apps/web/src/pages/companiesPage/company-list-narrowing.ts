import {
  COMPANY_INTEL_VIEWS,
  type CompanyIntelView,
  type IntelDirection,
} from '@bidstack/shared';

// Same words as the direction <select> on the Companies toolbar
// (IntelViewsBar). The empty state repeats them so a miss names the control
// the reader just set.
const DIRECTION_LABEL: Record<IntelDirection, string> = {
  growing: 'Growing',
  steady: 'Steady',
  contracting: 'Contracting',
};

/**
 * Label for an intel view and/or direction on the Companies list.
 * Null means neither is set: the page is the latest unfiltered page, and a
 * search box is a separate narrowing. A saved view is not "the latest 50".
 */
export function companyListFilterLabel(
  view: CompanyIntelView | null,
  direction: IntelDirection | null,
): string | null {
  const parts: string[] = [];
  if (view) parts.push(COMPANY_INTEL_VIEWS[view].label);
  if (direction) parts.push(DIRECTION_LABEL[direction]);
  return parts.length > 0 ? parts.join(', ') : null;
}
