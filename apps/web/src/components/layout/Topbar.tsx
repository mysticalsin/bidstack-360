import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, useRef, useEffect, useLayoutEffect, type FormEvent } from 'react';
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
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const reduced = useReducedMotion();

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  // WHY useLayoutEffect: resets keyboard-nav highlight before the next paint.
  // setState-in-effect is intentional — pure React UI state, no external
  // system.
  useLayoutEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHighlightedIndex(-1);
    }
  }, [open]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || query || recents.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % recents.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + recents.length) % recents.length);
        break;
      case 'Enter':
        if (highlightedIndex >= 0 && highlightedIndex < recents.length) {
          e.preventDefault();
          const q = recents[highlightedIndex];
          if (q) {
            runSearch(q);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
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
        onKeyDown={handleKeyDown}
        // Delay the close so a click on a dropdown item lands before the
        // dropdown unmounts. 150ms is the standard browser delay.
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
        }}
      />
      <kbd aria-hidden>Ctrl+/</kbd>
      <AnimatePresence>
        {open && !query && recents.length > 0 && (
          <motion.div
            role="listbox"
            aria-label="Recent searches"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-lg glass-menu p-1.5 focus:outline-none"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2.5 py-1.5 mb-1 text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              <span>Recent</span>
              <button
                type="button"
                onMouseDown={(e) => {
                  // Use mousedown not click so it fires before the input's
                  // blur tears the dropdown down.
                  e.preventDefault();
                  clearRecents();
                }}
                className="text-[10px] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded px-1 py-0.5"
              >
                Clear
              </button>
            </div>
            <ul className="flex flex-col gap-0.5">
              {recents.map((r, index) => {
                const isHighlighted = index === highlightedIndex;
                return (
                  <li key={r}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        runSearch(r);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className="relative block w-full px-2.5 py-1.5 text-left text-sm text-[var(--fg-primary)] bg-transparent focus-visible:outline-none rounded-md cursor-pointer"
                    >
                      {isHighlighted && (
                        <motion.div
                          layoutId="recent-search-highlight"
                          className="absolute inset-0 bg-[var(--surface-hover)] rounded-md -z-10"
                          transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10">{r}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
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
  const reduced = useReducedMotion();

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

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-[calc(100%+6px)] z-30 w-80 rounded-lg glass-menu p-1.5 focus:outline-none"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2 mb-1">
              <span className="text-sm font-semibold text-[var(--fg-primary)]">Mentions</span>
              {unreadCount > 0 && (
                <span className="text-xs text-[var(--fg-tertiary)]">{unreadCount} unread</span>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto flex flex-col gap-0.5">
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
                    className="flex items-start gap-3 border-b border-[var(--border-subtle)] last:border-0 rounded-md px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
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
                      className="shrink-0 text-xs text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:underline"
                      onClick={() => markRead.mutate(m.id)}
                    >
                      Mark read
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-[var(--border-subtle)] mt-1 px-3 py-2 flex justify-start">
              <Link
                to="/tasks"
                className="text-xs text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:underline"
                onClick={() => setOpen(false)}
              >
                View all mentions
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
