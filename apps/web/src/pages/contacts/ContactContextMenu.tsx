/**
 * ContactContextMenu.tsx — Apple-style right-click context menu for a single contact.
 *
 * WHY separate from ContactsPage: the WAI-ARIA menu pattern (role=menu,
 * keyboard navigation, focus management) is self-contained and was responsible
 * for ~147 lines in the parent. Extracting it keeps ContactsPage focused on
 * data-fetching and page layout.
 *
 * WAI-ARIA Menu pattern (ARIA 1.2 §menu):
 *   - role="menu" on the <ul>, role="menuitem" on each <button>.
 *   - First item receives focus automatically on mount.
 *   - ArrowDown / ArrowUp moves focus between items (wraps around).
 *   - Home / End jumps to first / last item.
 *   - Tab / Shift+Tab closes the menu (WAI-ARIA menu-button pattern).
 *   - Escape closes via the document-level listener.
 *
 * Import DAG: zero local sibling imports — leaf node.
 */
import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { toast } from '@/components/ui/Toast';
import type { Contact } from '@bidstack/shared';

export function ContactContextMenu({
  x,
  y,
  contact,
  onClose,
  onEdit,
  onDelete,
}: {
  x: number;
  y: number;
  contact: Contact;
  onClose: () => void;
  onEdit: (c: Contact) => void;
  onDelete: (c: Contact) => void;
}) {
  const menuRef = useRef<HTMLUListElement>(null);

  // Move focus to the first menu item on mount so keyboard users don't have
  // to Tab into the menu manually.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>('[role=menuitem]');
    first?.focus();
  }, []);

  useEffect(() => {
    // `e instanceof KeyboardEvent` uses the global DOM constructor — not the
    // React type (which is aliased as ReactKeyboardEvent above).
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Clamp to viewport — assume a 220×200 menu, never let the click open a
  // menu that immediately falls off-screen.
  const MENU_W = 220;
  const MENU_H = 200;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`Copied ${label}`, { duration: 1500 }),
      () => toast.error('Copy failed'),
    );
    onClose();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const menuitems = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [],
    );
    if (menuitems.length === 0) return;
    const idx = menuitems.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      menuitems[(idx + 1) % menuitems.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      menuitems[(idx - 1 + menuitems.length) % menuitems.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      menuitems[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      menuitems[menuitems.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // Tab and Shift+Tab both close the menu per the WAI-ARIA menu-button
      // pattern — focus falls through to the next naturally focusable element.
      e.preventDefault();
      onClose();
    }
    // Escape is handled by the document-level keydown listener above.
  };

  return (
    <motion.ul
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${contact.name}`}
      onKeyDown={handleKeyDown}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      style={{ left, top }}
      className="fixed z-[200] w-[220px] overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] py-1 text-sm shadow-[var(--shadow-lg)]"
      // Catch clicks inside so the document-level mousedown doesn't close
      // the menu before the item's onClick fires.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ContextItem onClick={() => onEdit(contact)}>Edit contact</ContextItem>
      {contact.email ? (
        <ContextItem onClick={() => copy(contact.email!, 'email')}>Copy email</ContextItem>
      ) : null}
      {contact.phone ? (
        <ContextItem onClick={() => copy(contact.phone!, 'phone')}>Copy phone</ContextItem>
      ) : null}
      <ContextItem onClick={() => onDelete(contact)} tone="danger">
        Delete contact
      </ContextItem>
    </motion.ul>
  );
}

function ContextItem({
  onClick,
  tone,
  children,
}: {
  onClick: () => void;
  tone?: 'danger';
  children: ReactNode;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className={`flex w-full items-center px-3 py-1.5 text-left hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)] ${
          tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--fg-primary)]'
        }`}
      >
        {children}
      </button>
    </li>
  );
}
