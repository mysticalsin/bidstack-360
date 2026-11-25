import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Liquid } from 'liquid-gooey';

import { chooseQuickAdd, type QuickAddEntity } from '@/components/quickadd/quickAddOptions';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

// A floating quick-actions button. Tapping "+" morphs three round actions out
// of it. On a phone this is the create control: there is no N key in the thumb
// zone. Opportunity and task open the same dialogs as the command palette.
// The third disc opens the company directory, so it is named Companies.
type QuickAction = {
  key: string;
  icon: IconName;
  label: string;
  y: number;
  entity?: QuickAddEntity;
  to?: string;
};

const FAB = 52; // px — keep in lockstep with --fab-size in index.css

export function LiquidQuickActions() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation('common');

  const actions: QuickAction[] = [
    {
      key: 'opp',
      icon: 'briefcase',
      entity: 'opportunity',
      label: t('quickActions.opportunity', 'New opportunity'),
      y: -186,
    },
    {
      key: 'acct',
      icon: 'building',
      to: '/companies',
      label: t('nav.companies', 'Companies'),
      y: -124,
    },
    {
      key: 'task',
      icon: 'tasks',
      entity: 'task',
      label: t('quickActions.task', 'New task'),
      y: -62,
    },
  ];

  const go = (action: QuickAction) => {
    setOpen(false);
    if (action.entity) {
      chooseQuickAdd(action.entity, navigate);
      return;
    }
    if (action.to) navigate(action.to);
  };

  return (
    <div
      className="fixed z-40 print:hidden"
      style={{
        width: FAB,
        height: FAB,
        /* Same 1.5rem inset as Tailwind bottom-6 / right-6, plus the
           home-indicator / notch safe area so the disc never sits on the
           pagination bar on a notched phone. */
        bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
        right: 'calc(1.5rem + env(safe-area-inset-right, 0px))',
      }}
      aria-hidden={undefined}
    >
      <Liquid blur={7} contrast={22} fill="var(--brand-primary)" shadow="0 10px 26px rgba(0,0,0,0.30)">
        {actions.map((a, i) => (
          <Liquid.Item
            key={a.key}
            x={0}
            y={open ? a.y : 0}
            transition="bouncy"
            delay={open ? i * 45 : (actions.length - 1 - i) * 30}
            style={{ position: 'absolute', bottom: 0, right: 0 }}
          >
            <button
              type="button"
              onClick={() => go(a)}
              aria-label={a.label}
              title={a.label}
              tabIndex={open ? 0 : -1}
              // Collapsed actions are invisible: keep them out of the a11y tree
              // too, so these names resolve to the visible page control.
              aria-hidden={open ? undefined : true}
              style={{
                width: FAB,
                height: FAB,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                opacity: open ? 1 : 0,
                pointerEvents: open ? 'auto' : 'none',
                transition: 'opacity .18s ease-out',
              }}
            >
              <Icon name={a.icon} size={18} ariaHidden />
            </button>
          </Liquid.Item>
        ))}

        <Liquid.Item x={0} y={0} style={{ position: 'absolute', bottom: 0, right: 0 }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? t('quickActions.close', 'Close quick actions') : t('quickActions.open', 'Quick actions')}
            style={{
              width: FAB,
              height: FAB,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                transform: open ? 'rotate(45deg)' : 'none',
                transition: 'transform .22s cubic-bezier(0.23, 1, 0.32, 1)',
              }}
            >
              <Icon name="plus" size={24} ariaHidden />
            </span>
          </button>
        </Liquid.Item>
      </Liquid>
    </div>
  );
}
