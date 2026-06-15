// Bottom-left pill that surfaces when the browser reports offline.
// Spring-slides in/out; respects prefers-reduced-motion. Mirrors the
// macOS "no network" banner — non-intrusive, but always visible while
// disconnected so users don't blame the app for failed saves.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { springModal } from '@/lib/motion';

export function OfflineIndicator() {
  const { online } = useOnlineStatus();
  const reduced = useReducedMotion();
  const { t } = useTranslation('crm');

  return (
    <AnimatePresence>
      {!online ? (
        <motion.div
          role="status"
          aria-live="assertive"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={springModal}
          className="pointer-events-auto fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--fg-primary)] shadow-[var(--shadow-md)]"
        >
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--danger)]" />
          <span className="font-medium">{t('offlineIndicator.statusLabel', 'Offline')}</span>
          <span className="text-[var(--fg-tertiary)]">
            {t('offlineIndicator.retryMessage', '— saves will retry when you reconnect')}
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
