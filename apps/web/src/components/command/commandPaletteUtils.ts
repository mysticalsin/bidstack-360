/**
 * commandPaletteUtils — pure types, constants, matchers, and formatters.
 * No React/JSX — safe to import from tests or server-only code.
 * `highlightText` (requires JSX) lives in CommandPalette.tsx because it is
 * only used there and is not worth a separate .tsx file.
 */
import type { ReactNode } from 'react';
import type { Contact, CrmCompany, Task } from '@bidstack/shared';

import {
  isNavItemVisible,
  type NavModuleFlags,
  type NavSection,
} from '@/components/layout/navConfig';

// Per-section result caps keep the palette scannable on large tenants.
// Cap each section independently so no single group dominates the list.
export const ACCOUNT_RESULT_LIMIT = 6;
export const CONTACT_RESULT_LIMIT = 6;
export const TASK_RESULT_LIMIT = 6;

export interface Item {
  id: string;
  group:
    | 'navigate'
    | 'opportunity'
    | 'lead'
    | 'account'
    | 'contact'
    | 'task'
    | 'action'
    | 'company'
    | 'note'
    | 'invoice'
    | 'agent'
    | 'create';
  label: string;
  hint?: string;
  /** Optional leading visual (e.g. CompanyLogo for account rows). Group
   *  label is suppressed when this is set so the icon carries the affordance. */
  leading?: ReactNode;
  onSelect: () => void;
}

export type NavTarget = { to: string; label: string; hint: string };

// `g`-chord hints (useGlobalShortcuts CHORD_TARGETS) for routes that live in
// NAV_SECTIONS. Kept here rather than on NavItem itself — the sidebar has no
// keyboard chords, so navConfig.ts shouldn't need to know about them.
const NAV_CHORD_HINTS: Record<string, string> = {
  '/dashboard': 'g d',
  '/accounts': 'g a',
  '/contacts': 'g c',
  '/opportunities': 'g o',
  '/tasks': 'g t',
};

// Routes reachable ONLY from the command palette — either intentionally
// dropped from the sidebar rail (navConfig.ts explains why: /pipeline and
// /calls were folded into their parent pages; Reports/Integrations became
// Settings tabs) or system routes with no nav-section home at all
// (/search, /settings). Kept separate from NAV_SECTIONS on purpose — adding
// these there would put dead doors back in the sidebar/mobile nav.
// NOTE: none of these may be permission-gated — anything role-restricted
// belongs in PALETTE_ONLY_ADMIN_TARGETS below so it isn't spliced in for
// every user regardless of role.
const PALETTE_ONLY_TARGETS: NavTarget[] = [
  { to: '/pipeline', label: 'Go to Pipeline (kanban)', hint: 'g p' },
  { to: '/calls', label: 'Go to Calls', hint: '' },
  { to: '/service-desk', label: 'Go to Service Desk', hint: '' },
  { to: '/reports/list', label: 'Go to Reports', hint: 'g r' },
  { to: '/reports/new', label: 'New report', hint: '' },
  { to: '/integrations', label: 'Go to Integrations', hint: '' },
  { to: '/settings', label: 'Go to Settings', hint: 'g s' },
  { to: '/search', label: 'Search across workspace', hint: 'g f' },
];

// Palette-only routes that are ALSO permission-gated — mirrors SettingsLayout's
// `admin: true` GROUPS entries and the `RequireAdmin` wrapper around
// /audit-log in AdminRoutes.tsx. WHY separate from PALETTE_ONLY_TARGETS: that
// list is spliced into every user's target set unconditionally, which would
// let a non-admin ⌘K-search-and-jump at an admin-only destination — leaking
// its existence/reachability through search even though RequireAdmin bounces
// them back to /dashboard on arrival. Kept isolated so it's obvious at a
// glance which palette-only routes still need a permission check.
const PALETTE_ONLY_ADMIN_TARGETS: NavTarget[] = [
  { to: '/audit-log', label: 'Go to Audit log', hint: '' },
];

/**
 * Builds the palette's "Go to …" targets from NAV_SECTIONS (the sidebar's
 * single source of truth) instead of a hand-maintained duplicate list.
 *
 * WHY: the previous hardcoded NAV_TARGETS array drifted from navConfig.ts —
 * it unconditionally listed "Go to Agent Studio" even though that route is
 * featureKey-gated (org module flag), so an org with the module OFF could
 * still search-and-jump straight to it from ⌘K. Routing every section
 * through `isNavItemVisible` closes the module-flag leak; `isAdmin` closes
 * the matching permission leak for the one hand-added admin-only route
 * (/audit-log) that lives outside NAV_SECTIONS entirely.
 */
