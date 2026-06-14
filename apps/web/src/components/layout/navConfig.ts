// Single source of truth for the primary navigation.
//
// WHY this file exists: the nav was previously copy-pasted as a flat 24-item
// `WORKSPACE` array in BOTH Sidebar.tsx and MobileNav.tsx. The two copies had
// already drifted (the sidebar's admin settings listed Webhooks + Audit log;
// the mobile drawer's listed only Audit log). Centralizing the structure here
// removes that drift class entirely and lets both surfaces render the same
// grouped sub-sections.
//
// Icons are chosen to be distinct within the rail so the collapsed icon-only
// mode stays legible — the old flat list reused `briefcase` ×4, `building` ×4
// and `reports` ×3, which were indistinguishable once labels were hidden.

import type { IconName } from '@/components/ui/Icon';

export type NavBadgeKey = 'openBids' | 'overdueTasks';

export interface NavItem {
  to: string;
  /** English label; also the i18n fallback when a translation is missing. */
  label: string;
  /** i18n key in the `common` namespace, rendered as t(labelKey, label). */
  labelKey: string;
  icon: IconName;
  badgeKey?: NavBadgeKey;
  /** Exact-match active state. Use for section overviews whose sub-routes are
   *  themselves separate nav items (e.g. `/sales` vs `/sales/orders`), so the
   *  overview doesn't stay highlighted while a sibling route is active. */
  end?: boolean;
}

export interface NavSection {
  /** Stable key used to persist this section's collapsed state. */
  key: string;
  title: string;
  /** i18n key in the `common` namespace, rendered as t(titleKey, title). */
  titleKey: string;
  icon: IconName;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'home',
    title: 'Home',
    titleKey: 'nav.home',
    icon: 'dashboard',
    items: [
      { to: '/dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', icon: 'dashboard' },
      { to: '/quick-start', label: 'Quick Start', labelKey: 'nav.quickStart', icon: 'help' },
    ],
  },
  {
    key: 'sales',
    title: 'Sales',
    titleKey: 'nav.sales',
    icon: 'dollar',
    items: [
      { to: '/forecasts', label: 'Forecasts', labelKey: 'nav.forecasts', icon: 'growth' },
      { to: '/sales-toolkits', label: 'Sales Toolkits', labelKey: 'nav.salesToolkits', icon: 'book' },
    ],
  },
  {
    key: 'accounts',
    title: 'Accounts',
    titleKey: 'nav.accounts',
    icon: 'building',
    items: [
      { to: '/accounts', label: 'Accounts', labelKey: 'nav.accounts', icon: 'building' },
      { to: '/key-accounts', label: 'Key Accounts', labelKey: 'nav.keyAccounts', icon: 'star' },
      { to: '/top-accounts', label: 'Top Accounts', labelKey: 'nav.topAccounts', icon: 'trophy' },
      { to: '/companies', label: 'Companies', labelKey: 'nav.companies', icon: 'list' },
      { to: '/sector-view', label: 'Sector View', labelKey: 'nav.sectorView', icon: 'globe' },
      { to: '/cross-sell', label: 'Cross-sell', labelKey: 'nav.crossSell', icon: 'git-branch' },
      { to: '/contacts', label: 'Contacts', labelKey: 'nav.contacts', icon: 'contacts' },
      { to: '/references', label: 'Reference Library', labelKey: 'nav.references', icon: 'book' },
    ],
  },
  {
    key: 'pipeline',
    title: 'Pipeline',
    titleKey: 'nav.pipeline',
    icon: 'pipeline',
    items: [
      { to: '/leads', label: 'Leads', labelKey: 'nav.leads', icon: 'zap' },
      // Opportunities hosts both the list and the kanban board (List / Board
      // toggle in-page); the standalone /pipeline route still works and is
      // reached through that toggle, so it is no longer a separate rail entry.
      { to: '/opportunities', label: 'Opportunities', labelKey: 'nav.opportunities', icon: 'target', badgeKey: 'openBids' },
      { to: '/territories', label: 'Territories', labelKey: 'nav.territories', icon: 'globe' },
    ],
  },
  {
    key: 'bids',
    title: 'Bids & RFP',
    titleKey: 'nav.bidsRfp',
    icon: 'checkCircle',
    items: [
      { to: '/bid-matrix', label: 'Bid/No-Bid Matrix', labelKey: 'nav.bidMatrix', icon: 'checkCircle' },
      // RFP Response Hub (a read-only roll-up) folded into Proposals — the
      // actual work surface. /rfp-response now redirects there.
      { to: '/proposals', label: 'Proposals', labelKey: 'nav.proposals', icon: 'receipt' },
      { to: '/agent-studio', label: 'Agent Studio', labelKey: 'nav.agentStudio', icon: 'sparkle' },
    ],
  },
  {
    key: 'workspace',
    title: 'Workspace',
    titleKey: 'nav.workspace',
    icon: 'tasks',
    items: [
      { to: '/tasks', label: 'Tasks', labelKey: 'nav.tasks', icon: 'tasks', badgeKey: 'overdueTasks' },
      { to: '/calendar', label: 'Calendar', labelKey: 'nav.calendar', icon: 'clock' },
      // Calls now live in context on the Opportunity detail (Calls tab). The
      // /calls route stays (global list, reachable via the command palette) but
      // is no longer a separate rail door.
      { to: '/workflows', label: 'Workflows', labelKey: 'nav.workflows', icon: 'git-branch' },
      { to: '/custom-objects', label: 'Custom Objects', labelKey: 'nav.customObjects', icon: 'sliders' },
      { to: '/intake', label: 'Document Intake', labelKey: 'nav.intake', icon: 'download' },
      // Reports + dashboards live under one Insights surface (Analytics): the
      // page hosts the dashboard switcher, "Manage dashboards", and links to
      // saved Reports + the report builder. No separate Reports rail door.
      { to: '/analytics', label: 'Analytics & Reports', labelKey: 'nav.analyticsReports', icon: 'dashboard' },
    ],
  },
];

// RFP Analytics, Integrations, Webhooks and Audit log are now TABS inside the
// Settings page (see SettingsLayout GROUPS — RFP Analytics/Webhooks/Audit log are
// admin-gated there), so the sidebar shows a single "Settings" entry for everyone
// instead of duplicating those destinations as standalone nav links.
export const ADMIN_SETTINGS: NavItem[] = [
  { to: '/settings', label: 'Settings', labelKey: 'nav.settings', icon: 'settings' },
];

export const MEMBER_SETTINGS: NavItem[] = [
  { to: '/settings', label: 'Settings', labelKey: 'nav.settings', icon: 'settings' },
];
