/**
 * usePaletteItems — builds the full command-palette item list from all data
 * sources (contextual commands, recents, nav targets, accounts, contacts,
 * tasks, global search, opportunity search), scores every row against the
 * query (paletteFuzzy) and ranks by text relevance + frecency
 * (paletteFrecency) so frequently-used targets float to the top.
 *
 * Extracted from CommandPalette.tsx to keep the palette shell under the
 * 400-line file cap. Returns items + loading state + selectNavTarget so the
 * keyboard handler in PaletteBody can trigger direct nav without re-deriving
 * the navigate callback.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { CompanyLogo } from '@/components/company/CompanyLogo';
import { NAV_SECTIONS } from '@/components/layout/navConfig';
import { buildQuickAddOptions, chooseQuickAdd } from '@/components/quickadd/quickAddOptions';
import { useAppModules } from '@/hooks/useAppModules';
import { useCommandContextStore } from '@/hooks/useCommandContext';
import { useContacts } from '@/hooks/useContacts';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useTasks } from '@/hooks/useTasks';
import { api } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { getRecents, pushRecent, type RecentEntry } from '@/lib/palette-recents';
import { useAccountHistory } from '@/stores/accountHistory';
import type { OpportunityPage } from '@bidstack/shared';

import {
  ACCOUNT_RESULT_LIMIT,
  CONTACT_RESULT_LIMIT,
  TASK_RESULT_LIMIT,
  buildNavTargets,
  finalizePaletteItems,
  findDirectNavTarget as findDirectNavTargetIn,
  fuzzyMatch,
  type Item,
  type NavTarget,
  type RankedPaletteEntry,
  matchCompanies,
  matchContacts,
  matchTasks,
  accountSubtitle,
  contactSubtitle,
  taskSubtitle,
} from './commandPaletteUtils';
import { getFrecencyScores, recordPaletteSelection } from './paletteFrecency';

// Non-label hits (hint text, quick-add key) score just above zero: findable,
// but never outranking a real label match.
const WEAK_MATCH_SCORE = 1;

export interface UsePaletteItemsResult {
  items: Item[];
  isFetching: boolean;
  selectNavTarget: (target: NavTarget) => void;
  /** Bound to the current (flag-filtered) nav target list — see CommandPalette's
   *  Enter-key "jump straight to an exact route match" shortcut. */
  findDirectNavTarget: (query: string) => NavTarget | undefined;
}

