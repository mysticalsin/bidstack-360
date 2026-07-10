import { Check, Play, RotateCcw, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { CrossSellAction, GovernanceStatus } from '@bidstack/shared';

type CommandConfig = {
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  hint: string;
  nextStatus: GovernanceStatus;
  variant: 'secondary' | 'success' | 'ghost';
};

const STATUS_TONE: Record<GovernanceStatus, 'gray' | 'amber' | 'jade'> = {
  open: 'gray',
  in_progress: 'amber',
  done: 'jade',
};

type CrossSellStatusControlsProps = {
  action: Pick<CrossSellAction, 'id' | 'status' | 'description'>;
  canWrite: boolean;
  isBusy?: boolean;
  disabled?: boolean;
  align?: 'start' | 'end';
  className?: string;
  onStatusChange: (status: GovernanceStatus) => void;
};

export function CrossSellStatusControls({
  action,
  canWrite,
  isBusy = false,
  disabled = false,
  align = 'start',
  className,
  onStatusChange,
}: CrossSellStatusControlsProps) {
  const { t } = useTranslation('crm');
  const command = commandForStatus(action.status, action.description, t);
  const blocked = disabled || !canWrite;
  const Icon = command.icon;

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        align === 'end' ? 'items-end text-right' : 'items-start text-left',
        className,
      )}
      data-testid={`cross-sell-${action.id}-workflow`}
    >
      <Badge tone={STATUS_TONE[action.status]} data-testid={`cross-sell-${action.id}-status-badge`}>
        {statusLabel(action.status, t)}
      </Badge>
      <Button
        type="button"
        variant={command.variant}
        size="sm"
        disabled={blocked || isBusy}
        aria-busy={isBusy}
        aria-label={command.ariaLabel}
        title={
          canWrite
            ? command.hint
            : t(
                'crossSell.readOnlyStatusHint',
                'You need account write permission to change status',
              )
        }
        onClick={() => onStatusChange(command.nextStatus)}
        className="min-h-11 min-w-11 px-3"
        data-testid={`cross-sell-${action.id}-status`}
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
        <span>{isBusy ? t('crossSell.updating', 'updating...') : command.label}</span>
      </Button>
    </div>
  );
}

function statusLabel(
  status: GovernanceStatus,
  t: ReturnType<typeof useTranslation<'crm'>>['t'],
): string {
  switch (status) {
    case 'open':
      return t('crossSell.status.open', 'Open');
    case 'in_progress':
      return t('crossSell.status.inProgress', 'In progress');
    case 'done':
      return t('crossSell.status.done', 'Done');
    default:
      return status;
  }
}

function commandForStatus(
  status: GovernanceStatus,
  description: string,
  t: ReturnType<typeof useTranslation<'crm'>>['t'],
): CommandConfig {
  switch (status) {
    case 'open':
      return {
        icon: Play,
        label: t('crossSell.command.start', 'Start'),
        ariaLabel: t('crossSell.command.startAria', 'Start cross-sell action {{description}}', {
          description,
        }),
        hint: t('crossSell.command.startHint', 'Move this action to in progress'),
        nextStatus: 'in_progress',
        variant: 'secondary',
      };
    case 'in_progress':
      return {
        icon: Check,
        label: t('crossSell.command.markDone', 'Mark done'),
        ariaLabel: t(
          'crossSell.command.markDoneAria',
          'Mark done cross-sell action {{description}}',
          {
            description,
          },
        ),
        hint: t('crossSell.command.markDoneHint', 'Close this action as completed'),
        nextStatus: 'done',
        variant: 'success',
      };
    case 'done':
      return {
        icon: RotateCcw,
        label: t('crossSell.command.reopen', 'Reopen'),
        ariaLabel: t('crossSell.command.reopenAria', 'Reopen cross-sell action {{description}}', {
          description,
        }),
        hint: t('crossSell.command.reopenHint', 'Move this completed action back to open'),
        nextStatus: 'open',
        variant: 'ghost',
      };
    default:
      return {
        icon: Play,
        label: t('crossSell.command.start', 'Start'),
        ariaLabel: t('crossSell.command.startAria', 'Start cross-sell action {{description}}', {
          description,
        }),
        hint: t('crossSell.command.startHint', 'Move this action to in progress'),
        nextStatus: 'in_progress',
        variant: 'secondary',
      };
  }
}
