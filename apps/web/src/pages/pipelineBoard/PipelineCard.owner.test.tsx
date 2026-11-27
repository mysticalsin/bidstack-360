// The deal board is where a rep sees who holds each bid. Demo bids already
// carry an owner email (fixture OP-2041 is alex.example@example.test; the
// demo org stores an owner on every seeded bid). The card never printed it.
// The link's aria-label replaces the card contents, so a visible line that
// is left out of that name is still silent for a screen reader. A missing
// email must read "No owner". The mailbox is not a name to invent.
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Opportunity } from '@bidstack/shared';

import { PipelineCard } from './PipelineCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const template = fallback ?? key;
      if (!opts) return template;
      return Object.entries(opts).reduce(
        (line, [name, value]) => line.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode }) => {
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
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-2041',
  customer: 'CI Financial',
  name: 'CI Financial IT Modernization',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_240_000,
  probability: 65,
  dueDate: '2026-07-22',
  owner: null,
  industry: null,
  logo: null,
  country: null,
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCount: 1,
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

describe('PipelineCard owner caption', () => {
  it('prints the owner email on the card and in the accessible name', () => {
    renderCard({ ...BASE_OPP, owner: 'alex.example@example.test' });

    expect(screen.getByText('Owned by alex.example@example.test')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain(
      'Owned by alex.example@example.test',
    );
    expect(screen.queryByText('Alex Example')).toBeNull();
  });

  it('says the bid has no owner when the email is missing', () => {
    renderCard({ ...BASE_OPP, owner: null });

    expect(screen.getByText('No owner')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain('No owner');
    expect(screen.queryByText(/Owned by/)).toBeNull();
  });

  it('treats a blank owner as no owner', () => {
    renderCard({ ...BASE_OPP, owner: '   ' });

    expect(screen.getByText('No owner')).toBeTruthy();
    expect(screen.queryByText(/Owned by/)).toBeNull();
  });
});
