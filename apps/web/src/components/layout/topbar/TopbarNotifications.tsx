// Topbar notification center — unified feed of mentions, assignments, bid
// overrides and system events. Click a row to open the linked entity (and mark
// it read); "Mark all read" clears the unread badge in one shot.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { relativeTime } from '@/lib/format';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type NotificationType,
} from '@/hooks/useNotifications';

const TYPE_ICON: Record<NotificationType, IconName> = {
  mention: 'messageCircle',
  assignment: 'target',
  bid_override: 'shield',
  stage_change: 'growth',
  system: 'info',
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // Always poll for the badge; only fetch eagerly while the tray is open is
  // unnecessary since the list is small (top 30) and cheap.
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = notifications.data?.items ?? [];
  const unreadCount = notifications.data?.unread ?? 0;
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

  function openItem(id: string, url: string | null, read: boolean) {
    if (!read) markRead.mutate(id);
    if (url) {
      navigate(url);
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <Tooltip
        content={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
            : 'Notifications'
        }
      >
        <button
          type="button"
          className="iconbtn relative"
          data-testid="notification-bell"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="bell" size={16} ariaHidden />
          {unreadCount > 0 && (
            <span
              className="absolute right-0 top-0 flex h-4 min-w-4 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white"
              data-testid="notification-badge"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </Tooltip>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            data-testid="notification-tray"
            aria-label="Notifications"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-[calc(100%+6px)] z-30 w-80 rounded-lg glass-menu p-1.5 focus:outline-none"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2 mb-1">
              <span className="text-sm font-semibold text-[var(--fg-primary)]">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="text-xs text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:underline disabled:opacity-50"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto flex flex-col gap-0.5">
              {notifications.isError ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--danger)]">
                  Could not load notifications
                </div>
              ) : notifications.isLoading ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--fg-secondary)]">
                  Loading…
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--fg-secondary)]">
                  You&rsquo;re all caught up
                </div>
              ) : (
                items.map((n) => {
                  const isRead = n.readAt !== null;
                  const clickable = n.url !== null;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      role="menuitem"
                      data-testid="notification-item"
                      aria-label={n.title}
                      onClick={() => openItem(n.id, n.url, isRead)}
                      className={`flex w-full items-start gap-3 border-b border-[var(--border-subtle)] last:border-0 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--surface-hover)] ${
                        clickable ? '' : 'cursor-default'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          isRead
                            ? 'bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]'
                            : 'bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                        }`}
                      >
                        <Icon name={TYPE_ICON[n.type]} size={13} ariaHidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm ${
                            isRead
                              ? 'text-[var(--fg-secondary)]'
                              : 'font-medium text-[var(--fg-primary)]'
                          }`}
                        >
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block truncate text-xs text-[var(--fg-tertiary)]">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-0.5 block text-[11px] text-[var(--fg-tertiary)]">
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                      {!isRead && (
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--brand-primary)]"
                          aria-hidden
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
