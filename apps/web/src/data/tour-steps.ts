// 6-step interactive product tour definition.
// Each step can target a DOM element via a CSS selector (data-tour attribute)
// or show as a centred modal (no target).

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector of the highlighted element. Undefined = centred modal. */
  target?: string;
  /** Navigate here before showing the step. */
  route?: string;
  /** Placement of the tooltip relative to the target. */
  placement: 'center' | 'right' | 'bottom' | 'left' | 'top';
  /** CTA label override for the "Next" button on the last step. */
  ctaLabel?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Polo PreSales',
    body: "Let's show you around in 2 minutes. You'll see how to manage leads, track deals, log activities, and build reports — all in one place.",
    placement: 'center',
    ctaLabel: "Let's go",
  },
  {
    id: 'sidebar-nav',
    title: 'Your bid piloting workspace',
    body: 'Everything lives in the sidebar — accounts, pipeline, contacts, tasks, and more. You can collapse it for more screen space.',
    target: '[data-tour="nav-sidebar"]',
    placement: 'right',
  },
  {
    id: 'add-lead',
    title: 'Add your first lead',
    body: 'Capture inbound interest here. Polo PreSales scores leads automatically and lets you qualify, convert, or disqualify them in one click.',
    target: '[data-tour="leads-page-add"]',
    route: '/leads',
    placement: 'bottom',
  },
  {
    id: 'pipeline-kanban',
    title: 'Drag deals between stages',
    body: 'Your pipeline shows every active deal on a Kanban board. Drag cards to advance them, or click to dive into the full deal record.',
    target: '[data-tour="pipeline-kanban"]',
    route: '/pipeline',
    placement: 'top',
  },
  {
    id: 'activity-timeline',
    title: 'Recent activity',
    // Contacts has no timeline marker, so this step used to dim the whole
    // list. CI Financial is the seeded account (ACCOUNT_KEY ci-financial)
    // whose open follow-up fills the cockpit timeline.
    body: 'Follow-ups, calls, and notes for this account sit on its timeline.',
    target: '[data-tour="activity-timeline"]',
    route: '/accounts/ci-financial',
    placement: 'top',
  },
  {
    id: 'reports',
    title: 'Build reports in minutes',
    body: 'Compose a report from any object — filter, group, and aggregate — preview it live, then save it or pin it to an analytics dashboard.',
    target: '[data-tour="reports-new"]',
    route: '/reports/list',
    placement: 'bottom',
    ctaLabel: 'Create a report',
  },
];

export const TOUR_TOTAL = TOUR_STEPS.length;
