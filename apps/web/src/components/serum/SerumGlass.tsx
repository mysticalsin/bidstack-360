import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';

import type { SerumModuleStatus, SerumSignalStatus, SerumStatusCard } from '@bidstack/shared';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { springSnap } from '@/lib/motion';

const STATUS_TONE: Record<SerumSignalStatus, BadgeTone> = {
  ready: 'jade',
  active: 'blue',
  attention: 'amber',
  blocked: 'tomato',
  disabled: 'gray',
  empty: 'gray',
  not_configured: 'purple',
  error: 'tomato',
};

const STATUS_LABEL: Record<SerumSignalStatus, string> = {
  ready: 'Ready',
  active: 'Active',
  attention: 'Attention',
  blocked: 'Blocked',
  disabled: 'Disabled',
  empty: 'Empty',
  not_configured: 'Not configured',
  error: 'Error',
};

const STATUS_ICON: Record<SerumSignalStatus, IconName> = {
  ready: 'checkCircle',
  active: 'loader',
  attention: 'warning',
  blocked: 'warning',
  disabled: 'pause',
  empty: 'info',
  not_configured: 'settings',
  error: 'warning',
};

export function SerumStatusPill({ status }: { status: SerumSignalStatus }) {
  const { t } = useTranslation('crm');
  return (
    <Badge tone={STATUS_TONE[status]} className="capitalize">
      <Icon name={STATUS_ICON[status]} size={12} ariaHidden />
      {t(`crm.serumStatus.${status}`, STATUS_LABEL[status])}
    </Badge>
  );
}

export function SerumPanel({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={reduced ? undefined : { opacity: 1, y: 0 }}
      transition={{ ...springSnap, delay }}
      className={cn(
        'rounded-2xl border border-[var(--serum-border)] bg-[var(--serum-surface)] p-5 shadow-[var(--serum-shadow-sm)] backdrop-blur-xl',
        className,
      )}
    >
      {children}
    </motion.section>
  );
}

export function SerumMetricCard({ card, icon = 'dashboard' }: { card: SerumStatusCard; icon?: IconName }) {
  const content = (
    <SerumPanel className="h-full p-4 transition-transform hover:-translate-y-0.5" delay={0.02}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--serum-surface-soft)] text-[var(--serum-blue)]">
          <Icon name={icon} size={18} ariaHidden />
        </div>
        <SerumStatusPill status={card.status} />
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
          {card.title}
        </p>
        <div className="mt-2 text-3xl font-semibold tracking-tight text-[var(--fg-primary)]">
          {card.value}
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">{card.detail}</p>
      </div>
    </SerumPanel>
  );

  return card.href ? (
    <Link to={card.href} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]">
      {content}
    </Link>
  ) : (
    content
  );
}

export function SerumCommandBar({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useTranslation('crm');
  return (
    <SerumGlassToolbar>
      <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing}>
        <Icon name="refresh" size={15} ariaHidden />
        {t('crm.serumCommandBar.refresh', 'Refresh')}
      </Button>
      <SerumLinkButton to="/settings?tab=serum" icon="settings">
        {t('crm.serumCommandBar.settings', 'Settings')}
      </SerumLinkButton>
      <Button
        variant="ghost"
        size="sm"
        disabled
        title={t('crm.serumCommandBar.askDisabledTitle', 'Ask Polo PreSales requires registry-backed tools')}
      >
        <Icon name="sparkle" size={15} ariaHidden />
        {t('crm.serumCommandBar.ask', 'Ask Polo PreSales')}
      </Button>
    </SerumGlassToolbar>
  );
}

export function SerumGlassToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--serum-border)] bg-[var(--serum-surface)] p-2 shadow-[var(--serum-shadow-sm)] backdrop-blur-xl">
      {children}
    </div>
  );
}

export function SerumEmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-6 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--serum-surface-solid)] text-[var(--serum-blue)] shadow-[var(--serum-shadow-sm)]">
        <Icon name="info" size={18} ariaHidden />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--fg-secondary)]">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function serumErrorCopy(error: unknown, t: TFunction): { title: string; detail: string } {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        title: t('crm.serumError.unauthorized.title', 'SERUM session needs a refresh'),
        detail: t(
          'crm.serumError.unauthorized.detail',
          'Your session token was rejected after retry. Refresh the status; if it repeats, sign in again so Clerk can issue a clean session.',
        ),
      };
    }
    if (error.status === 403) {
      return {
        title: t('crm.serumError.forbidden.title', 'SERUM access is restricted'),
        detail: t(
          'crm.serumError.forbidden.detail',
          'This control plane requires the settings:read permission. Ask an admin to update your role or switch to an authorized workspace.',
        ),
      };
    }
    if (error.status === 404) {
      return {
        title: t('crm.serumError.notFound.title', 'SERUM endpoint was not found'),
        detail: t(
          'crm.serumError.notFound.detail',
          'The web app is not reaching the versioned SERUM API endpoint. Refresh to load the newest app shell or check the API base URL.',
        ),
      };
    }
    if (error.status >= 500) {
      return {
        title: t('crm.serumError.server.title', 'SERUM backend is unhealthy'),
        detail: t(
          'crm.serumError.server.detail',
          'The control plane route responded with a server error. Retry once, then check API health and backend logs.',
        ),
      };
    }
  }

  return {
    title: t('crm.serumError.generic.title', 'SERUM status is unavailable'),
    detail: t(
      'crm.serumError.generic.detail',
      'The control plane could not read backend signals. Refresh or check API health.',
    ),
  };
}

