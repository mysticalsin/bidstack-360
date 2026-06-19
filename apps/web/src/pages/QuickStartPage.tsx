// QuickStart page — /quick-start
// Single-page onboarding checklist with 8 items. Each item is actionable:
// either launches the tour from a specific step or navigates to the action.
// Progress bar reflects completedChecklist from the onboarding store.

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { useOnboardingStore, type ChecklistItem } from '@/stores/onboarding';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { useUsers } from '@/hooks/useUsers';
import { TOUR_STEPS } from '@/data/tour-steps';

interface ChecklistItemDef {
  key: ChecklistItem;
  label: string;
  description: string;
  action: () => void;
}

export function QuickStartPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('onboarding');
  const { completedChecklist, markChecklistItem, skipToStep, startTour, tourActive, openTemplatePicker } =
    useOnboardingStore();

  // Steps backed by real workspace state reflect reality instead of a click, so
  // the progress bar stops being theatre. The rest stay click-acknowledged —
  // they kick off an action with no cheap "is it done" signal.
  const summary = useOrgSummary();
  const users = useUsers();
  const derived: Partial<Record<ChecklistItem, boolean>> = {
    first_lead: (summary.data?.leads ?? 0) > 0,
    first_deal: (summary.data?.opportunities ?? 0) > 0,
    invite_team: (users.data?.length ?? 0) > 1,
  };
  const isDone = (key: ChecklistItem) => derived[key] ?? completedChecklist.includes(key);

  function launchTourAt(stepIndex: number) {
    // Use skipToStep which sets tourActive + currentStepIndex
    skipToStep(stepIndex);
  }

   
  const ITEMS: ChecklistItemDef[] = [
    {
      key: 'profile',
      label: t('quickStart.items.profile.label', 'Complete your profile'),
      description: t(
        'quickStart.items.profile.description',
        'Add your name, photo, and timezone so teammates can find you.',
      ),
      action: () => navigate('/settings'),
    },
    {
      key: 'template',
      label: t('quickStart.items.template.label', 'Pick a template pipeline'),
      description: t(
        'quickStart.items.template.description',
        'Choose B2B SaaS, Agency, Enterprise, or Inside Sales as a starting point.',
      ),
      action: () => openTemplatePicker(),
    },
    {
      key: 'first_lead',
      label: t('quickStart.items.firstLead.label', 'Add your first lead'),
      description: t(
        'quickStart.items.firstLead.description',
        'Capture inbound interest and let BidStack score it automatically.',
      ),
      action: () => launchTourAt(TOUR_STEPS.findIndex((s) => s.id === 'add-lead')),
    },
    {
      key: 'first_activity',
      label: t('quickStart.items.firstActivity.label', 'Log your first activity'),
      description: t(
        'quickStart.items.firstActivity.description',
        'Record a call, email, or note against any contact.',
      ),
      action: () => launchTourAt(TOUR_STEPS.findIndex((s) => s.id === 'activity-timeline')),
    },
    {
      // key is a stable legacy id; the step now frames the actual product job.
      key: 'first_email',
      label: t('quickStart.items.firstBidNoBid.label', 'Run your first bid/no-bid'),
      description: t(
        'quickStart.items.firstBidNoBid.description',
        'Score an opportunity on fit, value, and win probability before you commit.',
      ),
      action: () => navigate('/bid-matrix'),
    },
    {
      key: 'connect_email',
      label: t('quickStart.items.firstRfp.label', 'Start your first RFP response'),
      description: t(
        'quickStart.items.firstRfp.description',
        'Spin up a structured response and let the agents draft the first pass.',
      ),
      action: () => navigate('/proposals'),
    },
    {
      key: 'first_deal',
      label: t('quickStart.items.firstDeal.label', 'Create your first deal'),
      description: t(
        'quickStart.items.firstDeal.description',
        'Convert a lead or add a deal directly to the pipeline.',
      ),
      action: () => launchTourAt(TOUR_STEPS.findIndex((s) => s.id === 'pipeline-kanban')),
    },
    {
      key: 'invite_team',
      label: t('quickStart.items.inviteTeam.label', 'Invite your team'),
      description: t(
        'quickStart.items.inviteTeam.description',
        'Collaboration works best with the whole team in one place.',
      ),
      action: () => navigate('/settings'),
    },
  ];

  const completedCount = ITEMS.filter((i) => isDone(i.key)).length;
  const progressPct = Math.round((completedCount / ITEMS.length) * 100);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--fg-primary)]">{t('quickStart.title', 'Quick Start')}</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          {t('quickStart.subtitle', 'Get from zero to piloting your first bid.')}
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--fg-secondary)]">
          <span>
            {t('quickStart.progress.count', '{{completed}} of {{total}} complete', {
              completed: completedCount,
              total: ITEMS.length,
            })}
          </span>
          <span>{t('quickStart.progress.percent', '{{percent}}%', { percent: progressPct })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('quickStart.progress.ariaLabel', 'Onboarding progress')}
          />
        </div>
      </div>

      {/* Tour launcher */}
      {!tourActive && (
        <button
          type="button"
          onClick={startTour}
          className="mb-8 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--brand)] px-4 py-3 text-sm font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand)]/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        >
          <Icon name="play" size={16} />
          {t('quickStart.tourButton', 'Take the 2-minute product tour')}
        </button>
      )}

      {/* Checklist */}
      <ul className="space-y-3" role="list">
        {ITEMS.map((item) => {
          const done = isDone(item.key);
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => {
                  item.action();
                  // Only click-acknowledge non-derived steps; derived ones
                  // (lead/deal/team) follow the real workspace, not the click.
                  if (!(item.key in derived) && !done) markChecklistItem(item.key);
                }}
                className={cn(
                  'group flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-all',
                  'min-h-[44px]', // WCAG touch target
                  done
                    ? 'border-[var(--border-subtle)] bg-[var(--surface-sunken)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-card)] hover:border-[var(--brand)] hover:shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
                )}
                aria-pressed={done}
              >
                {/* Check icon */}
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2',
                    done
                      ? 'border-[var(--brand)] bg-[var(--brand)] text-[var(--fg-on-brand)]'
                      : 'border-[var(--border-default)] group-hover:border-[var(--brand)]',
                  )}
                  aria-hidden
                >
                  {done && <Icon name="check" size={12} />}
                </span>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      done
                        ? 'text-[var(--fg-secondary)] line-through'
                        : 'text-[var(--fg-primary)]',
                    )}
                  >
                    {item.label}
                  </p>
                  {!done && (
                    <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">{item.description}</p>
                  )}
                </div>

                {!done && (
                  <Icon
                    name="chevron-right"
                    size={16}
                    className="mt-0.5 flex-shrink-0 text-[var(--fg-tertiary)] transition-transform group-hover:translate-x-0.5"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Completion state */}
      {completedCount === ITEMS.length && (
        <div className="mt-8 rounded-xl bg-[var(--brand)]/10 p-6 text-center">
          <Icon
            name="sparkle"
            size={28}
            className="mx-auto mb-2 text-[var(--brand)]"
            ariaHidden
          />
          <p className="font-semibold text-[var(--fg-primary)]">{t('quickStart.complete.title', "You're all set!")}</p>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {t('quickStart.complete.message', 'Your workspace is ready to pilot bids.')}
          </p>
        </div>
      )}
    </div>
  );
}
