import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/ui/Avatar';
import { useHelpDrawer } from '@/components/help/useHelpDrawer';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { useSignOut, useUser, useRole } from '@/lib/auth';
import { useThemeStore } from '@/stores/theme';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useUiStore } from '@/stores/ui';
import { useOnboardingStore } from '@/stores/onboarding';
import { CurrencySelector } from './CurrencySelector';
import { SearchBar } from './topbar/TopbarSearch';
import { NotificationsBell } from './topbar/TopbarNotifications';

// Breadcrumb i18n keys by first-path segment. Nested routes inherit their parent.
const CRUMB_KEYS: Record<string, string> = {
  dashboard: 'topbar.portfolio',
  accounts: 'nav.accounts',
  opportunities: 'nav.opportunities',
  pipeline: 'nav.pipeline',
  contacts: 'nav.contacts',
  tasks: 'nav.tasks',
  reports: 'nav.reports',
  integrations: 'nav.integrations',
  'audit-log': 'nav.auditLog',
  settings: 'nav.settings',
  search: 'nav.search',
};

function useCrumbs(): { label: string; here: boolean }[] {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0];
  const portfolio = t('topbar.portfolio', 'Portfolio');
  if (!root) return [{ label: portfolio, here: true }];

  const rootLabel = CRUMB_KEYS[root] ? t(CRUMB_KEYS[root]) : capitalize(root);
  const second = segments[1];
  if (!second) {
    return [{ label: rootLabel, here: true }];
  }
  // Second segment is typically an id — show a generic "Detail" rather than
  // a raw UUID, until we wire per-record names through React Query cache.
  return [
    { label: rootLabel, here: false },
    { label: prettifySegment(second, t('topbar.detail', 'Detail')), here: true },
  ];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettifySegment(s: string, detailLabel: string): string {
  if (/^[0-9a-f-]{12,}$/i.test(s)) return detailLabel;
  return capitalize(s.replace(/-/g, ' '));
}

export function Topbar() {
  useDocumentTitle();
  const { t } = useTranslation('common');
  const crumbs = useCrumbs();
  const { theme, toggle } = useThemeStore();
  const themeLabel = t(theme === 'dark' ? 'topbar.switchToLight' : 'topbar.switchToDark', {
    defaultValue: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`,
  });
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
        {t('topbar.skipToContent', 'Skip to content')}
      </a>

      {/* Hamburger — visible only below md breakpoint where sidebar is hidden */}
      <button
        type="button"
        className="iconbtn md:!hidden"
        aria-label={t('nav.openNavigation', 'Open navigation')}
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

      <Tooltip content={themeLabel}>
        <button
          type="button"
          onClick={toggle}
          className="iconbtn relative overflow-hidden"
          aria-label={themeLabel}
          aria-pressed={theme === 'dark'}
        >
          <AnimatedThemeIcon theme={theme} />
        </button>
      </Tooltip>

      <NotificationsBell />

      <CurrencySelector />

      <Tooltip content={`${t('topbar.help', 'Help & shortcuts')} (?)`}>
        <button
          type="button"
          className="iconbtn tb-help-btn"
          aria-label={t('topbar.helpAria', 'Help and keyboard shortcuts')}
          onClick={() => openHelp(true)}
        >
          <Icon name="help" size={16} ariaHidden />
        </button>
      </Tooltip>

      <div className="tb-user" title={user?.primaryEmailAddress?.emailAddress ?? ''}>
        <Avatar seed={seed} size={32} decorative className="av" />
        <div className="who">
          <div className="name">{user?.fullName ?? t('app.guest', 'Guest')}</div>
          <div className="role">
            {role ? (
              <span className="mr-1.5 inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-1 py-0 text-[9px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                {role}
              </span>
            ) : null}
            {user?.primaryEmailAddress?.emailAddress ?? t('app.notSignedIn', 'Not signed in')}
          </div>
        </div>
        <Tooltip content={t('topbar.productTour', 'Take the product tour')}>
          <button
            type="button"
            onClick={startTour}
            className="tb-signout"
            aria-label={t('topbar.productTour', 'Take the product tour')}
            title={t('topbar.productTour', 'Take the product tour')}
          >
            <Icon name="play" size={14} ariaHidden />
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={() => signOut(() => navigate('/login'))}
          className="tb-signout"
          aria-label={t('topbar.signOut', 'Sign out')}
          title={t('topbar.signOut', 'Sign out')}
        >
          <Icon name="logOut" size={15} ariaHidden />
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