export function SerumErrorState({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  const { t } = useTranslation('crm');
  const copy = serumErrorCopy(error, t);
  return (
    <SerumPanel className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--danger-tint)] text-[var(--danger)]">
            <Icon name="warning" size={18} ariaHidden />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{copy.title}</h3>
            <p className="mt-1 text-sm text-[var(--fg-secondary)]">
              {copy.detail}
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={onRetry}>
          <Icon name="refresh" size={15} ariaHidden />
          {t('crm.serumError.retry', 'Retry')}
        </Button>
      </div>
    </SerumPanel>
  );
}

export function SerumSourceCard({ label, detail, icon }: { label: string; detail: string; icon: IconName }) {
  return (
    <div className="rounded-xl border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
        <Icon name={icon} size={16} ariaHidden />
        {label}
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">{detail}</p>
    </div>
  );
}

export function SerumInspector({ module }: { module: SerumModuleStatus | null }) {
  const { t } = useTranslation('crm');
  if (!module) {
    return (
      <SerumPanel className="p-5">
        <SerumEmptyState
          title={t('crm.serumInspector.emptyTitle', 'Select a module')}
          detail={t(
            'crm.serumInspector.emptyDetail',
            'Choose a SERUM module to inspect its current status, source, and safest next action.',
          )}
        />
      </SerumPanel>
    );
  }

  return (
    <SerumPanel className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
            {t('crm.serumInspector.label', 'Inspector')}
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight text-[var(--fg-primary)]">{module.label}</h3>
        </div>
        <SerumStatusPill status={module.status} />
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--fg-secondary)]">{module.detail}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {module.href ? (
          <SerumLinkButton to={module.href} icon="arrow">
            {module.primaryAction ?? t('crm.serumInspector.openAction', 'Open')}
          </SerumLinkButton>
        ) : null}
      </div>
    </SerumPanel>
  );
}

export function SerumSplitView({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">{children}</div>;
}

export function SerumAuditDrawer({ latestConfigChangeAt }: { latestConfigChangeAt: string | null }) {
  const { t } = useTranslation('crm');
  return (
    <SerumPanel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-tertiary)]">
            {t('crm.serumAudit.label', 'Audit')}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--fg-primary)]">
            {t('crm.serumAudit.title', 'Control-plane audit trail')}
          </h3>
        </div>
        <Icon name="shield" size={18} className="text-[var(--serum-blue)]" ariaHidden />
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--fg-secondary)]">
        {t('crm.serumAudit.latestChange', 'Latest relevant config change:')}{' '}
        <span className="font-medium text-[var(--fg-primary)]">
          {latestConfigChangeAt
            ? new Date(latestConfigChangeAt).toLocaleString()
            : t('crm.serumAudit.noneRecorded', 'None recorded')}
        </span>
      </p>
    </SerumPanel>
  );
}

export function SerumApprovalCard({ openApprovals }: { openApprovals: number }) {
  const { t } = useTranslation('crm');
  return (
    <SerumPanel className="p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--serum-surface-soft)] text-[var(--serum-violet)]">
          <Icon name="shield" size={18} ariaHidden />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
            {t('crm.serumApproval.title', 'Human approval')}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--fg-secondary)]">
            {openApprovals > 0
              ? t('crm.serumApproval.pending', '{{count}} RFP approval gates need review.', {
                  count: openApprovals,
                })
              : t('crm.serumApproval.none', 'No pending human gates from existing approval workflows.')}
          </p>
        </div>
      </div>
    </SerumPanel>
  );
}

export function SerumSettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <SerumPanel className="p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--fg-primary)]">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--fg-secondary)]">{description}</p>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">{children}</div>
    </SerumPanel>
  );
}

export function SerumSettingsRow({
  label,
  detail,
  status,
  action,
}: {
  label: string;
  detail: string;
  status: SerumSignalStatus;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-[var(--fg-primary)]">{label}</p>
          <SerumStatusPill status={status} />
        </div>
        <p className="mt-1 text-sm leading-6 text-[var(--fg-secondary)]">{detail}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SerumConfigVersionBadge({ label }: { label?: string }) {
  const { t } = useTranslation('crm');
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--serum-border)] bg-[var(--serum-surface-soft)] px-2.5 py-1 text-xs font-medium text-[var(--fg-secondary)]">
      {label ?? t('crm.serumConfigVersion.draft', 'Draft v0')}
    </span>
  );
}

function SerumLinkButton({
  to,
  icon,
  children,
}: {
  to: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-medium text-[var(--fg-primary)] shadow-[var(--shadow-xs)] transition-colors',
        'hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]',
        'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
      )}
    >
      <Icon name={icon} size={14} ariaHidden />
      {children}
    </Link>
  );
}
