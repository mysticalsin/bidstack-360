// QuickStart page — /quick-start
// Single-page onboarding checklist with 8 items. Each item is actionable:
// either launches the tour from a specific step or navigates to the action.
// Progress bar reflects completedChecklist from the onboarding store.

import { useNavigate } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';
import { useOnboardingStore, type ChecklistItem } from '@/stores/onboarding';
import { TOUR_STEPS } from '@/data/tour-steps';

interface ChecklistItemDef {
  key: ChecklistItem;
  label: string;
  description: string;
  action: () => void;
}

export function QuickStartPage() {
  const navigate = useNavigate();
  const { completedChecklist, markChecklistItem, skipToStep, startTour, tourActive } =
    useOnboardingStore();

  function launchTourAt(stepIndex: number) {
    // Use skipToStep which sets tourActive + currentStepIndex
    skipToStep(stepIndex);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ITEMS: ChecklistItemDef[] = [
    {
      key: 'profile',
      label: 'Complete your profile',
      description: 'Add your name, photo, and timezone so teammates can find you.',
      action: () => navigate('/settings'),
    },
    {
      key: 'template',
      label: 'Pick a template pipeline',
      description: 'Choose B2B SaaS, Agency, Enterprise, or Inside Sales as a starting point.',
      action: () => navigate('/pipeline'),
    },
    {
      key: 'first_lead',
      label: 'Add your first lead',
      description: 'Capture inbound interest and let BidStack score it automatically.',
      action: () => launchTourAt(TOUR_STEPS.findIndex((s) => s.id === 'add-lead')),
    },
    {
      key: 'first_activity',
      label: 'Log your first activity',
      description: 'Record a call, email, or note against any contact.',
      action: () => launchTourAt(TOUR_STEPS.findIndex((s) => s.id === 'activity-timeline')),
    },
    {
      key: 'first_email',
      label: 'Send your first email',
      description: 'Use AI-drafted email sequences right inside BidStack.',
      action: () => navigate('/contacts'),
    },
    {
      key: 'connect_email',
      label: 'Connect Gmail or Outlook',
      description: 'Sync your inbox so every email lands on the contact timeline automatically.',
      action: () => navigate('/integrations'),
    },
    {
      key: 'first_deal',
      label: 'Create your first deal',
      description: 'Convert a lead or add a deal directly to the pipeline.',
      action: () => launchTourAt(TOUR_STEPS.findIndex((s) => s.id === 'pipeline-kanban')),
    },
    {
      key: 'invite_team',
      label: 'Invite your team',
      description: 'Collaboration works best with the whole team in one place.',
      action: () => navigate('/settings'),
    },
  ];

  const completedCount = ITEMS.filter((i) => completedChecklist.includes(i.key)).length;
  const progressPct = Math.round((completedCount / ITEMS.length) * 100);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--fg-primary)]">Quick Start</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Complete these steps to get the most out of BidStack 360°.
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--fg-secondary)]">
          <span>
            {completedCount} of {ITEMS.length} complete
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Onboarding progress"
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
          Take the 2-minute product tour
        </button>
      )}

      {/* Checklist */}
      <ul className="space-y-3" role="list">
        {ITEMS.map((item) => {
          const done = completedChecklist.includes(item.key);
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => {
                  item.action();
                  if (!done) markChecklistItem(item.key);
                }}
                className={cn(
                  'group flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-all',
                  'min-h-[44px]', // WCAG touch target
                  done
                    ? 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] opacity-70'
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
                        ? 'text-[var(--fg-tertiary)] line-through'
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
          <div className="mb-2 text-2xl" aria-hidden>
            🎉
          </div>
          <p className="font-semibold text-[var(--fg-primary)]">You&apos;re all set!</p>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            Your workspace is fully configured.
          </p>
        </div>
      )}
    </div>
  );
}
