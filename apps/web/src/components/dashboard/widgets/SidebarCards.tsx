/**
 * dashboard/widgets/SidebarCards.tsx — QuickActionsCard and QuickLinksCard,
 * two small sidebar-only widgets that share the same static-link-grid pattern.
 *
 * WHY co-located: both cards are under 35 source lines each, both are sidebar-
 * only, and both render a fixed icon-link grid. A shared file avoids two tiny
 * single-component files while keeping OrgDashboard clean.
 */
import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';

import { type KpiTone, TONE_FG, TONE_GLOW } from './dashboard-types';

// ─── QuickActionsCard ────────────────────────────────────────────────────────

const QUICK_ACTIONS: Array<{ id: string; label: string; href: string; icon: string; tone: KpiTone }> = [
  { id: 'newLead', label: 'New lead', href: '/leads/new', icon: 'user-plus', tone: 'purple' },
  { id: 'openTasks', label: 'Open tasks', href: '/tasks', icon: 'plus-circle', tone: 'teal' },
  { id: 'contacts', label: 'Contacts', href: '/contacts', icon: 'phone', tone: 'blue' },
  { id: 'companies', label: 'Companies', href: '/companies', icon: 'building', tone: 'amber' },
];

export function QuickActionsCard() {
  const { t } = useTranslation('crm');
  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        {t('sidebarCards.quickActionsHeading', 'Quick actions')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            to={action.href}
            className="quick-action-btn"
            style={{ '--action-glow': TONE_GLOW[action.tone] } as CSSProperties}
          >
            <Icon name={action.icon} size={14} style={{ color: TONE_FG[action.tone] }} />
            <span>{t(`sidebarCards.action.${action.id}`, action.label)}</span>
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── QuickLinksCard ──────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { id: 'pipeline', label: 'Pipeline', href: '/pipeline', icon: 'briefcase' },
  { id: 'reports', label: 'Reports', href: '/reports/list', icon: 'reports' },
  { id: 'tasks', label: 'Tasks', href: '/tasks', icon: 'tasks' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
];

export function QuickLinksCard() {
  const { t } = useTranslation('crm');
  return (
    <GlassCard padding="sm" hoverable={false}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)] px-1 pt-1 pb-2">
        {t('sidebarCards.quickLinksHeading', 'Quick links')}
      </div>
      <div className="grid grid-cols-2 gap-1">
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.href}
            to={l.href}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] transition-colors"
            style={{ textDecoration: 'none' }}
          >
            <Icon name={l.icon} size={14} />
            {t(`sidebarCards.link.${l.id}`, l.label)}
          </Link>
        ))}
      </div>
    </GlassCard>
  );
}
