// Topbar notifications bell with unread-mention dropdown.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { useMentionSummary, useMentions, useMarkMentionRead } from '@/hooks/useMentions';

export function NotificationsBell() {
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
                    data-testid="notification-item"
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
