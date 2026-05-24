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
    title: 'Welcome to BidStack 360°',
    body: "Let's show you around in 2 minutes. You'll see how to manage leads, track deals, log activities, and build reports — all in one place.",
    placement: 'center',
    ctaLabel: "Let's go",
  },
  {
    id: 'sidebar-nav',
    title: 'Your CRM workspace',
    body: 'Everything lives in the sidebar — accounts, pipeline, contacts, tasks, and more. You can collapse it for more screen space.',
    target: '[data-tour="nav-sidebar"]',
    placement: 'right',
  },
  {
    id: 'add-lead',
    title: 'Add your first lead',
    body: 'Capture inbound interest here. BidStack scores leads automatically and lets you qualify, convert, or disqualify them in one click.',
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
    title: 'Log calls, emails, notes',
    body: 'Every interaction is captured on the contact timeline. BidStack surfaces the next best action so nothing falls through the cracks.',
    target: '[data-tour="activity-timeline"]',
    route: '/contacts',
    placement: 'left',
  },
  {
    id: 'reports',
    title: 'Build dashboards in minutes',
    body: 'Drag-and-drop widgets to create reports your team actually uses. Share dashboards or schedule them as email digests.',
    target: '[data-tour="reports-new"]',
    route: '/reports',
    placement: 'bottom',
    ctaLabel: 'Invite your team',
  },
];

export const TOUR_TOTAL = TOUR_STEPS.length;
