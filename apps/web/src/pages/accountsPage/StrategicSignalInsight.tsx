import { Icon } from '@/components/ui/Icon';

import type { StrategicSignal } from './strategicSignals';

export function StrategicSignalInsight({
  signal,
  label,
  compact = false,
  className,
}: {
  signal: StrategicSignal;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  const isComplete = signal.status === 'complete';
  const classes = [
    'strategic-signal-insight',
    isComplete ? 'is-complete' : '',
    compact ? 'is-compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      aria-label={`${label}: ${signal.reason} Next: ${signal.nextAction}`}
    >
      <Icon name={isComplete ? 'checkCircle' : 'info'} size={14} ariaHidden />
      <span>{`${signal.reason} `}</span>
      <strong>{`Next: ${signal.nextAction}`}</strong>
    </div>
  );
}
