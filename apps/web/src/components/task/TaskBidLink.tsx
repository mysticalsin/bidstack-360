import { Link } from 'react-router-dom';

import { cn } from '@/lib/cn';

import { taskBidLabel } from './task-bid-link';

// Brand-primary is the light-theme link color (6.53:1 on white). In dark mode
// that token is a fill (3.95:1 on the page) and brand-deep is the foreground
// accent (8.38:1 on near-black). The underline uses the same color.
const BID_LINK_CLASS =
  'font-medium text-[var(--brand-primary)] underline decoration-current underline-offset-2 rounded-sm hover:decoration-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] dark:text-[var(--brand-deep)] dark:hover:decoration-[var(--brand-deep)]';

export function TaskBidLink({
  task,
  fallback,
  className,
}: {
  task: { oppId: string | null; opportunityName?: string | null };
  /** Used when the follow-up has a bid but the name did not arrive. */
  fallback?: string;
  className?: string;
}) {
  if (!task.oppId) return null;
  const label = taskBidLabel(task) ?? fallback?.trim() ?? '';
  if (!label) return null;
  return (
    <Link to={`/opportunities/${task.oppId}`} className={cn(BID_LINK_CLASS, className)}>
      {label}
    </Link>
  );
}
