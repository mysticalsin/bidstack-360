import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';

import { Avatar } from '@/components/ui/Avatar';
import { useHelpDrawer } from '@/components/help/useHelpDrawer';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { useSignOut, useUser, useRole } from '@/lib/auth';
import { useThemeStore } from '@/stores/theme';
import { useRecentSearches } from '@/stores/recentSearches';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useMentionSummary, useMentions, useMarkMentionRead } from '@/hooks/useMentions';
import { useUiStore } from '@/stores/ui';
import { useOnboardingStore } from '@/stores/onboarding';
import { CurrencySelector } from './CurrencySelector';

// Breadcrumb labels by first-path segment. Nested routes inherit their parent.
const CRUMB_LABELS: Record<string, string> = {
  dashboard: 'Portfolio',
  accounts: 'Accounts',
  opportunities: 'Opportunities',
  pipeline: 'Pipeline',
  contacts: 'Contacts',
  tasks: 'Tasks',
  reports: 'Reports',
  integrations: 'Integrations',
  'audit-log': 'Audit log',
  settings: 'Settings',
  search: 'Search',
};

function useCrumbs(): { label: string; here: boolean }[] {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0];
  if (!root) return [{ label: 'Portfolio', here: true }];

  const rootLabel = CRUMB_LABELS[root] ?? capitalize(root);
  const second = segments[1];
  if (!second) {
    return [{ label: rootLabel, here: true }];
  }
  // Second segment is typically an id — show a generic "Detail" rather than
  // a raw UUID, until we wire per-record names through React Query cache.
  return [
    { label: rootLabel, here: false },
    { label: prettifySegment(second), here: true },
  ];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettifySegment(s: string): string {
  if (/^[0-9a-f-]{12,}$/i.test(s)) return 'Detail';
  return capitalize(s.replace(/-/g, ' '));
}

export function Topbar() {
  useDocumentTitle();
  const crumbs = useCrumbs();
  const { theme, toggle } = useThemeStore();
  const { user } = useUser();
  const { signOut } = useSignOut();
  const navigate = useNavigate();
  const { role } = useRole();
  const openHelp = useHelpDrawer((s) => s.setOpen);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const toggleMobileNav = useUiStore((s) => s.toggleMobileNav);
  const startTour = useOnboardingStore((s) => s.startTour);

  const seed = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Guest';

  return (
    <header className="topbar" role="banner">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Hamburger — visible only below md breakpoint where sidebar is hidden */}
      <button
        type="button"
        className="iconbtn md:hidden"
        aria-label="Open navigation"
        aria-controls="mobile-nav-drawer"
        aria-expanded={mobileNavOpen}
        onClick={toggleMobileNav}
      >
        <Icon name="menu" size={18} ariaHidden />
      </button>

      <nav aria-label="Breadcrumb" className="crumbs">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="crumbs-seg">
            {i > 0 && (
              <span className="sep" aria-hidden>
                /
              </span>
            )}
            <span
              className={c.here ? 'here' : undefined}
              aria-current={c.here ? 'page' : undefined}
            >
              {c.label}
            </span>
          </span>
        ))}
      </nav>

      <div className="tb-spacer" />

      <SearchBar />

      <Tooltip content={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        <button
          type="button"
          onClick={toggle}
          className="iconbtn relative overflow-hidden"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-pressed={theme === 'dark'}
        >
          <AnimatedThemeIcon theme={theme} />
        </button>
      </Tooltip>

      <NotificationsBell />

      <CurrencySelector />

      <Tooltip content="Help & shortcuts (?)">
        <button
          type="button"
          className="iconbtn tb-help-btn"
          aria-label="Help and keyboard shortcuts"
          onClick={() => openHelp(true)}
        >
          <Icon name="help" size={16} ariaHidden />
        </button>
      </Tooltip>

      <div className="tb-user" title={user?.primaryEmailAddress?.emailAddress ?? ''}>
        <Avatar seed={seed} size={32} decorative className="av" />
        <div className="who">
          <div className="name">{user?.fullName ?? 'Guest'}</div>
          <div className="role">
            {role ? (
              <span className="mr-1.5 inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-1 py-0 text-[9px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {role}
              </span>
            ) : null}
            {user?.primaryEmailAddress?.emailAddress ?? 'Not signed in'}
          </div>
        </div>
        <Tooltip content="Take the product tour">
          <button
            type="button"
            onClick={startTour}
            className="tb-signout"
            aria-label="Take product tour"
            title="Take product tour"
          >
            <Icon name="play" size={14} ariaHidden />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={() => signOut(() => navigate('/login'))}
          className="tb-signout"
          aria-label="Sign out"
          title="Sign out"
        >
          ↩
        </button>
      </div>
    </header>
  );
}

