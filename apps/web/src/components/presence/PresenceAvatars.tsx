// PresenceAvatars — "who's in this bid" (A3).
//
// Stacked avatar cluster for the other users currently viewing the same
// opportunity/bid. Mount directly on a detail-page header:
//   <PresenceAvatars entityType="opportunity" entityId={data.id} />
//
// Empty state is ABSENCE, not a zero badge — a lone viewer sees nothing here,
// matching the spec ("renders NOTHING when alone"). Self is filtered twice:
// once server-side/hook-side (usePresence never includes the caller in its
// response) and again here defensively — seeing yourself listed as a
// "collaborator" undermines trust in the whole signal, so this stays
// filtered even if a future caller feeds it a raw, unfiltered viewer list.
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { usePresence } from '@/hooks/usePresence';
import { useUser } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { easeStandard, easeAccel } from '@/lib/motion';

const AVATAR_SIZE = 28;
const DEFAULT_MAX = 4;

export interface PresenceAvatarsProps {
  entityType: string;
  entityId: string | undefined;
  /** Max avatars shown before collapsing into a "+N" overflow badge. */
  max?: number;
  className?: string;
}

export function PresenceAvatars({
  entityType,
  entityId,
  max = DEFAULT_MAX,
  className,
}: PresenceAvatarsProps) {
  const { t } = useTranslation('common');
  const { user } = useUser();
  const reduced = useReducedMotion();
  const { viewers } = usePresence(entityType, entityId);

  // Defensive self-exclusion — see file header WHY.
  const others = viewers.filter((v) => v.userId !== user?.id);
  if (others.length === 0) return null;

  const shown = others.slice(0, max);
  const overflow = others.length - shown.length;

  return (
    <div
      data-testid="avatar-stack"
      role="group"
      aria-label={
        others.length === 1
          ? t('presence.viewingLabelOne', '1 person viewing')
          : t('presence.viewingLabel', '{{count}} people viewing', { count: others.length })
      }
      className={cn('flex items-center -space-x-2', className)}
    >
      <AnimatePresence initial={false}>
        {shown.map((viewer) => (
          <motion.span
            key={viewer.userId}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            transition={reduced ? { duration: 0.12 } : easeStandard}
            className="rounded-full ring-2 ring-[var(--surface-card)]"
          >
            <Tooltip content={viewer.userName ?? t('presence.anonymousViewer', 'Teammate')}>
              {/* Radix's asChild trigger clones its child and injects a ref — Avatar
                  is a plain function component (no forwardRef), so it must be wrapped
                  in a native element rather than passed directly as the trigger child. */}
              <span className="inline-flex">
                <Avatar seed={viewer.userName ?? viewer.userId} size={AVATAR_SIZE} />
              </span>
            </Tooltip>
          </motion.span>
        ))}
      </AnimatePresence>
      {overflow > 0 && (
        <motion.span
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? { duration: 0.12 } : easeAccel}
          aria-hidden="true"
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
          className="flex items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[10px] font-semibold text-[var(--fg-secondary)] ring-2 ring-[var(--surface-card)]"
        >
          +{overflow}
        </motion.span>
      )}
    </div>
  );
}
