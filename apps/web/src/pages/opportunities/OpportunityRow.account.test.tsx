// A bid's customer is the account it is filed on. Demo OP-2041 is CI Financial,
// and that name is not a link today, so the cockpit is a search away. The
// company id is the account route. A bid with no company stays plain text:
// searching the name misses the account and can open the wrong one.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Opportunity } from '@bidstack/shared';

import '@/i18n';

import { Row } from './OpportunityRow';

const COMPANY_ID = '00000000-0000-4000-8000-0000000000aa';

const OPP: Opportunity = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-2041',
  customer: 'CI Financial',
  name: 'CI Financial — IT Modernization & MSP',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_240_000,
  probability: 65,
  dueDate: '2026-07-22',
  owner: null,
  industry: 'financial_services',
  logo: null,
  country: 'CA',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
  companyId: COMPANY_ID,
};

function renderRow(opp: Opportunity) {
  render(
    <MemoryRouter>
      <table>
        <tbody>
          <Row
            opp={opp}
            stageOptions={[]}
            isSelected={false}
            onToggleSelect={vi.fn()}
            patch={{ mutate: vi.fn() } as never}
            canWrite={false}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Opportunity row account link', () => {
  it('opens the account the bid is filed on', () => {
    renderRow(OPP);

    const account = screen.getByRole('link', { name: 'Open CI Financial account' });
    expect(account.getAttribute('href')).toBe(`/accounts/${COMPANY_ID}`);
    expect(screen.getByRole('link', { name: 'OP-2041' }).getAttribute('href')).toBe(
      `/opportunities/${OPP.id}`,
    );
  });

  it('does not search by customer name when the bid is not filed on a company', () => {
    renderRow({ ...OPP, companyId: null });

    // The deal title still contains the customer. Only the account route is absent.
    expect(screen.queryByRole('link', { name: 'Open CI Financial account' })).toBeNull();
    expect(document.querySelector('a[href^="/accounts/"]')).toBeNull();
    expect(screen.getByText('CI Financial')).toBeTruthy();
  });
});
