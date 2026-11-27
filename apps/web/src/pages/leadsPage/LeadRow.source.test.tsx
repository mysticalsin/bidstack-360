// Demo Polar Foods is stored as cold_outreach. CSS capitalize paints
// Cold_outreach, while the new-lead form already says Cold outreach.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { LeadSummary } from '@bidstack/shared';

import { LeadRow } from './LeadRow';

function polarFoods(): LeadSummary {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    firstName: 'Daniel',
    lastName: 'Korhonen',
    email: 'daniel.korhonen@example.com',
    phone: null,
    companyName: 'Polar Foods',
    title: 'VP IT',
    source: 'cold_outreach',
    status: 'nurture',
    score: 42,
    priority: 'low',
    ownerId: null,
    ownerName: 'Sofia Almeida',
    convertedToOpportunityId: null,
    statusChangedAt: '2026-05-01T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

function renderRow(lead: LeadSummary) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <LeadRow
            lead={lead}
            selected={false}
            query=""
            onToggle={vi.fn()}
            onPatch={vi.fn()}
            onDelete={vi.fn()}
            canWrite
          />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

describe('LeadRow source label', () => {
  afterEach(cleanup);

  it('names Polar Foods cold_outreach the way the new-lead form does', () => {
    renderRow(polarFoods());

    expect(screen.getByText('Cold outreach')).toBeTruthy();
    expect(screen.queryByText('cold_outreach')).toBeNull();
    expect(screen.queryByText('Cold_outreach')).toBeNull();
  });
});
