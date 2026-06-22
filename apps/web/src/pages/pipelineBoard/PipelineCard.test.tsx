// a11y regression test for the overdue affordance (WCAG 1.4.1 Use of Color):
// an overdue opportunity must surface its state via a VISIBLE "Overdue" badge
// (icon + text) AND via the card's accessible name — never by the red card
// tint alone. These assertions fail the moment that dual signal regresses.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Opportunity } from '@bidstack/shared';

import { PipelineCard } from './PipelineCard';

// framer-motion's layout/whileHover machinery is irrelevant to a11y semantics
// and drags in animation-frame timing — render its primitives as plain DOM.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => {
          // Drop motion-only props so they don't leak onto the DOM node.
          const {
            layout: _l,
            layoutId: _lid,
            initial: _i,
            animate: _a,
            exit: _e,
            whileHover: _wh,
            transition: _tr,
            ...domProps
          } = rest as Record<string, unknown>;
          return <li {...domProps}>{children}</li>;
        },
    },
  ),
  useReducedMotion: () => true,
}));

const BASE_OPP: Opportunity = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'OP-2041',
  customer: 'CI Financial',
  name: 'Core banking modernization',
  stage: 's1_ongoing',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_240_000,
  probability: 25,
  dueDate: null,
  owner: null,
  industry: null,
  logo: null,
  country: null,
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

function renderCard(opp: Opportunity) {
  return render(
    <MemoryRouter>
      <ul>
        <PipelineCard
          opp={opp}
          isDragging={false}
          isFocused={false}
          onDragStart={vi.fn()}
          onDragEnd={vi.fn()}
          onFocus={vi.fn()}
          onBlur={vi.fn()}
          onKey={vi.fn()}
        />
      </ul>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('PipelineCard overdue affordance', () => {
  it('shows a visible Overdue badge and appends ", overdue" to the accessible name when past due', () => {
    // Past due + an open stage ("S1 Ongoing") => isStalled === true.
    renderCard({ ...BASE_OPP, dueDate: '2020-01-01' });

    // Visible text, not color alone (getByText throws if absent).
    expect(screen.getByText('Overdue')).toBeDefined();

    // The accessible name carries the state for screen readers.
    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-label')).toContain(', overdue');
  });

  it('omits the Overdue badge and suffix when the opportunity is not past due', () => {
    renderCard({ ...BASE_OPP, dueDate: '2099-12-31' });

    expect(screen.queryByText('Overdue')).toBeNull();
    const link = screen.getByRole('link');
    expect(link.getAttribute('aria-label')).not.toContain(', overdue');
  });
});
