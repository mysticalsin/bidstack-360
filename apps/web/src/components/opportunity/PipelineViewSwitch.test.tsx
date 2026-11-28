import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { PipelineViewSwitch } from './PipelineViewSwitch';

const GLOBEX = '11111111-1111-4111-8111-111111111111';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{`${location.pathname}${location.search}`}</div>;
}

function renderSwitch(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/pipeline${search}`]}>
      <PipelineViewSwitch current="board" />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PipelineViewSwitch account scope', () => {
  afterEach(cleanup);

  it('keeps a company id when switching to the list and drops a name', () => {
    // WHY: Open pipeline lands on the list for one account. The board is the
    // same book. Switching views must not widen it to every company, and a
    // name in companyId must not survive into the next address.
    const { unmount } = renderSwitch(`?companyId=${GLOBEX}&pipelineStageId=s2_sent`);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByTestId('loc').textContent).toBe(
      `/opportunities?pipelineStageId=s2_sent&companyId=${GLOBEX}`,
    );
    unmount();

    renderSwitch('?companyId=Globex&pipelineStageId=s2_sent');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByTestId('loc').textContent).toBe('/opportunities?pipelineStageId=s2_sent');
  });
});
