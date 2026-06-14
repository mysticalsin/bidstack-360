/**
 * commandPaletteUtils — pure types, constants, matchers, and formatters.
 * No React/JSX — safe to import from tests or server-only code.
 * `highlightText` (requires JSX) lives in CommandPalette.tsx because it is
 * only used there and is not worth a separate .tsx file.
 */
import type { ReactNode } from 'react';
import type { Contact, CrmCompany, Task } from '@bidstack/shared';

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
    | 'agent';
  label: string;
  hint?: string;
  /** Optional leading visual (e.g. CompanyLogo for account rows). Group
   *  label is suppressed when this is set so the icon carries the affordance. */
  leading?: ReactNode;
  onSelect: () => void;
}

export type NavTarget = { to: string; label: string; hint: string };

// Every navigable destination, kept in sync with navConfig.ts. Hints show the
// real `g`-chord where one exists (useGlobalShortcuts CHORD_TARGETS); the rest
// have none rather than a fake ⌘-digit that nothing binds.
export const NAV_TARGETS: NavTarget[] = [
  // Home + accounts
  { to: '/dashboard', label: 'Go to Dashboard', hint: 'g d' },
  { to: '/accounts', label: 'Go to Accounts', hint: 'g a' },
  { to: '/key-accounts', label: 'Go to Key Accounts', hint: '' },
  { to: '/top-accounts', label: 'Go to Top Accounts', hint: '' },
  { to: '/companies', label: 'Go to Companies', hint: '' },
  { to: '/contacts', label: 'Go to Contacts', hint: 'g c' },
  { to: '/sector-view', label: 'Go to Sector View', hint: '' },
  { to: '/cross-sell', label: 'Go to Cross-sell actions', hint: '' },
  { to: '/references', label: 'Go to Reference Library', hint: '' },
  // Sales + pipeline
  { to: '/leads', label: 'Go to Leads', hint: '' },
  { to: '/opportunities', label: 'Go to Opportunities', hint: 'g o' },
  { to: '/pipeline', label: 'Go to Pipeline (kanban)', hint: 'g p' },
  { to: '/forecasts', label: 'Go to Forecasts', hint: '' },
  { to: '/territories', label: 'Go to Territories', hint: '' },
  { to: '/sales-toolkits', label: 'Go to Sales Toolkits', hint: '' },
  // Bids + proposals
  { to: '/bid-matrix', label: 'Go to Bid/No-Bid Matrix', hint: '' },
  { to: '/proposals', label: 'Go to Proposals', hint: '' },
  { to: '/intake', label: 'Go to Document Intake', hint: '' },
  { to: '/agent-studio', label: 'Go to Agent Studio', hint: '' },
  // Work
  { to: '/tasks', label: 'Go to Tasks', hint: 'g t' },
  { to: '/calendar', label: 'Go to Calendar', hint: '' },
  { to: '/calls', label: 'Go to Calls', hint: '' },
  { to: '/workflows', label: 'Go to Workflows', hint: '' },
  { to: '/custom-objects', label: 'Go to Custom Objects', hint: '' },
  { to: '/quick-start', label: 'Go to Quick Start', hint: '' },
  { to: '/reports/list', label: 'Go to Reports', hint: 'g r' },
  { to: '/reports/new', label: 'New report', hint: '' },
  { to: '/analytics', label: 'Go to Analytics', hint: '' },
  // System
  { to: '/integrations', label: 'Go to Integrations', hint: '' },
  { to: '/audit-log', label: 'Go to Audit log', hint: '' },
  { to: '/settings', label: 'Go to Settings', hint: 'g s' },
  { to: '/search', label: 'Search across workspace', hint: 'g f' },
];

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

export function findDirectNavTarget(query: string): NavTarget | undefined {
  const normalized = normalizeNavQuery(query);
  if (!normalized) return undefined;
  return NAV_TARGETS.find((target) => {
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
