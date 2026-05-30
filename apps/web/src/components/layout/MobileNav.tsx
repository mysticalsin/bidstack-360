// Mobile navigation drawer — full-screen overlay that replaces the sidebar
// on viewports below the md breakpoint. Opens via hamburger in the topbar
// and closes on link selection, backdrop tap, or Escape.

import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';

import { useUiStore } from '@/stores/ui';
import { useAccountHistory } from '@/stores/accountHistory';
import { useIsAdmin } from '@/lib/auth';
import { useOpportunityCount } from '@/hooks/useOpportunities';
import { useTaskSummary } from '@/hooks/useTasks';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { prefetchRoute } from '@/lib/prefetch';

import { ADMIN_SETTINGS, MEMBER_SETTINGS, NAV_SECTIONS, type NavItem } from './navConfig';

export function MobileNav() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);
  const reduced = useReducedMotion();

  // Lock body scroll while open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className="mobile-nav-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={reduced ? { duration: 0 } : { duration: 0.2 }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                id="mobile-nav-drawer"
                className="mobile-nav-drawer"
                initial={reduced ? { x: 0 } : { x: '-100%' }}
                animate={{ x: 0 }}
                exit={reduced ? { x: 0 } : { x: '-100%' }}
                transition={
                  reduced ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }
                }
              >
                <RadixDialog.Title className="sr-only">Primary navigation</RadixDialog.Title>
                <MobileNavContent onClose={() => setOpen(false)} />
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

function MobileNavContent({ onClose }: { onClose: () => void }) {
  const oppsCount = useOpportunityCount({ excludeClosed: true });
  const taskSummary = useTaskSummary();
  const isAdmin = useIsAdmin();
  const recents = useAccountHistory((s) => s.recents);
  const favorites = useAccountHistory((s) => s.favorites);

  const openBids = oppsCount.data?.count ?? 0;
  const overdueTasks = taskSummary.data?.overdue ?? 0;

  const badges = { openBids, overdueTasks };

  return (
    <div className="flex h-full flex-col">
      {/* Header with close */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="sb-mark" aria-hidden>
            B
          </div>
          <span className="font-semibold text-[var(--fg-primary)]">BidStack 360</span>
        </div>
        <button type="button" onClick={onClose} className="iconbtn" aria-label="Close navigation">
          <Icon name="close" size={18} ariaHidden />
        </button>
      </div>

      {/* Scrollable nav */}
      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_SECTIONS.map((section) => (
          <NavGroup key={section.key} title={section.title}>
            {section.items.map((item) => (
              <MobileNavItem key={item.to} item={item} badges={badges} onNavigate={onClose} />
            ))}
          </NavGroup>
        ))}

        {favorites.length > 0 && (
          <NavGroup title="Starred">
            {favorites.map((acc) => (
              <MobileAccountItem key={acc.slug} acc={acc} onNavigate={onClose} />
            ))}
          </NavGroup>
        )}

        {recents.length > 0 && (
          <NavGroup title="Recent">
            {recents.slice(0, 5).map((acc) => (
              <MobileAccountItem key={acc.slug} acc={acc} onNavigate={onClose} />
            ))}
          </NavGroup>
        )}

        <NavGroup title="Settings">
          {(isAdmin ? ADMIN_SETTINGS : MEMBER_SETTINGS).map((item) => (
            <MobileNavItem key={item.to} item={item} badges={badges} onNavigate={onClose} />
          ))}
        </NavGroup>
      </nav>
    </div>
  );
}

function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
        {title}
      </div>
      {children}
    </div>
  );
}

function MobileNavItem({
  item,
  badges,
  onNavigate,
}: {
  item: NavItem;
  badges: { openBids: number; overdueTasks: number };
  onNavigate: () => void;
}) {
  const badge = item.badgeKey ? badges[item.badgeKey] : 0;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-deep)]'
            : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
        )
      }
      end={item.end ?? item.to === '/'}
      onClick={onNavigate}
      onMouseEnter={() => prefetchRoute(item.to)}
    >
      <Icon name={item.icon} size={16} />
      <span className="flex-1">{item.label}</span>
      {badge > 0 && (
        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-semibold text-[var(--fg-tertiary)]">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function MobileAccountItem({
  acc,
  onNavigate,
}: {
  acc: { slug: string; name: string };
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={`/accounts/${acc.slug}`}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-[var(--brand-primary-tint)] text-[var(--brand-deep)]'
            : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]',
        )
      }
      onClick={onNavigate}
      onMouseEnter={() => prefetchRoute(`/accounts/${acc.slug}`)}
    >
      <Icon name="building" size={14} />
      <span className="flex-1 truncate">{acc.name}</span>
    </NavLink>
  );
}