export function buildNavTargets(
  sections: NavSection[],
  flags: NavModuleFlags | undefined,
  isAdmin: boolean,
): NavTarget[] {
  const fromSections: NavTarget[] = sections.flatMap((section) =>
    section.items
      .filter((item) => isNavItemVisible(item, flags))
      .map((item) => ({
        to: item.to,
        label: `Go to ${item.label}`,
        hint: NAV_CHORD_HINTS[item.to] ?? '',
      })),
  );
  return [
    ...fromSections,
    ...PALETTE_ONLY_TARGETS,
    ...(isAdmin ? PALETTE_ONLY_ADMIN_TARGETS : []),
  ];
}

// ── Substring matchers ───────────────────────────────────────────────────────
// No fuzzy lib — cheap, predictable, and overkill-free for the dashboard lists.

export function matchCompanies(companies: CrmCompany[], q: string, limit: number): CrmCompany[] {
  if (!q) return companies.slice(0, limit);
  const out: CrmCompany[] = [];
  for (const c of companies) {
    const haystack = [c.name, c.legalName ?? '', c.domain ?? ''].join('\n').toLowerCase();
    if (haystack.includes(q)) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export function matchContacts(contacts: Contact[], q: string, limit: number): Contact[] {
  if (!q) return [];
  const out: Contact[] = [];
  for (const c of contacts) {
    const haystack = [c.name, c.email ?? '', c.role ?? '', c.customer].join('\n').toLowerCase();
    if (haystack.includes(q)) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export function matchTasks(tasks: Task[], q: string, limit: number): Task[] {
  if (!q) return [];
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.title.toLowerCase().includes(q)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Subtitle formatters ──────────────────────────────────────────────────────

export function accountSubtitle(c: CrmCompany): string | undefined {
  const parts = [c.industry, c.domain].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' · ') : undefined;
}

export function contactSubtitle(c: Contact): string | undefined {
  const parts = [c.role, c.customer].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' · ') : undefined;
}

export function taskSubtitle(t: Task): string | undefined {
  return t.dueDate ? `Due ${t.dueDate} · ${t.status}` : t.status;
}

// ── Navigation helpers ───────────────────────────────────────────────────────

export function findDirectNavTarget(
  navTargets: NavTarget[],
  query: string,
): NavTarget | undefined {
  const normalized = normalizeNavQuery(query);
  if (!normalized) return undefined;
  return navTargets.find((target) => {
    const label = normalizeNavQuery(
      target.label
        .replace(/^go to\s+/i, '')
        .replace(/\([^)]*\)/g, '')
        .trim(),
    );
    const route = normalizeNavQuery(target.to.replace(/^\//, ''));
    return normalized === label || normalized === route;
  });
}

export function normalizeNavQuery(value: string): string {
  return value.trim().toLowerCase();
}

// ── Rendering helpers ────────────────────────────────────────────────────────

export function groupTag(group: Item['group']): string {
  if (group === 'opportunity') return 'opp';
  if (group === 'account') return 'acct';
  if (group === 'contact') return 'who';
  if (group === 'task') return 'todo';
  if (group === 'agent') return 'agent';
  return group;
}

// Human-readable group names for the listbox's `role="group"` wrappers —
// screen-reader-only labeling, distinct from groupTag's terse visual badge
// (which sighted users already see per-row).
const GROUP_ARIA_LABELS: Record<Item['group'], string> = {
  navigate: 'Navigate',
  opportunity: 'Opportunities',
  lead: 'Leads',
  account: 'Accounts',
  contact: 'Contacts',
  task: 'Tasks',
  action: 'Actions',
  company: 'Companies',
  note: 'Notes',
  invoice: 'Invoices',
  agent: 'Agents',
  create: 'Create',
};

export function groupAriaLabel(group: Item['group']): string {
  return GROUP_ARIA_LABELS[group];
}

export interface ItemGroupRun {
  group: Item['group'];
  /** Item plus its original flat index into the full items array — keyboard
   *  nav (ArrowUp/Down, aria-activedescendant, data-cmdk-idx) addresses rows
   *  by that flat index, not by position within the group, so it must
   *  survive the regroup. */
  entries: { item: Item; index: number }[];
}

/**
 * Groups a flat, ordered item list into contiguous runs sharing the same
 * `group` value, without reordering anything. Used to wrap the palette's
 * listbox rows in `role="group"` sections for screen readers while keeping
 * a single flat keyboard-nav index.
 */
export function groupItemsByRun(items: Item[]): ItemGroupRun[] {
  const runs: ItemGroupRun[] = [];
  items.forEach((item, index) => {
    const last = runs[runs.length - 1];
    if (last && last.group === item.group) {
      last.entries.push({ item, index });
    } else {
      runs.push({ group: item.group, entries: [{ item, index }] });
    }
  });
  return runs;
}
