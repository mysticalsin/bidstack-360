// A decided bid must not inflate the page-weighted figure. Demo rows such as
// Stellantis (closed_won, probability 100) store the outcome on the legacy
// `stage` field with `pipelineStage` null. Treating "no won/lost flag" as
// open adds that full amount to WR (page) and to the pre-summary Open (page)
// card, so already-won work still reads as pipeline.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Opportunity } from '@bidstack/shared';

import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';

import { OppKpiBar } from './OppToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const BASE: Opportunity = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-0001',
  customer: 'Siemens',
  name: 'Global ERP Modernization',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_200_000,
  probability: 60,
  dueDate: '2026-12-01',
  owner: null,
  industry: null,
  logo: null,
  country: null,
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

const WON: Opportunity = {
  ...BASE,
  id: '22222222-2222-4222-8222-222222222222',
  code: 'OP-0005',
  customer: 'Stellantis',
  name: 'EV Fleet Telematics',
  stage: 'closed_won',
  value: 620_000,
  probability: 100,
};

const OPEN_WEIGHTED = 720_000;
const INFLATED_WEIGHTED = 1_340_000;
const OPEN_VALUE = 1_200_000;
const INFLATED_OPEN = 1_820_000;

function cardText(label: string): string {
  const card = screen.getByText(label).parentElement;
  if (!card) throw new Error(`missing card ${label}`);
  return card.textContent ?? '';
}

afterEach(cleanup);

describe('OppKpiBar decided bids', () => {
  it('keeps a legacy closed-won bid out of WR (page)', () => {
    render(
      <OppKpiBar
        opps={[BASE, WON]}
        summary={{ opportunities: 6, openOpportunities: 4, pipelineValue: 5_000_000 }}
      />,
    );

    const wr = cardText('WR (page)');
    expect(wr).toContain(formatUnspecifiedAmount(OPEN_WEIGHTED));
    expect(wr).not.toContain(formatUnspecifiedAmount(INFLATED_WEIGHTED));
  });

  it('keeps a legacy closed-won bid out of Open (page) before the summary arrives', () => {
    render(<OppKpiBar opps={[BASE, WON]} />);

    const open = cardText('Open (page)');
    expect(open).toContain(formatUnspecifiedAmount(OPEN_VALUE));
    expect(open).not.toContain(formatUnspecifiedAmount(INFLATED_OPEN));
  });
});
