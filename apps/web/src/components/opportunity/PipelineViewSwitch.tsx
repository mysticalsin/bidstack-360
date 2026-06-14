// Segmented List / Board switch shared by the Opportunities (list) and Pipeline
// (board) views. They are one workspace over the same opportunity data, so the
// nav rail shows a single "Opportunities" entry and this toggle flips the
// layout. The active stage filter (pipelineStageId) is preserved across the
// switch because both views honour it.
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

export function PipelineViewSwitch({ current }: { current: 'list' | 'board' }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const go = (view: 'list' | 'board') => {
    if (view === current) return;
    const next = new URLSearchParams();
    const stage = params.get('pipelineStageId');
    if (stage) next.set('pipelineStageId', stage);
    const qs = next.toString();
    navigate(`${view === 'list' ? '/opportunities' : '/pipeline'}${qs ? `?${qs}` : ''}`);
  };

  const tab = (view: 'list' | 'board') =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]',
      current === view
        ? 'bg-[var(--surface-card)] text-[var(--fg-primary)] shadow-[var(--shadow-sm)]'
        : 'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
    );

  return (
    <div
      role="tablist"
      aria-label="Opportunity view"
      className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={current === 'list'}
        onClick={() => go('list')}
        className={tab('list')}
      >
        <Icon name="list" size={14} ariaHidden /> List
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={current === 'board'}
        onClick={() => go('board')}
        className={tab('board')}
      >
        <Icon name="pipeline" size={14} ariaHidden /> Board
      </button>
    </div>
  );
}