export function usePaletteItems(query: string, onClose: () => void): UsePaletteItemsResult {
  const navigate = useNavigate();
  const { t } = useTranslation('crm');

  // Snapshot recents at mount — stable while palette is open so items don't
  // shift as the user types (could change their index mid-selection).
  const [recents] = useState<RecentEntry[]>(() => getRecents());

  // Frecency snapshot, same rationale: no reshuffling from one's own picks.
  const [frecency] = useState<ReadonlyMap<string, number>>(() => getFrecencyScores());

  // Recently-visited accounts from the cockpit history store. Slice in memo
  // rather than in the selector — a selector that slices returns a new array
  // on every store read and triggers Zustand's "getSnapshot uncached" loop.
  const allRecents = useAccountHistory((s) => s.recents);
  const accountRecents = useMemo(() => allRecents.slice(0, 3), [allRecents]);

  // Debounce the query feeding the two SERVER searches so they fire once the
  // user pauses, not on every keystroke (was 2 network calls per character).
  // Local/in-memory filtering below keeps using the live `query` for instant
  // feedback.
  const debouncedQuery = useDebouncedValue(query, 200);

  const oppSearch = useQuery({
    enabled: debouncedQuery.trim().length >= 2,
    queryKey: ['palette:opps', debouncedQuery],
    queryFn: ({ signal }) =>
      api<OpportunityPage>(
        `/api/opportunities?search=${encodeURIComponent(debouncedQuery)}&limit=8`,
        { signal },
      ),
  });

  const globalSearch = useGlobalSearch(debouncedQuery);

  // Dashboard snapshot is already in React Query cache once the user has
  // visited the dashboard — effectively free here.
  const dashboard = useCrmDashboard();
  const companies = useMemo(() => dashboard.data?.companies ?? [], [dashboard.data?.companies]);

  // Contacts + tasks use the same hooks as their pages, so the palette
  // inherits cached data without extra fetches.
  const contacts = useContacts();
  const tasks = useTasks();

  // Contextual commands registered by the currently mounted page (A3 — Twenty
  // pattern). Appear at the top of the list so page-specific actions are
  // immediately reachable without scrolling.
  const contextualCommands = useCommandContextStore((s) => s.commands);

  // Org module flags (agent-studio, AppFlowy, SERUM) gate whole nav sections.
  // Reusing the sidebar's query key means cached data renders instantly (no
  // loading flash) — but useAppModules sets staleTime:0/refetchOnMount:'always'
  // (flags must reflect the current org config, not a stale cache; see that
  // hook's own WHY comment), so a background refetch still fires on every
  // ⌘K open. Cheap endpoint, so not a functional problem — just don't assume
  // this avoids the network round-trip.
  const appModules = useAppModules();

  const isAdmin = useIsAdmin();

  // Palette nav targets, derived from NAV_SECTIONS (the sidebar's single
  // source of truth) instead of a hand-maintained duplicate list — see
  // buildNavTargets' doc comment for the drift bug this replaces. isAdmin
  // gates the one hand-added permission-restricted palette-only route
  // (/audit-log) the same way SettingsLayout gates its `admin: true` tabs.
  const navTargets = useMemo(
    () => buildNavTargets(NAV_SECTIONS, appModules.data, isAdmin),
    [appModules.data, isAdmin],
  );

  const quickAddOptions = useMemo(() => buildQuickAddOptions(t), [t]);

  const selectNavTarget = useCallback(
    (target: NavTarget) => {
      // Recorded here (not in the item wrapper) so the Enter-to-exact-route
      // shortcut also accrues frecency without double-counting row clicks.
      recordPaletteSelection(`nav:${target.to}`);
      pushRecent({
        id: `nav:${target.to}`,
        group: 'navigate',
        label: target.label,
        hint: target.hint,
        route: target.to,
      });
      navigate(target.to);
      onClose();
    },
    [navigate, onClose],
  );

  const items: Item[] = useMemo(() => {
    const entries: RankedPaletteEntry[] = [];
    const q = query.trim().toLowerCase();

    // Label score: neutral 0 when browsing (empty query keeps curated
    // section order), fuzzy score when typing, null → row filtered out.
    const scoreLabel = (label: string): number | null =>
      q ? (fuzzyMatch(q, label)?.score ?? null) : 0;

    // Shared push for rows that navigate on select. `remember` preserves the
    // old split: fresh hits go into palette-recents; rows that came FROM a
    // recents source are not re-pushed (no reshuffling the list just used).
    const pushNavigable = (
      score: number,
      partial: Omit<Item, 'onSelect'>,
      route: string,
      remember: boolean,
    ) => {
      entries.push({
        score,
        item: {
          ...partial,
          onSelect: () => {
            if (remember) {
              pushRecent({
                id: partial.id,
                // Navigable rows never carry the palette-local 'action'/'create'
                // groups, so the narrower RecentEntry union holds.
                group: partial.group as RecentEntry['group'],
                label: partial.label,
                ...(partial.hint ? { hint: partial.hint } : {}),
                route,
              });
            }
            navigate(route);
            onClose();
          },
        },
      });
    };

    // Contextual commands from the active page (e.g. "Create task for this opp").
    // Filtered by query when one is typed; hint text is a weak fallback match.
    for (const cmd of contextualCommands) {
      const score =
        scoreLabel(cmd.label) ??
        (cmd.hint?.toLowerCase().includes(q) ? WEAK_MATCH_SCORE : null);
      if (score === null) continue;
      entries.push({
        score,
        item: {
          id: `ctx:${cmd.id}`,
          group: 'action',
          label: cmd.label,
          hint: cmd.hint,
          onSelect: () => {
            cmd.onSelect();
            onClose();
          },
        },
      });
    }

    // Palette-recents (user's previous palette selections). Shown when empty
    // query — Spotlight-style "continue where you left off".
    if (!q && recents.length > 0) {
      for (const r of recents) {
        pushNavigable(
          0,
          {
            id: `recent:${r.id}`,
            group: r.group,
            label: r.label,
            hint: r.hint ?? t('usePaletteItems.recentlyVisited', 'Recently visited'),
          },
          r.route,
          false,
        );
      }
    }

    // Cockpit-visit recents — accounts the user actually opened the cockpit
    // for (distinct from palette-recents). Join against companies for logo.
    if (!q && accountRecents.length > 0) {
      for (const acc of accountRecents) {
        const company = companies.find((c) => c.id === acc.slug);
        pushNavigable(
          0,
          {
            id: `recent-account:${acc.slug}`,
            group: 'account',
            label: acc.name,
            hint: t('usePaletteItems.recentlyVisited', 'Recently visited'),
            leading: company ? (
              <CompanyLogo
                name={company.name}
                logo={company.logo}
                domain={company.domain}
                size={18}
              />
            ) : undefined,
          },
          `/accounts/${encodeURIComponent(acc.slug)}`,
          false,
        );
      }
    }

    // "Create" group — same entities/dialogs as the `N`-key quick-add menu
    // (quickAddOptions.ts), reachable from ⌘K without duplicating the forms.
    // NOTE: deliberately NOT passing opt.hint ('O'/'T'/'C'/'M') through as the
    // row hint — those single-letter keys are only live bindings inside
    // QuickAddMenu's own listbox. Inside the palette the input has focus, so
    // pressing them just types into the search box; showing them here would
    // imply a working shortcut that isn't (the "fake shortcut" anti-pattern
    // NAV_CHORD_HINTS above deliberately avoids for nav rows).
    for (const opt of quickAddOptions) {
      const score = scoreLabel(opt.label) ?? (opt.key.includes(q) ? WEAK_MATCH_SCORE : null);
      if (score === null) continue;
      entries.push({
        score,
        item: {
          id: `create:${opt.key}`,
          group: 'create',
          label: opt.label,
          onSelect: () => {
            chooseQuickAdd(opt.key, navigate);
            onClose();
          },
        },
      });
    }

    for (const n of navTargets) {
      const score = scoreLabel(n.label);
      if (score === null) continue;
      entries.push({
        score,
        item: {
          id: `nav:${n.to}`,
          group: 'navigate',
          label: n.label,
          hint: n.hint,
          onSelect: () => selectNavTarget(n),
        },
      });
    }

    for (const { value: c, score } of matchCompanies(companies, q, ACCOUNT_RESULT_LIMIT)) {
      pushNavigable(
        score,
        {
          id: `account:${c.id}`,
          group: 'account',
          label: c.name,
          hint: accountSubtitle(c),
          leading: <CompanyLogo name={c.name} logo={c.logo} domain={c.domain} size={18} />,
        },
        `/accounts/${encodeURIComponent(c.id)}`,
        true,
      );
    }

    for (const { value: p, score } of matchContacts(
      contacts.data?.items ?? [],
      q,
      CONTACT_RESULT_LIMIT,
    )) {
      pushNavigable(
        score,
        { id: `contact:${p.id}`, group: 'contact', label: p.name, hint: contactSubtitle(p) },
        `/contacts?search=${encodeURIComponent(p.name)}`,
        true,
      );
    }

    for (const { value: task, score } of matchTasks(tasks.data?.items ?? [], q, TASK_RESULT_LIMIT)) {
      pushNavigable(
        score,
        { id: `task:${task.id}`, group: 'task', label: task.title, hint: taskSubtitle(task) },
        `/tasks?search=${encodeURIComponent(task.title)}`,
        true,
      );
    }

    // Server searches matched on fields we may not display — keep every row
    // (score-0 floor), but let label matches rank alongside local sources.
    for (const g of globalSearch.data?.items ?? []) {
      pushNavigable(
        q ? (fuzzyMatch(q, g.title)?.score ?? 0) : 0,
        { id: `search:${g.type}:${g.id}`, group: g.type, label: g.title, hint: g.subtitle },
        g.url,
        true,
      );
    }

    for (const o of oppSearch.data?.items ?? []) {
      const label = `${o.code} — ${o.name}`;
      pushNavigable(
        q ? (fuzzyMatch(q, label)?.score ?? 0) : 0,
        { id: `opp:${o.id}`, group: 'opportunity', label, hint: o.customer },
        `/opportunities/${o.id}`,
        true,
      );
    }

    // Rank by fuzzy + frecency (typed query only); wrap rows for recording.
    return finalizePaletteItems(entries, q, frecency);
  }, [
    query,
    companies,
    oppSearch.data,
    globalSearch.data,
    contacts.data?.items,
    tasks.data?.items,
    navigate,
    onClose,
    recents,
    accountRecents,
    selectNavTarget,
    contextualCommands,
    navTargets,
    quickAddOptions,
    frecency,
    t,
  ]);

  const findDirectNavTarget = useCallback(
    (q: string) => findDirectNavTargetIn(navTargets, q),
    [navTargets],
  );

  // Both server searches feed the merged items list, so loading must reflect
  // BOTH — reporting only oppSearch here made the palette flash "No matches."
  // whenever the opportunity search resolved empty while the global search
  // was still in flight (false negative on the app's main discovery surface).
  return {
    items,
    isFetching: oppSearch.isFetching || globalSearch.isFetching,
    selectNavTarget,
    findDirectNavTarget,
  };
}
