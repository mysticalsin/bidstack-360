// The opportunities list is the book. CI Financial — IT Modernization & MSP
// (OP-2041) is owned by alex.example@example.test. The row showed the
// customer and the updated time, and the owner email on the record never
// appeared. A bid with no owner must not grow an owner line.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Opportunity } from '@bidstack/shared';

import { Row } from './OpportunityRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const CI_FINANCIAL: Opportunity = {
  id: '00000000-0000-4000-8000-000000020041',
  code: 'OP-2041',
  customer: 'CI Financial',
  name: 'CI Financial — IT Modernization & MSP',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_240_000,
  probability: 65,
  dueDate: '2026-07-22',
  owner: 'alex.example@example.test',
  industry: 'financial_services',
  logo: null,
  country: 'CA',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-05-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
  bidClass: null,
  fteEstimate: null,
  commitmentLevel: null,
};

function renderRow(opp: Opportunity) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <Row
            opp={opp}
            stageOptions={[]}
            isSelected={false}
            onToggleSelect={() => undefined}
            patch={{ mutate: vi.fn() } as never}
            canWrite
          />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('Opportunity row owner', () => {
  it('names the owner of the demo CI Financial bid on the row', () => {
    renderRow(CI_FINANCIAL);

    expect(screen.getByText('CI Financial — IT Modernization & MSP')).toBeTruthy();
    const owner = screen.getByText('Owned by alex.example@example.test');
    // Secondary foreground clears the row in both themes. Tertiary is the
    // customer line and is the token that goes dim.
    expect(owner.className).toContain('text-[var(--fg-secondary)]');
    expect(owner.className).not.toContain('fg-tertiary');
  });

  it('does not invent an owner when the bid has none', () => {
    renderRow({
      ...CI_FINANCIAL,
      id: '00000000-0000-4000-8000-000000020099',
      code: 'OP-2099',
      name: 'Unassigned fixture bid',
      owner: null,
    });

    expect(screen.getByText('Unassigned fixture bid')).toBeTruthy();
    expect(screen.queryByText(/Owned by/)).toBeNull();
  });
});
