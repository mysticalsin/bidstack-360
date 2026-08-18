import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Liquid } from 'liquid-gooey';

import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

// A floating quick-actions button. Tapping the "+" morphs three round actions
// out of it with a liquid/gooey merge (liquid-gooey) — the fastest way to start
// the three core moves (new account / opportunity / task) from anywhere.
type QuickAction = { key: string; icon: IconName; to: string; label: string; y: number };

const FAB = 52; // px — the round button diameter

export function LiquidQuickActions() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation('common');

  const actions: QuickAction[] = [
    { key: 'opp', icon: 'briefcase', to: '/opportunities', label: t('quickActions.opportunity', 'New opportunity'), y: -186 },
    { key: 'acct', icon: 'building', to: '/companies', label: t('quickActions.account', 'New account'), y: -124 },
    { key: 'task', icon: 'tasks', to: '/tasks', label: t('quickActions.task', 'New task'), y: -62 },
  ];

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div
      className="fixed bottom-6 right-6 z-40 print:hidden"
      style={{ width: FAB, height: FAB }}
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
              onClick={() => go(a.to)}
              aria-label={a.label}
              title={a.label}
              tabIndex={open ? 0 : -1}
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