// macOS Control-Center-style rotate-and-fade between sun and moon. The
// outgoing glyph rotates out while the incoming rotates in from the
// opposite direction; a slight scale on entry gives the "click landed"
// haptic. Reduced-motion users get a plain crossfade.
function AnimatedThemeIcon({ theme }: { theme: 'light' | 'dark' }) {
  const reduced = useReducedMotion();
  return (
    <span aria-hidden className="relative inline-flex h-4 w-4 items-center justify-center">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={theme}
          initial={reduced ? { opacity: 0 } : { opacity: 0, rotate: -90, scale: 0.6 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          className="absolute inset-0 inline-flex items-center justify-center"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} ariaHidden />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function SearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recents = useRecentSearches((s) => s.items);
  const pushRecent = useRecentSearches((s) => s.push);
  const clearRecents = useRecentSearches((s) => s.clear);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  const runSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    setQuery(trimmed);
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  return (
    <form onSubmit={onSubmit} className="tb-search relative" role="search">
      <Icon name="search" size={14} ariaHidden />
      <label htmlFor="tb-search-input" className="sr-only">
        Search opportunities, contacts, tasks
      </label>
      <input
        id="tb-search-input"
        type="search"
        placeholder="Search or jump to…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        // Delay the close so a click on a dropdown item lands before the
        // dropdown unmounts. 150ms is the standard browser delay.
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
        }}
      />
      <kbd aria-hidden>Ctrl+/</kbd>
      {open && !query && recents.length > 0 ? (
        <div
          role="listbox"
          aria-label="Recent searches"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-md)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
            <span>Recent</span>
            <button
              type="button"
              onMouseDown={(e) => {
                // Use mousedown not click so it fires before the input's
                // blur tears the dropdown down.
                e.preventDefault();
                clearRecents();
              }}
              className="text-[10px] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded"
            >
              Clear
            </button>
          </div>
          <ul>
            {recents.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runSearch(r);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-primary)]"
                >
                  {r}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mentionSummary = useMentionSummary();
  const mentions = useMentions(true, { enabled: open });
  const markRead = useMarkMentionRead();
  const unreadCount = mentionSummary.data?.unread ?? mentions.data?.items.length ?? 0;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <Tooltip
        content={
          unreadCount > 0
            ? `${unreadCount} unread mention${unreadCount !== 1 ? 's' : ''}`
            : 'Notifications'
        }
      >
        <button
          type="button"
          className="iconbtn relative"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="bell" size={16} ariaHidden />
          {unreadCount > 0 && (
            <span className="absolute right-0 top-0 flex h-4 min-w-4 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-80 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
            <span className="text-sm font-semibold text-[var(--fg-primary)]">Mentions</span>
            {unreadCount > 0 && (
              <span className="text-xs text-[var(--fg-tertiary)]">{unreadCount} unread</span>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {mentions.isError ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--danger)]">
                Could not load mentions
              </div>
            ) : mentions.isLoading ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--fg-secondary)]">
                Loading…
              </div>
            ) : unreadCount === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--fg-secondary)]">
                No unread mentions
              </div>
            ) : (
              mentions.data?.items.map((m) => (
                <div
                  key={m.id}
                  role="menuitem"
                  className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-0 hover:bg-[var(--surface-hover)]"
                >
                  <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--brand-primary)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--fg-primary)]">
                      Someone mentioned you in a comment
                    </p>
                    <p className="text-xs text-[var(--fg-tertiary)]">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-[var(--brand-primary)] hover:underline"
                    onClick={() => markRead.mutate(m.id)}
                  >
                    Mark read
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-[var(--border-subtle)] px-4 py-2">
            <Link
              to="/tasks"
              className="text-xs text-[var(--brand-primary)] hover:underline"
              onClick={() => setOpen(false)}
            >
              View all mentions
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
