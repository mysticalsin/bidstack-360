/**
 * commandPaletteUtils — pure types, constants, matchers, ranking, and
 * formatters. No React/JSX — safe to import from tests or server-only code.
 * `highlightText` (requires JSX) lives in CommandPalette.tsx because it is
 * only used there and is not worth a separate .tsx file.
 * Fuzzy scoring lives in paletteFuzzy.ts, frecency in paletteFrecency.ts;
 * this file composes them into the palette's match → rank pipeline.
 */
import type { ReactNode } from 'react';
import type { Contact, CrmCompany, Task } from '@bidstack/shared';

import {
  isNavItemVisible,
  type NavModuleFlags,
  type NavSection,
} from '@/components/layout/navConfig';

import { canonicalPaletteId, frecencyBoost, recordPaletteSelection } from './paletteFrecency';
import { fuzzyMatch } from './paletteFuzzy';

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
    | 'create'
    | 'ask';
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
  // Key/Top accounts dropped from the sidebar rail (folded into /accounts as
  // ?view= segments) but kept ⌘K-discoverable here so muscle memory still works.
  { to: '/accounts?view=key', label: 'Go to Key accounts', hint: '' },
  { to: '/accounts?view=top', label: 'Go to Top accounts', hint: '' },
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

// ── Fuzzy matchers & ranking ─────────────────────────────────────────────────
// Scoring model lives in paletteFuzzy.ts (pure, dependency-free); re-exported
// here so palette consumers and tests keep one import surface.
export { fuzzyMatch, type FuzzyMatch } from './paletteFuzzy';

export interface ScoredResult<T> {
  value: T;
  score: number;
}

/** Best fuzzy score across an entity's searchable fields, or null when none
 *  match — a domain/email hit must rank the row as well as a name hit
 *  would, so we keep the max rather than a name-only score. */
function bestFieldScore(q: string, fields: (string | null | undefined)[]): number | null {
  let best: number | null = null;
  for (const field of fields) {
    if (!field) continue;
    const m = fuzzyMatch(q, field);
    if (m && (best === null || m.score > best)) best = m.score;
  }
  return best;
}

function matchScored<T>(
  values: T[],
  fieldsOf: (value: T) => (string | null | undefined)[],
  q: string,
  limit: number,
): ScoredResult<T>[] {
  const scored: ScoredResult<T>[] = [];
  for (const value of values) {
    const score = bestFieldScore(q, fieldsOf(value));
    if (score !== null) scored.push({ value, score });
  }
  // Sort BEFORE capping — the old first-N-substring-hits approach could drop
  // the best match entirely when a weak hit filled the cap first.
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function matchCompanies(
  companies: CrmCompany[],
  q: string,
  limit: number,
): ScoredResult<CrmCompany>[] {
  if (!q) return companies.slice(0, limit).map((value) => ({ value, score: 0 }));
  return matchScored(companies, (c) => [c.name, c.legalName, c.domain], q, limit);
}

export function matchContacts(
  contacts: Contact[],
  q: string,
  limit: number,
): ScoredResult<Contact>[] {
  if (!q) return [];
  return matchScored(contacts, (c) => [c.name, c.email, c.role, c.customer], q, limit);
}

export function matchTasks(tasks: Task[], q: string, limit: number): ScoredResult<Task>[] {
  if (!q) return [];
  return matchScored(tasks, (t) => [t.title], q, limit);
}

export interface RankedPaletteEntry {
  item: Item;
  score: number;
}

/** Stable descending sort — ties keep source insertion order (contextual →
 *  create → nav → entities), which is what made the old fixed grouping feel
 *  predictable. */
export function rankPaletteItems(entries: readonly RankedPaletteEntry[]): Item[] {
  return [...entries].sort((a, b) => b.score - a.score).map((entry) => entry.item);
}

/**
 * Final assembly for the palette list: boost text scores with frecency and
 * rank (only when a query is typed — the empty-query palette keeps its
 * curated section order), then wrap every row's onSelect so repeat
 * selections accrue frecency for future opens.
 */
export function finalizePaletteItems(
  entries: readonly RankedPaletteEntry[],
  q: string,
  frecency: ReadonlyMap<string, number>,
): Item[] {
  const ranked = q
    ? rankPaletteItems(
        entries.map(({ item, score }) => ({
          item,
          score: score + frecencyBoost(frecency.get(canonicalPaletteId(item.id)) ?? 0),
        })),
      )
    : entries.map((entry) => entry.item);
  return ranked.map(withSelectionRecording);
}

/** Nav rows are deliberately excluded — selectNavTarget records those itself
 *  so the Enter-to-exact-route shortcut (which bypasses the items list
 *  entirely) still counts toward frecency without double-counting clicks. */
function withSelectionRecording(item: Item): Item {
  if (item.id.startsWith('nav:')) return item;
  return {
    ...item,
    onSelect: () => {
      recordPaletteSelection(canonicalPaletteId(item.id));
      item.onSelect();
    },
  };
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
  if (group === 'ask') return 'ai';
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
  ask: 'Copilot',
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
