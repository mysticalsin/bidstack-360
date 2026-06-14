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
  label: string;
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
  icon: IconName;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'home',
    title: 'Home',
    icon: 'dashboard',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
      { to: '/quick-start', label: 'Quick Start', icon: 'help' },
    ],
  },
  {
    key: 'sales',
    title: 'Sales',
    icon: 'dollar',
    items: [
      { to: '/forecasts', label: 'Forecasts', icon: 'growth' },
      { to: '/sales-toolkits', label: 'Sales Toolkits', icon: 'book' },
    ],
  },
  {
    key: 'accounts',
    title: 'Accounts',
    icon: 'building',
    items: [
      { to: '/accounts', label: 'Accounts', icon: 'building' },
      { to: '/key-accounts', label: 'Key Accounts', icon: 'star' },
      { to: '/top-accounts', label: 'Top Accounts', icon: 'trophy' },
      { to: '/companies', label: 'Companies', icon: 'list' },
      { to: '/sector-view', label: 'Sector View', icon: 'globe' },
      { to: '/cross-sell', label: 'Cross-sell', icon: 'git-branch' },
      { to: '/contacts', label: 'Contacts', icon: 'contacts' },
      { to: '/references', label: 'Reference Library', icon: 'book' },
    ],
  },
  {
    key: 'pipeline',
    title: 'Pipeline',
    icon: 'pipeline',
    items: [
      { to: '/leads', label: 'Leads', icon: 'zap' },
      // Opportunities hosts both the list and the kanban board (List / Board
      // toggle in-page); the standalone /pipeline route still works and is
      // reached through that toggle, so it is no longer a separate rail entry.
      { to: '/opportunities', label: 'Opportunities', icon: 'target', badgeKey: 'openBids' },
      { to: '/territories', label: 'Territories', icon: 'globe' },
    ],
  },
  {
    key: 'bids',
    title: 'Bids & RFP',
    icon: 'checkCircle',
    items: [
      { to: '/bid-matrix', label: 'Bid/No-Bid Matrix', icon: 'checkCircle' },
      // RFP Response Hub (a read-only roll-up) folded into Proposals — the
      // actual work surface. /rfp-response now redirects there.
      { to: '/proposals', label: 'Proposals', icon: 'receipt' },
      { to: '/agent-studio', label: 'Agent Studio', icon: 'sparkle' },
    ],
  },
  {
    key: 'workspace',
    title: 'Workspace',
    icon: 'tasks',
    items: [
      { to: '/tasks', label: 'Tasks', icon: 'tasks', badgeKey: 'overdueTasks' },
      { to: '/calendar', label: 'Calendar', icon: 'clock' },
      // Calls now live in context on the Opportunity detail (Calls tab). The
      // /calls route stays (global list, reachable via the command palette) but
      // is no longer a separate rail door.
      { to: '/workflows', label: 'Workflows', icon: 'git-branch' },
      { to: '/custom-objects', label: 'Custom Objects', icon: 'sliders' },
      { to: '/intake', label: 'Document Intake', icon: 'download' },
      // Reports + dashboards live under one Insights surface (Analytics): the
      // page hosts the dashboard switcher, "Manage dashboards", and links to
      // saved Reports + the report builder. No separate Reports rail door.
      { to: '/analytics', label: 'Analytics & Reports', icon: 'dashboard' },
    ],
  },
];

// RFP Analytics, Integrations, Webhooks and Audit log are now TABS inside the
// Settings page (see SettingsLayout GROUPS — RFP Analytics/Webhooks/Audit log are
// admin-gated there), so the sidebar shows a single "Settings" entry for everyone
// instead of duplicating those destinations as standalone nav links.
export const ADMIN_SETTINGS: NavItem[] = [{ to: '/settings', label: 'Settings', icon: 'settings' }];

export const MEMBER_SETTINGS: NavItem[] = [
  { to: '/settings', label: 'Settings', icon: 'settings' },
];
